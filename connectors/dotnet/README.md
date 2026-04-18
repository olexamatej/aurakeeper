# AuraKeeper .NET Connector

Minimal .NET connector for sending application errors to AuraKeeper's
`POST /v1/logs/errors` endpoint.

## Features

- Manual capture for handled exceptions and messages
- Optional process-level hooks for `AppDomain.CurrentDomain.UnhandledException`
- Optional task-level hooks for `TaskScheduler.UnobservedTaskException`
- Payloads shaped to match [`openapi.yaml`](../../openapi.yaml)
- No external package dependencies

## Files

- [`AuraKeeper/`](./AuraKeeper): installable class library
- [`examples/`](./examples): console app example

## Install

```bash
dotnet add <your-project> reference ./connectors/dotnet/AuraKeeper/AuraKeeper.csproj
```

## Usage

```csharp
using AuraKeeper;

await using var connector = new AuraKeeperConnector(new AuraKeeperConnectorOptions
{
    Endpoint = new Uri("https://api.example.com/v1/logs/errors"),
    ApiToken = "your-api-token",
    ServiceName = "dotnet-worker",
    ServiceVersion = "1.0.0",
    Environment = "production",
    Framework = "aspnetcore",
    Component = "billing",
    Tags = ["backend"]
});

connector.Install();

try
{
    throw new InvalidOperationException("Handled .NET error");
}
catch (Exception error)
{
    await connector.CaptureExceptionAsync(
        error,
        new AuraKeeperCaptureOptions
        {
            Handled = true,
            Level = "error",
            CorrelationId = "job_123",
            Request = new Dictionary<string, object?>
            {
                ["method"] = "POST",
                ["path"] = "/jobs/reconcile"
            },
            User = new Dictionary<string, object?>
            {
                ["id"] = "user_42"
            },
            Details = new Dictionary<string, object?>
            {
                ["jobName"] = "reconcile-payments"
            }
        });
}

await connector.FlushAsync();
```

## Options

- `Endpoint`: full AuraKeeper ingestion URL
- `ApiToken`: API token sent as `X-API-Token`
- `ServiceName`: required logical service name
- `ServiceVersion`: optional application version or build id
- `Environment`: optional environment such as `production`
- `Platform`: optional override such as `backend`, `worker`, or `cli`
- `Framework`: optional value for `source.framework`
- `Component`: optional value for `source.component`
- `InstanceId`: optional service instance identifier
- `Tags`: optional tags appended to `context.tags`
- `Context`: optional shared context merged into every event
- `Headers`: optional additional HTTP headers
- `Timeout`: request timeout for the default HTTP transport
- `HttpClient`: optional shared `HttpClient`
- `BeforeSend`: optional hook to mutate or drop a payload before send
- `OnTransportError`: optional callback used by automatic exception hooks
- `CaptureUnhandledExceptions`: disable `AppDomain` capture with `false`
- `CaptureUnobservedTaskExceptions`: disable `TaskScheduler` capture with `false`

## Notes

- `CaptureExceptionAsync()` and `CaptureMessageAsync()` return the HTTP status and
  response body from AuraKeeper.
- Automatic hooks send immediately; call `FlushAsync()` during shutdown if you
  want to wait for in-flight sends.
- A runnable example is available in [`examples/ConsoleApp`](./examples/ConsoleApp).
