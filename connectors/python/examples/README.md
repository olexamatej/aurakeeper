# Python Connector Examples

Run these from this directory with Python.

## Broken invoice worker

```sh
AURAKEEPER_API_TOKEN=your-token python3 standalone/main.py
```

Optional:

```sh
AURAKEEPER_ENDPOINT=http://127.0.0.1:3000/v1/logs/errors \
  AURAKEEPER_API_TOKEN=your-token \
  python3 standalone/main.py
```

The example installs the connector and processes an invoice missing customer
data. That realistic bug raises an uncaught thread exception and flushes before
shutdown.

The verification command currently fails until the guest fallback is fixed:

```sh
python3 standalone/test_app.py
```
