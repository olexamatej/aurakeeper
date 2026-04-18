# AuraKeeper JavaScript Connector

Generic JavaScript connector for sending application errors to AuraKeeper's
`POST /v1/logs/errors` endpoint.

## Features

- Automatic browser capture with `error` and `unhandledrejection`
- Automatic Node.js capture with `uncaughtException` and `unhandledRejection`
- Manual capture for handled exceptions
- Payloads normalized to the schema in [`openapi.yaml`](../../openapi.yaml)
- No external dependencies

## Files

- [`aurakeeper.js`](./aurakeeper.js): standalone connector module

## Browser

```html
<script src="./aurakeeper.js"></script>
<script>
  const connector = AuraKeeper.createAuraKeeperConnector({
    endpoint: "https://api.example.com/v1/logs/errors",
    apiToken: "your-api-token",
    serviceName: "web-app",
    serviceVersion: "2026.04.18",
    environment: "production",
    framework: "vanilla-js",
    component: "frontend",
    tags: ["frontend"],
  });

  connector.install();

  try {
    throw new Error("Handled UI error");
  } catch (error) {
    connector.captureException(error, {
      handled: true,
      request: {
        path: window.location.pathname,
      },
      user: {
        id: "user_42",
      },
    });
  }
</script>
```

## Node.js

```js
const {
  createAuraKeeperConnector,
} = require("./aurakeeper");

const connector = createAuraKeeperConnector({
  endpoint: "https://api.example.com/v1/logs/errors",
  apiToken: process.env.AURAKEEPER_API_TOKEN,
  serviceName: "worker-service",
  serviceVersion: "1.4.2",
  environment: process.env.NODE_ENV || "development",
  framework: "express",
  component: "jobs",
  tags: ["backend"],
});

connector.install();

async function runJob() {
  try {
    throw new Error("Handled background job error");
  } catch (error) {
    await connector.captureException(error, {
      handled: true,
      correlationId: "job_123",
      details: {
        jobName: "reconcile-payments",
      },
    });
  }
}

runJob().finally(() => connector.flush());
```

## Options

- `endpoint`: Full AuraKeeper ingestion URL
- `apiToken`: API token sent as `X-API-Token`
- `serviceName`: Required logical service name
- `serviceVersion`: Optional application version or build id
- `environment`: Optional environment such as `production`
- `platform`: Optional override for `web`, `backend`, `worker`, `cli`, etc.
- `framework`: Optional framework name included in `source.framework`
- `component`: Optional component name included in `source.component`
- `instanceId`: Optional service instance identifier
- `tags`: Optional tags appended to `context.tags`
- `context`: Optional shared context merged into every event
- `headers`: Optional additional HTTP headers
- `fetch`: Optional fetch implementation override
- `transport`: Optional custom transport function
- `beforeSend`: Optional hook to mutate or drop a payload before it is sent
- `onTransportError`: Optional callback for send failures
- `captureBrowser`: Disable browser auto-capture with `false`
- `captureNode`: Disable Node.js auto-capture with `false`

## Notes

- The default transport uses `fetch`. In older Node.js runtimes, pass
  `fetch` explicitly or provide a custom `transport`.
- Automatic runtime hooks are fire-and-forget. Use `flush()` before shutdown if
  you need to wait for in-flight sends to complete.
