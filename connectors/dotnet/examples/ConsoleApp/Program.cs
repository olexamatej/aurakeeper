using AuraKeeper;

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
throw new InvalidOperationException("Uncaught .NET runtime example");
