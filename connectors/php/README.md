# AuraKeeper PHP Connector

Generic PHP connector for sending application errors to AuraKeeper's
`POST /v1/logs/errors` endpoint.

## Features

- Manual `captureException()` and `captureMessage()` APIs
- Automatic `set_exception_handler`, `set_error_handler`, and shutdown capture
- Payloads normalized to the schema in [`openapi.yaml`](../../openapi.yaml)
- No external runtime dependencies

## Files

- [`aurakeeper.php`](./aurakeeper.php): standalone connector module
- [`composer.json`](./composer.json): local package metadata
- [`examples/`](./examples): CLI and web setup examples

## Usage

```php
<?php

require __DIR__ . '/aurakeeper.php';

$connector = AuraKeeper\create_aurakeeper_connector([
    'endpoint' => 'https://api.example.com/v1/logs/errors',
    'apiToken' => 'your-api-token',
    'serviceName' => 'php-api',
    'serviceVersion' => '1.0.0',
    'environment' => 'production',
    'framework' => 'laravel',
    'component' => 'billing',
    'tags' => ['backend', 'php'],
]);

$connector->install();

try {
    throw new RuntimeException('Handled PHP error');
} catch (Throwable $error) {
    $connector->captureException($error, [
        'handled' => true,
        'level' => 'error',
        'correlationId' => 'job_123',
        'details' => [
            'jobName' => 'reconcile-payments',
        ],
    ]);
}

$connector->close();
```

## Options

- `endpoint`: Full AuraKeeper ingestion URL
- `apiToken`: API token sent as `X-API-Token`
- `serviceName`: Required logical service name
- `serviceVersion`: Optional application version or build id
- `environment`: Optional environment such as `production`
- `platform`: Optional override for `backend`, `worker`, or `cli`
- `language`: Optional source language override, default `php`
- `framework`: Optional framework name included in `source.framework`
- `component`: Optional component name included in `source.component`
- `instanceId`: Optional service instance identifier
- `tags`: Optional tags appended to `context.tags`
- `context`: Optional shared context merged into every event
- `headers`: Optional additional HTTP headers
- `timeout`: Default transport timeout in seconds
- `transport`: Optional custom transport callable
- `beforeSend`: Optional hook to mutate or drop a payload before send
- `onTransportError`: Optional callback for hook-capture transport failures
- `captureExceptions`: Disable uncaught exception capture with `false`
- `captureErrors`: Disable `set_error_handler` capture with `false`
- `captureShutdown`: Disable fatal shutdown capture with `false`

## Notes

- The default transport uses `file_get_contents()` with an HTTP stream context.
- Manual capture is synchronous; `flush()` is currently a no-op and returns an empty array.
- Automatic request context includes method, path, request ID, host, scheme, and URL when running under a web SAPI.
- `uninstall()` restores exception and error handlers. PHP shutdown functions cannot be unregistered, so the shutdown hook becomes inert after `uninstall()`.
- Full examples are available in [`examples/`](./examples).
