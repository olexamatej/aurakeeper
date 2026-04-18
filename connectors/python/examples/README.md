# Python Connector Examples

Run these from this directory with Python.

## Uncaught thread exception

```sh
AURAKEEPER_API_TOKEN=your-token python3 standalone/main.py
```

Optional:

```sh
AURAKEEPER_ENDPOINT=http://127.0.0.1:3000/v1/logs/errors \
  AURAKEEPER_API_TOKEN=your-token \
  python3 standalone/main.py
```

The example installs the connector, triggers an uncaught thread exception, and
flushes before shutdown.
