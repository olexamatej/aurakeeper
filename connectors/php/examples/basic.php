<?php

declare(strict_types=1);

require dirname(__DIR__) . '/aurakeeper.php';

$connector = AuraKeeper\create_aurakeeper_connector([
    'endpoint' => 'https://api.example.com/v1/logs/errors',
    'apiToken' => 'your-api-token',
    'serviceName' => 'php-worker',
    'serviceVersion' => '1.0.0',
    'environment' => 'development',
    'platform' => 'worker',
    'component' => 'examples-basic',
    'tags' => ['backend', 'php'],
    'transport' => static function (array $config): array {
        echo "AuraKeeper payload:\n";
        echo json_encode($config['payload'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";

        return [
            'status' => 202,
            'body' => '{"status":"accepted"}',
        ];
    },
]);

$connector->install();

try {
    throw new RuntimeException('Handled CLI example error');
} catch (Throwable $error) {
    $connector->captureException($error, [
        'handled' => true,
        'level' => 'error',
        'correlationId' => 'cli_example_123',
        'details' => [
            'jobName' => 'example-job',
        ],
    ]);
}

$connector->captureMessage('Informational PHP message', [
    'level' => 'info',
    'handled' => true,
    'tags' => ['example'],
]);

$connector->close();
