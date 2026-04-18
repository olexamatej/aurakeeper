# JavaScript Connector Examples

## Node.js broken mini-project

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

The script installs the connector and renders a profile object missing nested
profile data. That realistic bug raises a runtime exception which AuraKeeper can
ingest.

The verification command currently fails until the fallback behavior is fixed:

```sh
node node/profile.test.js
```

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
