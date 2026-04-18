# AuraKeeper Python Connector

Generic Python connector for sending application errors to AuraKeeper's
`POST /v1/logs/errors` endpoint.

## Features

- Automatic process-level capture with `sys.excepthook`
- Automatic thread-level capture with `threading.excepthook`
- Manual capture for handled exceptions and messages
- Payloads normalized to the schema in [`openapi.yaml`](../../openapi.yaml)
- No external dependencies

## Files

- [`aurakeeper/`](./aurakeeper): installable connector package
- [`examples/`](./examples): standalone setup example

## Install

```bash
pip install ./connectors/python
```

## Usage

```python
from aurakeeper import create_aurakeeper_connector


connector = create_aurakeeper_connector(
    endpoint="https://api.example.com/v1/logs/errors",
    api_token="your-api-token",
    service_name="python-worker",
    service_version="1.0.0",
    environment="production",
    framework="fastapi",
    component="billing",
    tags=["backend"],
)

connector.install()

try:
    raise ValueError("Handled Python error")
except ValueError as error:
    future = connector.capture_exception(
        error,
        handled=True,
        level="error",
        correlation_id="job_123",
        details={"job_name": "reconcile-payments"},
    )
    future.result()

connector.flush()
connector.close()
```

## Options

- `endpoint`: Full AuraKeeper ingestion URL
- `api_token`: API token sent as `X-API-Token`
- `service_name`: Required logical service name
- `service_version`: Optional application version or build id
- `environment`: Optional environment such as `production`
- `platform_name`: Optional override for `backend`, `worker`, `cli`, etc.
- `framework`: Optional framework name included in `source.framework`
- `component`: Optional component name included in `source.component`
- `instance_id`: Optional service instance identifier
- `tags`: Optional tags appended to `context.tags`
- `context`: Optional shared context merged into every event
- `headers`: Optional additional HTTP headers
- `timeout`: Request timeout in seconds for the default transport
- `transport`: Optional custom transport callable
- `before_send`: Optional hook to mutate or drop a payload before it is sent
- `on_transport_error`: Optional callback used by automatic hook capture
- `capture_uncaught`: Disable `sys.excepthook` capture with `False`
- `capture_threads`: Disable `threading.excepthook` capture with `False`

## Notes

- `capture_exception()` and `capture_message()` submit work in a thread pool and
  return a `Future`.
- `flush()` waits for all in-flight sends and returns settled statuses similar to
  JavaScript's `Promise.allSettled()`.
- `close()` optionally waits for in-flight work, restores hooks, and shuts down
  the thread pool.
- The transport callable receives a config dictionary with `endpoint`,
  `api_token`, `apiToken`, `payload`, `headers`, and `timeout`.
- Full example setup is available in [`examples/standalone`](./examples/standalone).
