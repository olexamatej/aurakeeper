import com.aurakeeper.AuraKeeperConnector;
import java.time.Duration;
import java.util.Map;

public final class Main {
  private Main() {
  }

  public static void main(String[] args) {
    AuraKeeperConnector connector = AuraKeeperConnector.builder()
        .endpoint("https://api.example.com/v1/logs/errors")
        .apiToken(System.getenv("AURAKEEPER_API_TOKEN"))
        .serviceName("jvm-worker")
        .serviceVersion("1.0.0")
        .environment("development")
        .component("example")
        .timeout(Duration.ofSeconds(5))
        .captureUncaught(true)
        .build();

    connector.install();

    try {
      throw new IllegalArgumentException("Handled example exception");
    } catch (Exception error) {
      connector.captureException(
          error,
          AuraKeeperConnector.EventOverrides.builder()
              .handled(true)
              .level("error")
              .details(Map.of("example", true))
              .build()
      ).join();
    }

    connector.close();
  }
}
