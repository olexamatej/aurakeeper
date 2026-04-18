# AuraKeeper PHP Examples

## Files

- [`runtime-error.php`](./runtime-error.php): broken profile renderer sent to a real AuraKeeper backend
- [`basic.php`](./basic.php): CLI-style manual capture with a custom transport
- [`web/index.php`](./web/index.php): small web entrypoint with automatic hooks

## Run

Runtime error example:

```bash
AURAKEEPER_API_TOKEN=<project-token> \
php connectors/php/examples/runtime-error.php
```

The endpoint defaults to `http://127.0.0.1:3000/v1/logs/errors`. Set
`AURAKEEPER_ENDPOINT` to override it.

The verification command currently fails until the guest fallback is fixed:

```bash
php connectors/php/examples/profile_test.php
```

Web example:

```bash
php -S 127.0.0.1:8000 -t connectors/php/examples/web
```

Then visit `http://127.0.0.1:8000`.
