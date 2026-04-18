# AuraKeeper React Native Connector

React Native connector for sending mobile application errors to AuraKeeper's
`POST /v1/logs/errors` endpoint.

## Features

- Manual capture for handled exceptions and messages
- Automatic JavaScript global error capture through React Native's `ErrorUtils`
  when it is available
- React Native device and session context collected without external dependencies
- Payloads normalized to the schema in [`openapi.yaml`](../../openapi.yaml)
- No external connector dependencies

## Files

- [`aurakeeper.js`](./aurakeeper.js): standalone connector module
- [`examples/`](./examples): basic React Native integration example

## Usage

```js
import { AppState, Dimensions, NativeModules, Platform } from "react-native";

const {
  createAuraKeeperReactNativeConnector,
} = require("./aurakeeper");

const connector = createAuraKeeperReactNativeConnector({
  endpoint: "https://api.example.com/v1/logs/errors",
  apiToken: "your-api-token",
  serviceName: "mobile-app",
  serviceVersion: "2026.04.18",
  environment: "production",
  component: "root-navigation",
  tags: ["mobile", "react-native"],
  reactNative: {
    AppState,
    Dimensions,
    NativeModules,
    Platform,
  },
});

connector.install();

try {
  throw new Error("Handled React Native error");
} catch (error) {
  connector.captureException(error, {
    handled: true,
    level: "error",
    user: {
      id: "user_42",
    },
    session: {
      activeScreen: "Settings",
    },
    details: {
      action: "save-profile",
    },
  });
}
```

## Options

- `endpoint`: Full AuraKeeper ingestion URL
- `apiToken`: API token sent as `X-API-Token`
- `serviceName`: Required logical service name
- `serviceVersion`: Optional application version or build id
- `environment`: Optional environment such as `production`
- `platform`: Optional override for the top-level platform, defaults to `mobile`
- `language`: Optional override for `source.language`, defaults to `javascript`
- `framework`: Optional override for `source.framework`, defaults to
  `react-native`
- `component`: Optional component name included in `source.component`
- `instanceId`: Optional service instance identifier
- `tags`: Optional tags appended to `context.tags`
- `context`: Optional shared context merged into every event
- `reactNative`: Optional object containing `Platform`, `AppState`,
  `Dimensions`, and `NativeModules` from `react-native`; the connector will
  attempt `require("react-native")` when this is omitted
- `headers`: Optional additional HTTP headers
- `fetch`: Optional fetch implementation override
- `transport`: Optional custom transport function
- `beforeSend`: Optional hook to mutate or drop a payload before it is sent
- `onTransportError`: Optional callback for send failures
- `captureReactNative`: Disable global React Native auto-capture with `false`
- `callPreviousHandler`: Disable delegation back to the previous React Native
  global error handler with `false`
- `globalErrorDetails`: Optional detail fields merged into auto-captured global
  error events

## Notes

- Automatic capture is limited to JavaScript global exceptions exposed through
  `ErrorUtils`. Native crashes and unhandled promise rejections still need
  separate instrumentation.
- The connector adds mobile-focused context under `context.device` and
  `context.session` when React Native runtime modules are available.
- `captureException()` and `captureMessage()` return a promise for the network
  request. Use `flush()` before app teardown flows when you need to await
  in-flight sends.
- Full example setup is available in [`examples/basic`](./examples/basic).
