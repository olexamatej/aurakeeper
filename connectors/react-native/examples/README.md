# React Native Examples

These examples show a minimal React Native setup for the AuraKeeper connector.

## Basic App Example

[`basic/App.js`](./basic/App.js) wires the connector into a single screen,
installs the global `ErrorUtils` hook, and demonstrates:

- manual handled exception capture
- manual message capture
- an unhandled JavaScript exception path for validating automatic capture

Replace the placeholder AuraKeeper endpoint and API token in
[`basic/App.js`](./basic/App.js) before sending data to a real environment.
