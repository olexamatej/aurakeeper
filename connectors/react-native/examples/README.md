# React Native Examples

These examples show a minimal Expo-compatible setup for the AuraKeeper
connector.

## Basic App Example

[`basic/App.js`](./basic/App.js) wires the connector into a single screen,
reads the backend endpoint and API token from Expo env vars, installs the
global `ErrorUtils` hook, and exposes a button that throws an unhandled
JavaScript error.

## Run

```bash
npm install
EXPO_PUBLIC_AURAKEEPER_ENDPOINT=https://api.example.com/v1/logs/errors \
EXPO_PUBLIC_AURAKEEPER_API_TOKEN=ak_your_token \
npm start
```

Use `npm run android`, `npm run ios`, or `npm run web` for a direct target.
