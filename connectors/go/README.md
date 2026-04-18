# AuraKeeper Go Connector

Minimal Go connector for sending errors to AuraKeeper's `POST /v1/logs/errors`
endpoint.

## Features

- Manual error and message capture
- `net/http` helper for handled request errors
- Recovery middleware that captures panics and returns `500`
- Payloads aligned with [`openapi.yaml`](../../openapi.yaml)
- Standard library only

## Files

- [`aurakeeper.go`](./aurakeeper.go): connector implementation
- [`examples/`](./examples): runnable setup examples

## Install

Use the connector directly from this repository:

```bash
go test ./connectors/go/...
```

## Usage

```go
package main

import (
	"context"
	"log"

	aurakeeper "github.com/aurakeeper/aurakeeper/connectors/go"
)

func main() {
	connector, err := aurakeeper.New(aurakeeper.Options{
		Endpoint:       "https://api.example.com/v1/logs/errors",
		APIToken:       "your-api-token",
		ServiceName:    "go-api",
		ServiceVersion: "1.0.0",
		Environment:    "production",
		Framework:      "net/http",
		Component:      "payments",
		Tags:           []string{"backend", "go"},
	})
	if err != nil {
		log.Fatal(err)
	}

	_, err = connector.CaptureMessage(context.Background(), "manual capture from Go", aurakeeper.CaptureOptions{
		Level:   "warning",
		Handled: aurakeeper.Bool(true),
		Details: map[string]any{
			"jobName": "reconcile-payments",
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
```

## HTTP helpers

Use `CaptureHTTPError()` for handled request errors when you already have an
`*http.Request`.

Use `Middleware()` to recover panics, send a `critical` event with request
context, and return `500 Internal Server Error`.

## Example

Run the example server from the connector directory:

```bash
cd connectors/go
AURAKEEPER_ENDPOINT=http://localhost:8787/v1/logs/errors \
AURAKEEPER_API_TOKEN=your-token \
go run ./examples/http
```

See [`examples/README.md`](./examples/README.md) for the example setup and
runtime notes.

Then visit:

- `GET /handled` to send a handled request error
- `GET /panic` to trigger panic recovery middleware
