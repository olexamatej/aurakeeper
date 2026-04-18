<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/aurakeeper.php';

$connector = AuraKeeper\create_aurakeeper_connector([
    'endpoint' => 'https://api.example.com/v1/logs/errors',
    'apiToken' => 'your-api-token',
    'serviceName' => 'php-web',
    'serviceVersion' => '1.0.0',
    'environment' => 'development',
    'framework' => 'plain-php',
    'component' => 'examples-web',
    'tags' => ['backend', 'php'],
    'transport' => static function (array $config): array {
        error_log('AuraKeeper payload: ' . json_encode($config['payload'], JSON_UNESCAPED_SLASHES));

        return [
            'status' => 202,
            'body' => '{"status":"accepted"}',
        ];
    },
]);

$connector->install();

if (isset($_GET['fatal'])) {
    undefined_function_call();
}

if (isset($_GET['warning'])) {
    trigger_error('Example warning from web connector', E_USER_WARNING);
}

try {
    if (isset($_GET['handled'])) {
        throw new RuntimeException('Handled web example exception');
    }
} catch (Throwable $error) {
    $connector->captureException($error, [
        'handled' => true,
        'request' => [
            'feature' => 'handled-example',
        ],
        'user' => [
            'id' => 'web-demo-user',
        ],
    ]);
}
?>
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>AuraKeeper PHP Example</title>
  </head>
  <body>
    <h1>AuraKeeper PHP Example</h1>
    <p><a href="/?handled=1">Send handled exception</a></p>
    <p><a href="/?warning=1">Trigger warning hook</a></p>
    <p><a href="/?fatal=1">Trigger fatal shutdown hook</a></p>
  </body>
</html>
