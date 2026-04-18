using System.Collections;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AuraKeeper;

public sealed class AuraKeeperConnector : IDisposable, IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly AuraKeeperConnectorOptions _options;
    private readonly HttpClient _httpClient;
    private readonly bool _ownsHttpClient;
    private readonly object _sync = new();
    private readonly HashSet<Task<AuraKeeperSendResult?>> _pending = new();

    private bool _installed;
    private bool _disposed;

    public AuraKeeperConnector(AuraKeeperConnectorOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        if (options.Endpoint is null)
        {
            throw new ArgumentException("AuraKeeperConnector requires an endpoint.", nameof(options));
        }

        if (string.IsNullOrWhiteSpace(options.ApiToken))
        {
            throw new ArgumentException("AuraKeeperConnector requires an api token.", nameof(options));
        }

        if (string.IsNullOrWhiteSpace(options.ServiceName))
        {
            throw new ArgumentException("AuraKeeperConnector requires a service name.", nameof(options));
        }

        _options = options;
        _httpClient = options.HttpClient ?? new HttpClient
        {
            Timeout = Timeout.InfiniteTimeSpan
        };
        _ownsHttpClient = options.HttpClient is null;
    }

    public AuraKeeperConnector Install()
    {
        ThrowIfDisposed();

        if (_installed)
        {
            return this;
        }

        if (_options.CaptureUnhandledExceptions)
        {
            AppDomain.CurrentDomain.UnhandledException += HandleUnhandledException;
        }

        if (_options.CaptureUnobservedTaskExceptions)
        {
            TaskScheduler.UnobservedTaskException += HandleUnobservedTaskException;
        }

        _installed = true;
        return this;
    }

    public AuraKeeperConnector Uninstall()
    {
        if (!_installed)
        {
            return this;
        }

        if (_options.CaptureUnhandledExceptions)
        {
            AppDomain.CurrentDomain.UnhandledException -= HandleUnhandledException;
        }

        if (_options.CaptureUnobservedTaskExceptions)
        {
            TaskScheduler.UnobservedTaskException -= HandleUnobservedTaskException;
        }

        _installed = false;
        return this;
    }

    public Task<AuraKeeperSendResult?> CaptureExceptionAsync(
        Exception exception,
        AuraKeeperCaptureOptions? capture = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(exception);
        ThrowIfDisposed();
        return TrackPending(CaptureCoreAsync(exception, capture, cancellationToken));
    }

    public Task<AuraKeeperSendResult?> CaptureMessageAsync(
        string message,
        AuraKeeperCaptureOptions? capture = null,
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return TrackPending(CaptureCoreAsync(message, capture, cancellationToken));
    }

    public async Task FlushAsync(CancellationToken cancellationToken = default)
    {
        Task<AuraKeeperSendResult?>[] snapshot;

        lock (_sync)
        {
            snapshot = _pending.ToArray();
        }

        if (snapshot.Length == 0)
        {
            return;
        }

        await Task.WhenAll(snapshot).WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    public void Dispose()
    {
        DisposeAsync().AsTask().GetAwaiter().GetResult();
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Uninstall();

        try
        {
            await FlushAsync().ConfigureAwait(false);
        }
        finally
        {
            if (_ownsHttpClient)
            {
                _httpClient.Dispose();
            }
        }
    }

    private Task<AuraKeeperSendResult?> TrackPending(Task<AuraKeeperSendResult?> task)
    {
        lock (_sync)
        {
            _pending.Add(task);
        }

        _ = task.ContinueWith(
            completed =>
            {
                lock (_sync)
                {
                    _pending.Remove(completed);
                }
            },
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        return task;
    }

    private async Task<AuraKeeperSendResult?> CaptureCoreAsync(
        object? errorValue,
        AuraKeeperCaptureOptions? capture,
        CancellationToken cancellationToken)
    {
        var payload = await BuildPayloadAsync(errorValue, capture, cancellationToken).ConfigureAwait(false);
        if (payload is null)
        {
            return null;
        }

        return await SendAsync(payload, cancellationToken).ConfigureAwait(false);
    }

    private async Task<Dictionary<string, object?>?> BuildPayloadAsync(
        object? errorValue,
        AuraKeeperCaptureOptions? capture,
        CancellationToken cancellationToken)
    {
        var normalized = NormalizeError(errorValue);
        var details = MergeDictionaries(normalized.Details, capture?.Details);
        var payload = new Dictionary<string, object?>
        {
            ["eventId"] = Guid.NewGuid().ToString(),
            ["occurredAt"] = (capture?.OccurredAt ?? DateTimeOffset.UtcNow).ToString("O"),
            ["level"] = capture?.Level ?? "error",
            ["platform"] = capture?.Platform ?? _options.Platform ?? "backend",
            ["environment"] = capture?.Environment ?? _options.Environment,
            ["service"] = CompactDictionary(new Dictionary<string, object?>
            {
                ["name"] = _options.ServiceName,
                ["version"] = _options.ServiceVersion,
                ["instanceId"] = _options.InstanceId
            }),
            ["source"] = CompactDictionary(new Dictionary<string, object?>
            {
                ["runtime"] = "dotnet",
                ["language"] = "csharp",
                ["framework"] = _options.Framework,
                ["component"] = _options.Component
            }),
            ["error"] = CompactDictionary(new Dictionary<string, object?>
            {
                ["type"] = capture?.Type ?? normalized.Type,
                ["message"] = capture?.Message ?? normalized.Message,
                ["code"] = capture?.Code ?? normalized.Code,
                ["stack"] = capture?.Stack ?? normalized.Stack,
                ["handled"] = capture?.Handled ?? true,
                ["details"] = details.Count > 0 ? SanitizeValue(details) : null
            }),
            ["context"] = BuildContext(capture)
        };

        if (_options.BeforeSend is not null)
        {
            payload = await _options.BeforeSend(payload, cancellationToken).ConfigureAwait(false);
            if (payload is null)
            {
                return null;
            }
        }

        return CompactDictionary(payload);
    }

    private Dictionary<string, object?>? BuildContext(AuraKeeperCaptureOptions? capture)
    {
        var merged = MergeDictionaries(_options.Context, capture?.Context);
        var request = MergeDictionaries(
            ExtractNestedDictionary(_options.Context, "request"),
            ExtractNestedDictionary(capture?.Context, "request"),
            capture?.Request);
        var user = MergeDictionaries(
            ExtractNestedDictionary(_options.Context, "user"),
            ExtractNestedDictionary(capture?.Context, "user"),
            capture?.User);
        var session = MergeDictionaries(
            ExtractNestedDictionary(_options.Context, "session"),
            ExtractNestedDictionary(capture?.Context, "session"),
            capture?.Session);
        var device = MergeDictionaries(
            ExtractNestedDictionary(_options.Context, "device"),
            ExtractNestedDictionary(capture?.Context, "device"),
            capture?.Device);
        var tags = UniqueStrings(
            _options.Tags,
            ExtractNestedStrings(_options.Context, "tags"),
            ExtractNestedStrings(capture?.Context, "tags"),
            capture?.Tags);
        var correlationId =
            capture?.CorrelationId ??
            ExtractNestedString(capture?.Context, "correlationId") ??
            ExtractNestedString(_options.Context, "correlationId");

        merged["request"] = request.Count > 0 ? SanitizeValue(request) : null;
        merged["user"] = user.Count > 0 ? SanitizeValue(user) : null;
        merged["session"] = session.Count > 0 ? SanitizeValue(session) : null;
        merged["device"] = device.Count > 0 ? SanitizeValue(device) : null;
        merged["correlationId"] = correlationId;
        merged["tags"] = tags.Count > 0 ? tags : null;

        var compact = CompactDictionary(merged);
        return compact.Count > 0 ? compact : null;
    }

    private async Task<AuraKeeperSendResult> SendAsync(
        Dictionary<string, object?> payload,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, _options.Endpoint);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_options.Timeout);

        request.Headers.TryAddWithoutValidation("X-API-Token", _options.ApiToken);
        request.Content = new StringContent(
            JsonSerializer.Serialize(payload, JsonOptions),
            Encoding.UTF8,
            "application/json");

        foreach (var header in _options.Headers ?? new Dictionary<string, string>())
        {
            if (!request.Headers.TryAddWithoutValidation(header.Key, header.Value))
            {
                request.Content.Headers.TryAddWithoutValidation(header.Key, header.Value);
            }
        }

        using var response = await _httpClient.SendAsync(request, timeout.Token).ConfigureAwait(false);
        var body = response.Content is null
            ? null
            : await response.Content.ReadAsStringAsync(timeout.Token).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"AuraKeeper request failed with status {(int)response.StatusCode}: {body}");
        }

        return new AuraKeeperSendResult
        {
            StatusCode = response.StatusCode,
            Body = string.IsNullOrWhiteSpace(body) ? null : body
        };
    }

    private void HandleUnhandledException(object sender, UnhandledExceptionEventArgs args)
    {
        SendAutomatic(
            args.ExceptionObject,
            new AuraKeeperCaptureOptions
            {
                Handled = false,
                Level = "critical",
                Platform = _options.Platform ?? "backend",
                Details = new Dictionary<string, object?>
                {
                    ["isTerminating"] = args.IsTerminating
                }
            });
    }

    private void HandleUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs args)
    {
        SendAutomatic(
            args.Exception,
            new AuraKeeperCaptureOptions
            {
                Handled = false,
                Level = "error",
                Platform = _options.Platform ?? "backend",
                Details = new Dictionary<string, object?>
                {
                    ["unobservedTaskException"] = true
                }
            });
    }

    private void SendAutomatic(object? errorValue, AuraKeeperCaptureOptions capture)
    {
        try
        {
            CaptureCoreAsync(errorValue, capture, CancellationToken.None).GetAwaiter().GetResult();
        }
        catch (Exception transportError)
        {
            if (_options.OnTransportError is not null)
            {
                _options.OnTransportError(transportError);
                return;
            }

            Console.Error.WriteLine($"AuraKeeper failed to send error log. {transportError}");
        }
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }

    private static Dictionary<string, object?> MergeDictionaries(
        params IReadOnlyDictionary<string, object?>?[] dictionaries)
    {
        var merged = new Dictionary<string, object?>(StringComparer.Ordinal);

        foreach (var dictionary in dictionaries)
        {
            if (dictionary is null)
            {
                continue;
            }

            foreach (var entry in dictionary)
            {
                merged[entry.Key] = entry.Value;
            }
        }

        return merged;
    }

    private static Dictionary<string, object?> ExtractNestedDictionary(
        IReadOnlyDictionary<string, object?>? source,
        string key)
    {
        if (source is null || !source.TryGetValue(key, out var value))
        {
            return new Dictionary<string, object?>(StringComparer.Ordinal);
        }

        return value switch
        {
            IReadOnlyDictionary<string, object?> readOnly => new Dictionary<string, object?>(readOnly, StringComparer.Ordinal),
            IDictionary<string, object?> mutable => new Dictionary<string, object?>(mutable, StringComparer.Ordinal),
            _ => new Dictionary<string, object?>(StringComparer.Ordinal)
        };
    }

    private static List<string> ExtractNestedStrings(
        IReadOnlyDictionary<string, object?>? source,
        string key)
    {
        if (source is null || !source.TryGetValue(key, out var value) || value is string)
        {
            return [];
        }

        if (value is IEnumerable<string> stringValues)
        {
            return UniqueStrings(stringValues);
        }

        if (value is IEnumerable enumerable)
        {
            var items = new List<string>();
            foreach (var entry in enumerable)
            {
                if (entry is string stringEntry && !string.IsNullOrWhiteSpace(stringEntry))
                {
                    items.Add(stringEntry);
                }
            }

            return UniqueStrings(items);
        }

        return [];
    }

    private static string? ExtractNestedString(
        IReadOnlyDictionary<string, object?>? source,
        string key)
    {
        if (source is null || !source.TryGetValue(key, out var value))
        {
            return null;
        }

        return value as string;
    }

    private static List<string> UniqueStrings(params IEnumerable<string>?[] groups)
    {
        var values = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var group in groups)
        {
            if (group is null)
            {
                continue;
            }

            foreach (var value in group)
            {
                if (string.IsNullOrWhiteSpace(value) || !seen.Add(value))
                {
                    continue;
                }

                values.Add(value);
            }
        }

        return values;
    }

    private static Dictionary<string, object?> CompactDictionary(Dictionary<string, object?> source)
    {
        var compact = new Dictionary<string, object?>(StringComparer.Ordinal);

        foreach (var entry in source)
        {
            var sanitized = SanitizeValue(entry.Value);
            if (sanitized is null)
            {
                continue;
            }

            compact[entry.Key] = sanitized;
        }

        return compact;
    }

    private static object? SanitizeValue(object? value, int depth = 0)
    {
        if (value is null)
        {
            return null;
        }

        if (depth >= 6)
        {
            return value.ToString();
        }

        switch (value)
        {
            case string or bool or byte or sbyte or short or ushort or int or uint or long or ulong or float or double or decimal:
                return value;
            case DateTime dateTime:
                return dateTime.ToUniversalTime().ToString("O");
            case DateTimeOffset offset:
                return offset.ToUniversalTime().ToString("O");
            case Guid or Uri or TimeSpan or Version or Enum:
                return value.ToString();
            case Exception exception:
                return exception.ToString();
            case IReadOnlyDictionary<string, object?> readOnlyDictionary:
                return CompactDictionary(
                    readOnlyDictionary.ToDictionary(entry => entry.Key, entry => SanitizeValue(entry.Value, depth + 1), StringComparer.Ordinal));
            case IDictionary<string, object?> dictionary:
                return CompactDictionary(
                    dictionary.ToDictionary(entry => entry.Key, entry => SanitizeValue(entry.Value, depth + 1), StringComparer.Ordinal));
            case IDictionary legacyDictionary:
            {
                var output = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (DictionaryEntry entry in legacyDictionary)
                {
                    if (entry.Key is not null)
                    {
                        output[entry.Key.ToString() ?? string.Empty] = SanitizeValue(entry.Value, depth + 1);
                    }
                }

                return CompactDictionary(output);
            }
            case IEnumerable enumerable when value is not string:
            {
                var items = new List<object?>();
                foreach (var entry in enumerable)
                {
                    var sanitized = SanitizeValue(entry, depth + 1);
                    if (sanitized is not null)
                    {
                        items.Add(sanitized);
                    }
                }

                return items.Count > 0 ? items : null;
            }
            default:
                return value.ToString();
        }
    }

    private static NormalizedError NormalizeError(object? value)
    {
        if (value is Exception exception)
        {
            return new NormalizedError(
                Type: exception.GetType().Name,
                Message: string.IsNullOrWhiteSpace(exception.Message) ? "Unknown error" : exception.Message,
                Code: ReadErrorCode(exception),
                Stack: exception.ToString(),
                Details: null);
        }

        if (value is string message && !string.IsNullOrWhiteSpace(message))
        {
            return new NormalizedError(
                Type: "Error",
                Message: message,
                Code: null,
                Stack: null,
                Details: null);
        }

        return new NormalizedError(
            Type: "Error",
            Message: "Unknown error",
            Code: null,
            Stack: null,
            Details: value is null
                ? null
                : new Dictionary<string, object?>
                {
                    ["originalValue"] = value
                });
    }

    private static string? ReadErrorCode(Exception exception)
    {
        if (exception.Data.Contains("code") && exception.Data["code"] is string dataCode && !string.IsNullOrWhiteSpace(dataCode))
        {
            return dataCode;
        }

        var property = exception.GetType().GetProperty("Code");
        if (property?.PropertyType == typeof(string) && property.GetValue(exception) is string code && !string.IsNullOrWhiteSpace(code))
        {
            return code;
        }

        return null;
    }

    private sealed record NormalizedError(
        string Type,
        string Message,
        string? Code,
        string? Stack,
        IReadOnlyDictionary<string, object?>? Details);
}

public sealed class AuraKeeperConnectorOptions
{
    public required Uri Endpoint { get; init; }

    public required string ApiToken { get; init; }

    public required string ServiceName { get; init; }

    public string? ServiceVersion { get; init; }

    public string? Environment { get; init; }

    public string? Platform { get; init; }

    public string? Framework { get; init; }

    public string? Component { get; init; }

    public string? InstanceId { get; init; }

    public IReadOnlyList<string>? Tags { get; init; }

    public IReadOnlyDictionary<string, object?>? Context { get; init; }

    public IReadOnlyDictionary<string, string>? Headers { get; init; }

    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(5);

    public HttpClient? HttpClient { get; init; }

    public Func<Dictionary<string, object?>, CancellationToken, ValueTask<Dictionary<string, object?>?>>? BeforeSend { get; init; }

    public Action<Exception>? OnTransportError { get; init; }

    public bool CaptureUnhandledExceptions { get; init; } = true;

    public bool CaptureUnobservedTaskExceptions { get; init; } = true;
}

public sealed class AuraKeeperCaptureOptions
{
    public DateTimeOffset? OccurredAt { get; init; }

    public string? Level { get; init; }

    public string? Platform { get; init; }

    public string? Environment { get; init; }

    public string? Type { get; init; }

    public string? Message { get; init; }

    public string? Code { get; init; }

    public string? Stack { get; init; }

    public bool? Handled { get; init; }

    public IReadOnlyDictionary<string, object?>? Details { get; init; }

    public IReadOnlyDictionary<string, object?>? Context { get; init; }

    public IReadOnlyDictionary<string, object?>? Request { get; init; }

    public IReadOnlyDictionary<string, object?>? User { get; init; }

    public IReadOnlyDictionary<string, object?>? Session { get; init; }

    public IReadOnlyDictionary<string, object?>? Device { get; init; }

    public string? CorrelationId { get; init; }

    public IReadOnlyList<string>? Tags { get; init; }
}

public sealed class AuraKeeperSendResult
{
    public required HttpStatusCode StatusCode { get; init; }

    public string? Body { get; init; }
}
