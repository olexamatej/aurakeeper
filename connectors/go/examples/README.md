# Go Example

The HTTP example listens on a configurable app port and raises a runtime panic
at a configurable path so the connector middleware can send the error to
AuraKeeper.

Run it from `connectors/go`:

```bash
AURAKEEPER_ENDPOINT=http://127.0.0.1:3000/v1/logs/errors \
AURAKEEPER_API_TOKEN=your-token \
AURAKEEPER_APP_PORT=8080 \
AURAKEEPER_PANIC_PATH=/panic \
go run ./examples/http
```

Then visit `http://127.0.0.1:8080/panic` to trigger the runtime error.
