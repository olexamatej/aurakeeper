# AuraKeeper Next.js Connector

Next.js-focused JavaScript connector for sending application errors to
AuraKeeper's `POST /v1/logs/errors` endpoint.

It wraps the generic JavaScript connector in [`../javascript`](../javascript)
and adds a small set of Next.js-specific defaults and helpers:

- defaults `source.framework` to `next.js`
- defaults `platform` to `web`
- tags events with `nextjs`
- adds route, request, build id, and Next.js error digest context when available
- provides a route-handler wrapper for App Router handlers

## Files

- [`index.js`](./index.js): connector implementation
- [`examples/`](./examples): minimal setup examples

## Install

```bash
npm install ./connectors/nextjs
```

## Usage

```js
const {
  createAuraKeeperNextJsConnector,
} = require("./index");

const connector = createAuraKeeperNextJsConnector({
  endpoint: "https://api.example.com/v1/logs/errors",
  apiToken: process.env.AURAKEEPER_API_TOKEN,
  serviceName: "aura-web",
  environment: process.env.NODE_ENV || "development",
  component: "app-router",
});

const GET = connector.wrapRouteHandler(async function GET(request) {
  throw new Error("Route failed");
});
```

## Client Example

```js
const {
  createAuraKeeperNextJsConnector,
} = require("./index");

const connector = createAuraKeeperNextJsConnector({
  endpoint: "https://api.example.com/v1/logs/errors",
  apiToken: "your-api-token",
  serviceName: "aura-web",
  environment: "production",
  component: "client",
});

connector.install();

try {
  throw new Error("Handled client error");
} catch (error) {
  connector.captureClientError(error, null, {
    handled: true,
  });
}
```

## API

- `createAuraKeeperNextJsConnector(options)`: create a connector instance
- `install()`: enables browser `error` and `unhandledrejection` capture
- `captureException(error, overrides)`: send a manual error event with Next.js
  request/build context when available
- `captureClientError(error, errorInfo, overrides)`: send an error from a client
  error boundary or client component
- `wrapRouteHandler(handler, defaults)`: wrap an App Router route handler and
  capture uncaught errors before rethrowing them
- `flush()`: wait for in-flight sends

## Notes

- `captureNode` defaults to `false` to avoid noisy process-level duplication on
  the server. Set it explicitly if you want Node.js process hooks.
- Route, digest, and build id are stored under `error.details`, while request
  metadata is stored under `context.request`, matching the existing API shape in
  [`openapi.yaml`](../../openapi.yaml).
