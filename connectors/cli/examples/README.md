# CLI Examples

Run these from this directory with Node.js.

## Handled command failure

```sh
AURAKEEPER_API_TOKEN=your-token node basic.js
```

Optional:

```sh
AURAKEEPER_ENDPOINT=http://127.0.0.1:3000/v1/logs/errors \
  AURAKEEPER_API_TOKEN=your-token \
  node basic.js
```

This example captures a failed subprocess and flushes the event before exit.

## Uncaught exception

```sh
AURAKEEPER_API_TOKEN=your-token node uncaught.js
```

Optional:

```sh
AURAKEEPER_ENDPOINT=http://127.0.0.1:3000/v1/logs/errors \
  AURAKEEPER_API_TOKEN=your-token \
  node uncaught.js
```

This example installs the process hooks, triggers an uncaught exception, and
lets the connector drain the send before the process dies.
