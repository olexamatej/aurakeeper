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

## Broken task-planner mini-project

```sh
AURAKEEPER_API_TOKEN=your-token node uncaught.js
```

Optional:

```sh
AURAKEEPER_ENDPOINT=http://127.0.0.1:3000/v1/logs/errors \
  AURAKEEPER_API_TOKEN=your-token \
  node uncaught.js
```

This example installs the process hooks and formats a task missing assignee
data. That realistic bug raises an uncaught exception and lets the connector
drain the send before the process dies.

The verification command currently fails until the fallback behavior is fixed:

```sh
node task-planner.test.js
```
