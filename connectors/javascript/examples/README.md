# JavaScript Connector Examples

## Node.js runtime error

Run the Node example from this directory:

```sh
AURAKEEPER_API_TOKEN=your-token \
  node node/index.js
```

Optional:

```sh
AURAKEEPER_ENDPOINT=http://127.0.0.1:3000/v1/logs/errors \
  AURAKEEPER_API_TOKEN=your-token \
  node node/index.js
```

The script installs the connector, triggers an uncaught exception, and lets the
connector drain before the process exits.

## Browser demo

Serve the folder and open the HTML file:

```sh
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/browser/index.html
```

Set `window.AURAKEEPER_API_TOKEN` in the page before using the buttons. The
browser example installs automatic `error` and `unhandledrejection` handlers
and can capture handled exceptions manually.
