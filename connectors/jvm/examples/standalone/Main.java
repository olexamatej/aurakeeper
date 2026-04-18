import com.aurakeeper.AuraKeeperConnector;
import java.time.Duration;
import java.util.Map;

public final class Main {
  private Main() {
  }

  public static void main(String[] args) {
    if (args.length > 0 && "--verify".equals(args[0])) {
      verifyProfileFallback();
      return;
    }

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
    renderProfile(Map.of("id", "guest"));
  }

  private static String renderProfile(Map<String, Object> user) {
    @SuppressWarnings("unchecked")
    Map<String, Object> profile = (Map<String, Object>) user.get("profile");
    return "Profile: " + ((String) profile.get("displayName")).toUpperCase();
  }

  private static void verifyProfileFallback() {
    String actual = renderProfile(Map.of("id", "guest"));
    String expected = "Profile: GUEST";

    if (!expected.equals(actual)) {
      throw new AssertionError("Expected " + expected + ", got " + actual);
    }

    System.out.println("jvm profile tests passed");
  }

  private static String requireEnv(String name) {
    String value = System.getenv(name);
    if (value == null || value.isBlank()) {
      throw new IllegalStateException("Set " + name + " before running this example");
    }
    return value;
  }
}
