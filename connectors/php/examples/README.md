# AuraKeeper PHP Examples

## Files

- [`basic.php`](./basic.php): CLI-style manual capture with a custom transport
- [`web/index.php`](./web/index.php): small web entrypoint with automatic hooks

## Run

CLI example:

```bash
php connectors/php/examples/basic.php
```

Web example:

```bash
php -S 127.0.0.1:8000 -t connectors/php/examples/web
```

Then visit `http://127.0.0.1:8000`.
