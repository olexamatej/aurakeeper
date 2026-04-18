# AuraKeeper Ruby Connector

Generic Ruby connector for sending application errors to AuraKeeper's
`POST /v1/logs/errors` endpoint.

## Features

- Manual capture for handled exceptions and messages
- Automatic process-level uncaught exception capture with `at_exit`
- Payloads normalized to the schema in [`openapi.yaml`](../../openapi.yaml)
- No external dependencies

## Files

- [`lib/aurakeeper.rb`](./lib/aurakeeper.rb): connector implementation
- [`aurakeeper.gemspec`](./aurakeeper.gemspec): gem metadata
- [`examples/standalone/main.rb`](./examples/standalone/main.rb): standalone example

## Install

With Bundler:

```ruby
gem "aurakeeper", path: "./connectors/ruby"
```

Or build the gem directly:

```bash
gem build connectors/ruby/aurakeeper.gemspec
gem install ./aurakeeper-0.1.0.gem
```

## Usage

```ruby
require "aurakeeper"

connector = AuraKeeper.create_aurakeeper_connector(
  endpoint: "https://api.example.com/v1/logs/errors",
  api_token: ENV.fetch("AURAKEEPER_API_TOKEN"),
  service_name: "ruby-worker",
  service_version: "1.0.0",
  environment: "production",
  framework: "rails",
  component: "billing",
  tags: ["backend"]
)

connector.install

begin
  raise ArgumentError, "Handled Ruby error"
rescue => error
  connector.capture_exception(
    error,
    handled: true,
    level: "error",
    correlation_id: "job_123",
    details: { job_name: "reconcile-payments" }
  )
end

connector.close
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
- `capture_uncaught`: Disable process-level uncaught capture with `false`

## Notes

- `capture_exception()` and `capture_message()` send synchronously and return the parsed transport response.
- `install()` registers an `at_exit` hook that sends uncaught process-level exceptions when possible. It intentionally does not try to intercept all thread failures.
- The transport callable receives a config hash with `:endpoint`, `:api_token`, `:apiToken`, `:payload`, `:headers`, and `:timeout`.
