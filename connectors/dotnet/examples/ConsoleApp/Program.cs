using AuraKeeper;

if (args.Contains("--verify"))
{
    VerifyProfileFallback();
    return;
}

var endpoint = Environment.GetEnvironmentVariable("AURAKEEPER_ENDPOINT")
    ?? "http://127.0.0.1:3000/v1/logs/errors";
var apiToken = Environment.GetEnvironmentVariable("AURAKEEPER_API_TOKEN")
    ?? throw new InvalidOperationException("Set AURAKEEPER_API_TOKEN before running this example");

await using var connector = new AuraKeeperConnector(new AuraKeeperConnectorOptions
{
    Endpoint = new Uri(endpoint),
    ApiToken = apiToken,
    ServiceName = "dotnet-runtime-example",
    ServiceVersion = "2026.04.18",
    Environment = "development",
    Framework = "dotnet",
    Component = "console",
    Tags = ["backend", "dotnet"]
});

connector.Install();
RenderProfile(new Dictionary<string, object?>
{
    ["id"] = "guest"
});

static string RenderProfile(Dictionary<string, object?> user)
{
    var profile = (Dictionary<string, object?>)user["profile"]!;
    return $"Profile: {((string)profile["displayName"]!).ToUpperInvariant()}";
}

static void VerifyProfileFallback()
{
    var actual = RenderProfile(new Dictionary<string, object?>
    {
        ["id"] = "guest"
    });
    const string expected = "Profile: GUEST";

    if (actual != expected)
    {
        throw new InvalidOperationException($"Expected {expected}, got {actual}");
    }

    Console.WriteLine(".NET profile tests passed");
}
