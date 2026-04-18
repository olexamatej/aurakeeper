# JavaScript Connector Examples

These examples show the recommended setup for the generic JavaScript connector
in browser and Node.js runtimes.

## Files

- [`browser/index.html`](./browser/index.html): browser demo page
- [`browser/app.js`](./browser/app.js): browser connector setup
- [`node/index.js`](./node/index.js): Node.js connector setup

## Browser

Open [`browser/index.html`](./browser/index.html) in a browser after replacing
the placeholder AuraKeeper endpoint and API token in
[`browser/app.js`](./browser/app.js).

If you leave the placeholder values unchanged, the example uses a mock
transport and logs payloads locally instead of sending them.

The browser example:

- Installs automatic `error` and `unhandledrejection` handlers
- Captures handled exceptions manually
- Adds request, user, session, and tag context from the page

## Node.js

Run the Node.js example from this directory:

```sh
node node/index.js
```

Set these variables before running it against a real AuraKeeper environment:

- `AURAKEEPER_ENDPOINT`
- `AURAKEEPER_API_TOKEN`
- `NODE_ENV`

Without real values, the Node.js example also falls back to a mock transport and
prints the normalized payload locally.

The Node.js example:

- Installs automatic `uncaughtException` and `unhandledRejection` handlers
- Captures a handled error from an async job
- Flushes in-flight requests before process shutdown
