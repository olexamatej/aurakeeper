package com.aurakeeper;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.Array;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

public final class AuraKeeperConnector implements AutoCloseable {
  private static final int MAX_SANITIZE_DEPTH = 6;

  private final URI endpoint;
  private final String apiToken;
  private final String serviceName;
  private final String serviceVersion;
  private final String environment;
  private final String platform;
  private final String framework;
  private final String component;
  private final String instanceId;
  private final Duration timeout;
  private final boolean captureUncaught;
  private final Map<String, String> headers;
  private final Map<String, Object> sharedContext;
  private final List<String> sharedTags;
  private final HttpClient httpClient;
  private final ExecutorService executor;
  private final Set<CompletableFuture<TransportResponse>> pendingRequests;

  private volatile boolean installed;
  private volatile Thread.UncaughtExceptionHandler previousUncaughtHandler;

  private AuraKeeperConnector(Builder builder) {
    this.endpoint = URI.create(requireText(builder.endpoint, "endpoint"));
    this.apiToken = requireText(builder.apiToken, "apiToken");
    this.serviceName = requireText(builder.serviceName, "serviceName");
    this.serviceVersion = builder.serviceVersion;
    this.environment = builder.environment;
    this.platform = builder.platform;
    this.framework = builder.framework;
    this.component = builder.component;
    this.instanceId = builder.instanceId;
    this.timeout = builder.timeout == null ? Duration.ofSeconds(5) : builder.timeout;
    this.captureUncaught = builder.captureUncaught;
    this.headers = copyStringMap(builder.headers);
    this.sharedContext = sanitizeObjectMap(builder.context);
    this.sharedTags = uniqueStrings(builder.tags);
    this.httpClient = HttpClient.newBuilder().connectTimeout(this.timeout).build();
    this.executor = Executors.newFixedThreadPool(builder.maxWorkers, new AuraKeeperThreadFactory());
    this.pendingRequests = ConcurrentHashMap.newKeySet();
  }

  public static Builder builder() {
    return new Builder();
  }

  public AuraKeeperConnector install() {
    if (!captureUncaught || installed) {
      return this;
    }

    previousUncaughtHandler = Thread.getDefaultUncaughtExceptionHandler();
    Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
      handleUncaughtException(thread, error);
      if (previousUncaughtHandler != null) {
        previousUncaughtHandler.uncaughtException(thread, error);
      }
    });
    installed = true;
    return this;
  }

  public AuraKeeperConnector uninstall() {
    if (!installed) {
      return this;
    }

    Thread.setDefaultUncaughtExceptionHandler(previousUncaughtHandler);
    previousUncaughtHandler = null;
    installed = false;
    return this;
  }

  public CompletableFuture<TransportResponse> captureException(Throwable error) {
    return captureException(error, null);
  }

  public CompletableFuture<TransportResponse> captureException(
      Throwable error,
      EventOverrides overrides
  ) {
    Map<String, Object> payload = buildPayload(error, overrides);
    CompletableFuture<TransportResponse> future = CompletableFuture.supplyAsync(() -> send(payload), executor);
    pendingRequests.add(future);
    future.whenComplete((ignored, failure) -> pendingRequests.remove(future));
    return future;
  }

  public CompletableFuture<TransportResponse> captureMessage(String message) {
    return captureMessage(message, null);
  }

  public CompletableFuture<TransportResponse> captureMessage(String message, EventOverrides overrides) {
    EventOverrides nextOverrides = overrides == null
        ? EventOverrides.builder().type("Message").build()
        : overrides.toBuilder().type(overrides.type == null ? "Message" : overrides.type).build();
    return captureException(new RuntimeException(String.valueOf(message)), nextOverrides);
  }

  public List<String> flush(Duration waitFor) {
    List<CompletableFuture<TransportResponse>> pending = new ArrayList<>(pendingRequests);
    if (pending.isEmpty()) {
      return Collections.emptyList();
    }

    CompletableFuture<Void> all = CompletableFuture.allOf(pending.toArray(new CompletableFuture[0]));
    try {
      if (waitFor == null) {
        all.join();
      } else {
        all.get(waitFor.toMillis(), TimeUnit.MILLISECONDS);
      }
    } catch (TimeoutException ignored) {
      // The caller can inspect the returned statuses.
    } catch (Exception ignored) {
      // Individual future outcomes are reported below.
    }

    List<String> statuses = new ArrayList<>(pending.size());
    for (CompletableFuture<TransportResponse> future : pending) {
      if (!future.isDone()) {
        statuses.add("pending");
        continue;
      }

      try {
        future.join();
        statuses.add("fulfilled");
      } catch (CompletionException error) {
        statuses.add("rejected: " + error.getCause().getMessage());
      }
    }
    return statuses;
  }

  @Override
  public void close() {
    flush(timeout);
    uninstall();
    executor.shutdown();
  }

  public Map<String, Object> buildPayload(Throwable error, EventOverrides overrides) {
    Throwable normalizedError = error == null ? new RuntimeException("Unknown error") : error;
    EventOverrides nextOverrides = overrides == null ? EventOverrides.builder().build() : overrides;

    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("eventId", firstNonNull(nextOverrides.eventId, UUID.randomUUID().toString()));
    payload.put("occurredAt", firstNonNull(nextOverrides.occurredAt, Instant.now().toString()));
    payload.put("level", firstNonNull(nextOverrides.level, "error"));
    payload.put("platform", firstNonNull(nextOverrides.platform, platform, "backend"));
    payload.put("environment", firstNonNull(nextOverrides.environment, environment));
    payload.put("service", compactMap(mapOf(
        "name", serviceName,
        "version", firstNonNull(nextOverrides.serviceVersion(), serviceVersion),
        "instanceId", firstNonNull(nextOverrides.instanceId(), instanceId)
    )));
    payload.put("source", compactMap(mergeMaps(
        mapOf(
            "runtime", "jvm",
            "language", "java",
            "framework", framework,
            "component", component
        ),
        nextOverrides.source
    )));
    payload.put("error", compactMap(mapOf(
        "type", firstNonNull(nextOverrides.type, simpleClassName(normalizedError)),
        "message", firstNonNull(nextOverrides.message, errorMessage(normalizedError)),
        "code", nextOverrides.code,
        "stack", firstNonNull(nextOverrides.stack, stackTrace(normalizedError)),
        "handled", firstNonNull(nextOverrides.handled, Boolean.TRUE),
        "details", compactMap(nextOverrides.details)
    )));

    Map<String, Object> context = buildContext(nextOverrides);
    if (!context.isEmpty()) {
      payload.put("context", context);
    }

    return compactMap(payload);
  }

  public TransportResponse send(Map<String, Object> payload) {
    try {
      HttpRequest.Builder requestBuilder = HttpRequest.newBuilder(endpoint)
          .timeout(timeout)
          .POST(HttpRequest.BodyPublishers.ofString(toJson(payload)));
      requestBuilder.header("content-type", "application/json");
      requestBuilder.header("X-API-Token", apiToken);
      for (Map.Entry<String, String> entry : headers.entrySet()) {
        requestBuilder.header(entry.getKey(), entry.getValue());
      }

      HttpResponse<String> response = httpClient.send(
          requestBuilder.build(),
          HttpResponse.BodyHandlers.ofString()
      );

      if (response.statusCode() >= 400) {
        throw new IllegalStateException(
            "AuraKeeper request failed with status "
                + response.statusCode()
                + ": "
                + response.body()
        );
      }

      return new TransportResponse(response.statusCode(), response.body());
    } catch (Exception error) {
      throw new CompletionException(error);
    }
  }

  private Map<String, Object> buildContext(EventOverrides overrides) {
    Map<String, Object> context = mergeMaps(sharedContext, overrides.context);

    mergeNamedContextMap(context, "request", sharedContext.get("request"), overrides.request);
    mergeNamedContextMap(context, "user", sharedContext.get("user"), overrides.user);
    mergeNamedContextMap(context, "session", sharedContext.get("session"), overrides.session);
    mergeNamedContextMap(context, "device", sharedContext.get("device"), overrides.device);

    String correlationId = firstNonNull(
        overrides.correlationId,
        stringValue(sharedContext.get("correlationId"))
    );
    if (correlationId != null) {
      context.put("correlationId", correlationId);
    }

    List<String> tags = uniqueStrings(sharedTags, stringList(sharedContext.get("tags")), overrides.tags);
    if (!tags.isEmpty()) {
      context.put("tags", tags);
    }

    return compactMap(context);
  }

  private void handleUncaughtException(Thread thread, Throwable error) {
    Map<String, Object> details = new LinkedHashMap<>();
    if (thread != null) {
      details.put("thread", compactMap(mapOf(
          "name", thread.getName(),
          "id", thread.getId()
      )));
    }

    try {
      send(buildPayload(
          error,
          EventOverrides.builder()
              .handled(false)
              .level("critical")
              .details(details)
              .build()
      ));
    } catch (CompletionException ignored) {
      // Automatic capture should not mask the original failure.
    }
  }

  private static void mergeNamedContextMap(
      Map<String, Object> context,
      String key,
      Object baseValue,
      Map<String, Object> overrideValue
  ) {
    Map<String, Object> merged = mergeMaps(
        baseValue instanceof Map ? castObjectMap(baseValue) : null,
        overrideValue
    );
    if (!merged.isEmpty()) {
      context.put(key, merged);
    }
  }

  private static String stackTrace(Throwable error) {
    StringWriter buffer = new StringWriter();
    error.printStackTrace(new PrintWriter(buffer));
    return buffer.toString().trim();
  }

  private static String errorMessage(Throwable error) {
    return error.getMessage() == null || error.getMessage().isBlank()
        ? error.toString()
        : error.getMessage();
  }

  private static String simpleClassName(Throwable error) {
    String name = error.getClass().getSimpleName();
    return name == null || name.isBlank() ? error.getClass().getName() : name;
  }

  private static String requireText(String value, String fieldName) {
    if (value == null || value.isBlank()) {
      throw new IllegalArgumentException("AuraKeeperConnector requires " + fieldName + ".");
    }
    return value;
  }

  private static String firstNonNull(String... values) {
    for (String value : values) {
      if (value != null) {
        return value;
      }
    }
    return null;
  }

  private static Boolean firstNonNull(Boolean... values) {
    for (Boolean value : values) {
      if (value != null) {
        return value;
      }
    }
    return null;
  }

  private static Map<String, String> copyStringMap(Map<String, String> values) {
    if (values == null || values.isEmpty()) {
      return Collections.emptyMap();
    }

    Map<String, String> result = new LinkedHashMap<>();
    for (Map.Entry<String, String> entry : values.entrySet()) {
      if (entry.getKey() != null && entry.getValue() != null) {
        result.put(entry.getKey(), entry.getValue());
      }
    }
    return result;
  }

  private static Map<String, Object> castObjectMap(Object value) {
    if (!(value instanceof Map)) {
      return Collections.emptyMap();
    }

    Map<String, Object> result = new LinkedHashMap<>();
    Map<?, ?> map = (Map<?, ?>) value;
    for (Map.Entry<?, ?> entry : map.entrySet()) {
      result.put(String.valueOf(entry.getKey()), entry.getValue());
    }
    return result;
  }

  private static Map<String, Object> sanitizeObjectMap(Map<String, ?> values) {
    if (values == null || values.isEmpty()) {
      return Collections.emptyMap();
    }
    Object sanitized = sanitizeValue(values, MAX_SANITIZE_DEPTH, new IdentityHashMap<>());
    return sanitized instanceof Map ? castObjectMap(sanitized) : Collections.emptyMap();
  }

  private static Map<String, Object> mergeMaps(Map<String, ?> base, Map<String, ?> overrides) {
    Map<String, Object> result = new LinkedHashMap<>();
    if (base != null) {
      result.putAll(sanitizeObjectMap(base));
    }
    if (overrides != null) {
      result.putAll(sanitizeObjectMap(overrides));
    }
    return compactMap(result);
  }

  private static List<String> stringList(Object value) {
    if (!(value instanceof Iterable<?>)) {
      return Collections.emptyList();
    }

    List<String> result = new ArrayList<>();
    for (Object entry : (Iterable<?>) value) {
      if (entry != null) {
        result.add(String.valueOf(entry));
      }
    }
    return result;
  }

  @SafeVarargs
  private static List<String> uniqueStrings(List<String>... lists) {
    LinkedHashSet<String> values = new LinkedHashSet<>();
    for (List<String> list : lists) {
      if (list == null) {
        continue;
      }
      for (String value : list) {
        if (value != null && !value.isBlank()) {
          values.add(value);
        }
      }
    }
    return new ArrayList<>(values);
  }

  private static Object sanitizeValue(Object value, int depth, IdentityHashMap<Object, Boolean> seen) {
    if (value == null) {
      return null;
    }
    if (value instanceof String || value instanceof Number || value instanceof Boolean) {
      return value;
    }
    if (value instanceof Character || value instanceof Enum<?> || value instanceof UUID || value instanceof URI) {
      return value.toString();
    }
    if (value instanceof Instant) {
      return value.toString();
    }
    if (depth <= 0) {
      return value.toString();
    }
    if (seen.containsKey(value)) {
      return "[Circular]";
    }

    seen.put(value, Boolean.TRUE);
    try {
      if (value instanceof Map<?, ?>) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
          Object item = sanitizeValue(entry.getValue(), depth - 1, seen);
          if (item != null) {
            result.put(String.valueOf(entry.getKey()), item);
          }
        }
        return result;
      }
      if (value instanceof Iterable<?>) {
        List<Object> result = new ArrayList<>();
        for (Object item : (Iterable<?>) value) {
          result.add(sanitizeValue(item, depth - 1, seen));
        }
        return result;
      }
      if (value.getClass().isArray()) {
        int length = Array.getLength(value);
        List<Object> result = new ArrayList<>(length);
        for (int index = 0; index < length; index++) {
          result.add(sanitizeValue(Array.get(value, index), depth - 1, seen));
        }
        return result;
      }
      return value.toString();
    } finally {
      seen.remove(value);
    }
  }

  private static Map<String, Object> compactMap(Map<String, ?> input) {
    if (input == null || input.isEmpty()) {
      return Collections.emptyMap();
    }

    Map<String, Object> result = new LinkedHashMap<>();
    for (Map.Entry<String, ?> entry : input.entrySet()) {
      Object value = entry.getValue();
      if (value == null) {
        continue;
      }

      if (value instanceof Map<?, ?>) {
        Map<String, Object> nested = compactMap(castObjectMap(value));
        if (!nested.isEmpty()) {
          result.put(entry.getKey(), nested);
        }
        continue;
      }

      if (value instanceof List<?>) {
        List<Object> list = compactList((List<?>) value);
        if (!list.isEmpty()) {
          result.put(entry.getKey(), list);
        }
        continue;
      }

      result.put(entry.getKey(), value);
    }
    return result;
  }

  private static List<Object> compactList(List<?> input) {
    List<Object> result = new ArrayList<>();
    for (Object value : input) {
      if (value == null) {
        continue;
      }
      if (value instanceof Map<?, ?>) {
        Map<String, Object> nested = compactMap(castObjectMap(value));
        if (!nested.isEmpty()) {
          result.add(nested);
        }
        continue;
      }
      if (value instanceof List<?>) {
        List<Object> nested = compactList((List<?>) value);
        if (!nested.isEmpty()) {
          result.add(nested);
        }
        continue;
      }
      result.add(value);
    }
    return result;
  }

  private static String stringValue(Object value) {
    return value == null ? null : String.valueOf(value);
  }

  private static Map<String, Object> mapOf(Object... values) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (int index = 0; index + 1 < values.length; index += 2) {
      result.put(String.valueOf(values[index]), values[index + 1]);
    }
    return result;
  }

  private static String toJson(Object value) {
    if (value == null) {
      return "null";
    }
    if (value instanceof String) {
      return "\"" + escapeJson((String) value) + "\"";
    }
    if (value instanceof Number || value instanceof Boolean) {
      return value.toString();
    }
    if (value instanceof Map<?, ?>) {
      StringBuilder builder = new StringBuilder("{");
      boolean first = true;
      for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
        if (!first) {
          builder.append(',');
        }
        builder.append(toJson(String.valueOf(entry.getKey())));
        builder.append(':');
        builder.append(toJson(entry.getValue()));
        first = false;
      }
      return builder.append('}').toString();
    }
    if (value instanceof Iterable<?>) {
      StringBuilder builder = new StringBuilder("[");
      boolean first = true;
      for (Object item : (Iterable<?>) value) {
        if (!first) {
          builder.append(',');
        }
        builder.append(toJson(item));
        first = false;
      }
      return builder.append(']').toString();
    }
    if (value.getClass().isArray()) {
      List<Object> items = new ArrayList<>();
      int length = Array.getLength(value);
      for (int index = 0; index < length; index++) {
        items.add(Array.get(value, index));
      }
      return toJson(items);
    }
    return toJson(String.valueOf(value));
  }

  private static String escapeJson(String value) {
    StringBuilder builder = new StringBuilder(value.length() + 16);
    for (int index = 0; index < value.length(); index++) {
      char current = value.charAt(index);
      switch (current) {
        case '\\':
          builder.append("\\\\");
          break;
        case '"':
          builder.append("\\\"");
          break;
        case '\b':
          builder.append("\\b");
          break;
        case '\f':
          builder.append("\\f");
          break;
        case '\n':
          builder.append("\\n");
          break;
        case '\r':
          builder.append("\\r");
          break;
        case '\t':
          builder.append("\\t");
          break;
        default:
          if (current < 0x20) {
            builder.append(String.format("\\u%04x", (int) current));
          } else {
            builder.append(current);
          }
      }
    }
    return builder.toString();
  }

  private static final class AuraKeeperThreadFactory implements ThreadFactory {
    private final AtomicInteger sequence = new AtomicInteger(1);

    @Override
    public Thread newThread(Runnable runnable) {
      Thread thread = new Thread(runnable, "aurakeeper-" + sequence.getAndIncrement());
      thread.setDaemon(true);
      return thread;
    }
  }

  public static final class Builder {
    private String endpoint;
    private String apiToken;
    private String serviceName;
    private String serviceVersion;
    private String environment;
    private String platform;
    private String framework;
    private String component;
    private String instanceId;
    private Duration timeout = Duration.ofSeconds(5);
    private boolean captureUncaught = true;
    private int maxWorkers = 2;
    private Map<String, String> headers = Collections.emptyMap();
    private Map<String, Object> context = Collections.emptyMap();
    private List<String> tags = Collections.emptyList();

    public Builder endpoint(String endpoint) {
      this.endpoint = endpoint;
      return this;
    }

    public Builder apiToken(String apiToken) {
      this.apiToken = apiToken;
      return this;
    }

    public Builder serviceName(String serviceName) {
      this.serviceName = serviceName;
      return this;
    }

    public Builder serviceVersion(String serviceVersion) {
      this.serviceVersion = serviceVersion;
      return this;
    }

    public Builder environment(String environment) {
      this.environment = environment;
      return this;
    }

    public Builder platform(String platform) {
      this.platform = platform;
      return this;
    }

    public Builder framework(String framework) {
      this.framework = framework;
      return this;
    }

    public Builder component(String component) {
      this.component = component;
      return this;
    }

    public Builder instanceId(String instanceId) {
      this.instanceId = instanceId;
      return this;
    }

    public Builder timeout(Duration timeout) {
      this.timeout = timeout;
      return this;
    }

    public Builder captureUncaught(boolean captureUncaught) {
      this.captureUncaught = captureUncaught;
      return this;
    }

    public Builder maxWorkers(int maxWorkers) {
      this.maxWorkers = maxWorkers <= 0 ? 1 : maxWorkers;
      return this;
    }

    public Builder headers(Map<String, String> headers) {
      this.headers = headers == null ? Collections.emptyMap() : headers;
      return this;
    }

    public Builder context(Map<String, Object> context) {
      this.context = context == null ? Collections.emptyMap() : context;
      return this;
    }

    public Builder tags(String... tags) {
      this.tags = tags == null ? Collections.emptyList() : Arrays.asList(tags);
      return this;
    }

    public Builder tags(List<String> tags) {
      this.tags = tags == null ? Collections.emptyList() : tags;
      return this;
    }

    public AuraKeeperConnector build() {
      return new AuraKeeperConnector(this);
    }
  }

  public static final class EventOverrides {
    private final String eventId;
    private final String occurredAt;
    private final String level;
    private final String platform;
    private final String environment;
    private final String type;
    private final String message;
    private final String code;
    private final String stack;
    private final Boolean handled;
    private final String correlationId;
    private final Map<String, Object> source;
    private final Map<String, Object> details;
    private final Map<String, Object> context;
    private final Map<String, Object> request;
    private final Map<String, Object> user;
    private final Map<String, Object> session;
    private final Map<String, Object> device;
    private final List<String> tags;
    private final String serviceVersion;
    private final String instanceId;

    private EventOverrides(Builder builder) {
      this.eventId = builder.eventId;
      this.occurredAt = builder.occurredAt;
      this.level = builder.level;
      this.platform = builder.platform;
      this.environment = builder.environment;
      this.type = builder.type;
      this.message = builder.message;
      this.code = builder.code;
      this.stack = builder.stack;
      this.handled = builder.handled;
      this.correlationId = builder.correlationId;
      this.source = sanitizeObjectMap(builder.source);
      this.details = sanitizeObjectMap(builder.details);
      this.context = sanitizeObjectMap(builder.context);
      this.request = sanitizeObjectMap(builder.request);
      this.user = sanitizeObjectMap(builder.user);
      this.session = sanitizeObjectMap(builder.session);
      this.device = sanitizeObjectMap(builder.device);
      this.tags = uniqueStrings(builder.tags);
      this.serviceVersion = builder.serviceVersion;
      this.instanceId = builder.instanceId;
    }

    public static Builder builder() {
      return new Builder();
    }

    private Builder toBuilder() {
      return new Builder()
          .eventId(eventId)
          .occurredAt(occurredAt)
          .level(level)
          .platform(platform)
          .environment(environment)
          .type(type)
          .message(message)
          .code(code)
          .stack(stack)
          .handled(handled)
          .correlationId(correlationId)
          .source(source)
          .details(details)
          .context(context)
          .request(request)
          .user(user)
          .session(session)
          .device(device)
          .tags(tags)
          .serviceVersion(serviceVersion)
          .instanceId(instanceId);
    }

    private String serviceVersion() {
      return serviceVersion;
    }

    private String instanceId() {
      return instanceId;
    }

    public static final class Builder {
      private String eventId;
      private String occurredAt;
      private String level;
      private String platform;
      private String environment;
      private String type;
      private String message;
      private String code;
      private String stack;
      private Boolean handled;
      private String correlationId;
      private Map<String, Object> source = Collections.emptyMap();
      private Map<String, Object> details = Collections.emptyMap();
      private Map<String, Object> context = Collections.emptyMap();
      private Map<String, Object> request = Collections.emptyMap();
      private Map<String, Object> user = Collections.emptyMap();
      private Map<String, Object> session = Collections.emptyMap();
      private Map<String, Object> device = Collections.emptyMap();
      private List<String> tags = Collections.emptyList();
      private String serviceVersion;
      private String instanceId;

      public Builder eventId(String eventId) {
        this.eventId = eventId;
        return this;
      }

      public Builder occurredAt(String occurredAt) {
        this.occurredAt = occurredAt;
        return this;
      }

      public Builder level(String level) {
        this.level = level;
        return this;
      }

      public Builder platform(String platform) {
        this.platform = platform;
        return this;
      }

      public Builder environment(String environment) {
        this.environment = environment;
        return this;
      }

      public Builder type(String type) {
        this.type = type;
        return this;
      }

      public Builder message(String message) {
        this.message = message;
        return this;
      }

      public Builder code(String code) {
        this.code = code;
        return this;
      }

      public Builder stack(String stack) {
        this.stack = stack;
        return this;
      }

      public Builder handled(Boolean handled) {
        this.handled = handled;
        return this;
      }

      public Builder correlationId(String correlationId) {
        this.correlationId = correlationId;
        return this;
      }

      public Builder source(Map<String, Object> source) {
        this.source = source == null ? Collections.emptyMap() : source;
        return this;
      }

      public Builder details(Map<String, Object> details) {
        this.details = details == null ? Collections.emptyMap() : details;
        return this;
      }

      public Builder context(Map<String, Object> context) {
        this.context = context == null ? Collections.emptyMap() : context;
        return this;
      }

      public Builder request(Map<String, Object> request) {
        this.request = request == null ? Collections.emptyMap() : request;
        return this;
      }

      public Builder user(Map<String, Object> user) {
        this.user = user == null ? Collections.emptyMap() : user;
        return this;
      }

      public Builder session(Map<String, Object> session) {
        this.session = session == null ? Collections.emptyMap() : session;
        return this;
      }

      public Builder device(Map<String, Object> device) {
        this.device = device == null ? Collections.emptyMap() : device;
        return this;
      }

      public Builder tags(String... tags) {
        this.tags = tags == null ? Collections.emptyList() : Arrays.asList(tags);
        return this;
      }

      public Builder tags(List<String> tags) {
        this.tags = tags == null ? Collections.emptyList() : tags;
        return this;
      }

      public Builder serviceVersion(String serviceVersion) {
        this.serviceVersion = serviceVersion;
        return this;
      }

      public Builder instanceId(String instanceId) {
        this.instanceId = instanceId;
        return this;
      }

      public EventOverrides build() {
        return new EventOverrides(this);
      }
    }
  }

  public static final class TransportResponse {
    private final int statusCode;
    private final String body;

    private TransportResponse(int statusCode, String body) {
      this.statusCode = statusCode;
      this.body = body;
    }

    public int statusCode() {
      return statusCode;
    }

    public String body() {
      return body;
    }
  }
}
