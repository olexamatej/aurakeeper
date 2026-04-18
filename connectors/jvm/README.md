# AuraKeeper JVM Connector

Minimal Java 11+ connector for sending handled and uncaught JVM exceptions to
AuraKeeper's `POST /v1/logs/errors` endpoint.

## Features

- Manual capture for handled exceptions and messages
- Optional process-wide uncaught-exception capture via
  `Thread.setDefaultUncaughtExceptionHandler(...)`
- Payloads aligned with [`openapi.yaml`](../../openapi.yaml)
- No external runtime dependencies

## Files

- [`src/main/java/com/aurakeeper/AuraKeeperConnector.java`](./src/main/java/com/aurakeeper/AuraKeeperConnector.java):
  standalone connector implementation
- [`examples/`](./examples): standalone usage example
- [`pom.xml`](./pom.xml): Maven metadata for local builds

## Build

```bash
mvn -q -f connectors/jvm/pom.xml package
```

## Usage

```java
import com.aurakeeper.AuraKeeperConnector;
import java.time.Duration;
import java.util.Map;

public class Main {
  public static void main(String[] args) {
    AuraKeeperConnector connector = AuraKeeperConnector.builder()
        .endpoint("https://api.example.com/v1/logs/errors")
        .apiToken(System.getenv("AURAKEEPER_API_TOKEN"))
        .serviceName("billing-worker")
        .serviceVersion("1.0.0")
        .environment("production")
        .framework("spring")
        .component("payments")
        .tags("backend", "billing")
        .timeout(Duration.ofSeconds(5))
        .captureUncaught(true)
        .build();

    connector.install();

    try {
      throw new IllegalStateException("Handled JVM error");
    } catch (Exception error) {
      connector.captureException(
          error,
          AuraKeeperConnector.EventOverrides.builder()
              .handled(true)
              .level("error")
              .correlationId("job_123")
              .details(Map.of("jobName", "reconcile-payments"))
              .request(Map.of("method", "POST", "path", "/jobs/reconcile"))
              .build()
      ).join();
    }

    connector.close();
  }
}
```

## Options

- `endpoint`: Full AuraKeeper ingestion URL
- `apiToken`: API token sent as `X-API-Token`
- `serviceName`: Required logical service name
- `serviceVersion`: Optional application version or build id
- `environment`: Optional environment such as `production`
- `platform`: Optional override for `backend`, `worker`, `cli`, etc.
- `framework`: Optional framework name included in `source.framework`
- `component`: Optional component name included in `source.component`
- `instanceId`: Optional service instance identifier
- `timeout`: Request timeout for the built-in JDK HTTP transport
- `headers`: Optional additional HTTP headers
- `tags`: Optional tags appended to `context.tags`
- `context`: Optional shared context merged into every event
- `captureUncaught`: Enables uncaught-exception capture when `install()` is called

## Notes

- The connector defaults to `platform=backend`, `source.runtime=jvm`, and
  `source.language=java`.
- `captureException(...)` and `captureMessage(...)` send asynchronously and
  return a `CompletableFuture`.
- Uncaught exceptions are sent synchronously in the default handler so the
  process has a chance to emit the event before shutdown.
- Full example setup is available in [`examples/standalone`](./examples/standalone).
