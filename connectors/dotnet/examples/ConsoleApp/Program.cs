using AuraKeeper;

var endpoint = Environment.GetEnvironmentVariable("AURAKEEPER_ENDPOINT")
    ?? "https://api.example.com/v1/logs/errors";
var apiToken = Environment.GetEnvironmentVariable("AURAKEEPER_API_TOKEN")
    ?? "replace-me";

await using var connector = new AuraKeeperConnector(new AuraKeeperConnectorOptions
{
    Endpoint = new Uri(endpoint),
    ApiToken = apiToken,
    ServiceName = "dotnet-console-example",
    ServiceVersion = "2026.04.18",
    Environment = "development",
    Framework = "dotnet",
    Component = "console",
    Tags = ["backend", "dotnet"]
});

connector.Install();

try
{
    throw new InvalidOperationException("Handled example error");
}
catch (Exception error)
{
    var result = await connector.CaptureExceptionAsync(
        error,
        new AuraKeeperCaptureOptions
        {
            Handled = true,
            Level = "error",
            Request = new Dictionary<string, object?>
            {
                ["path"] = "ConsoleApp.Main"
            },
            Details = new Dictionary<string, object?>
            {
                ["example"] = true
            }
        });

    Console.WriteLine($"AuraKeeper response: {(int?)result?.StatusCode} {result?.Body}");
}

await connector.FlushAsync();
