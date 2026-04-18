# .NET Examples

- [`ConsoleApp`](./ConsoleApp): minimal console app that installs the runtime
  hooks and throws an unhandled exception.

Run it from the repository root:

```bash
AURAKEEPER_ENDPOINT=http://127.0.0.1:3000/v1/logs/errors \
AURAKEEPER_API_TOKEN=your-token \
dotnet run --project connectors/dotnet/examples/ConsoleApp/ConsoleApp.csproj
```
