import com.aurakeeper.AuraKeeperConnector;
import java.time.Duration;

public final class Main {
  private Main() {
  }

  public static void main(String[] args) {
    String endpoint = System.getenv().getOrDefault(
        "AURAKEEPER_ENDPOINT",
        "http://127.0.0.1:3000/v1/logs/errors");
    String apiToken = requireEnv("AURAKEEPER_API_TOKEN");

    AuraKeeperConnector connector = AuraKeeperConnector.builder()
        .endpoint(endpoint)
        .apiToken(apiToken)
        .serviceName("jvm-runtime-example")
        .serviceVersion("1.0.0")
        .environment("development")
        .component("example")
        .timeout(Duration.ofSeconds(5))
        .captureUncaught(true)
        .build();

    connector.install();
    throw new RuntimeException("Uncaught JVM runtime example");
  }

  private static String requireEnv(String name) {
    String value = System.getenv(name);
    if (value == null || value.isBlank()) {
      throw new IllegalStateException("Set " + name + " before running this example");
    }
    return value;
  }
}
