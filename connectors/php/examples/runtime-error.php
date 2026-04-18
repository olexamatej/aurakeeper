<?php

declare(strict_types=1);

require dirname(__DIR__) . '/aurakeeper.php';

$apiToken = getenv('AURAKEEPER_API_TOKEN') ?: null;

if ($apiToken === null) {
    fwrite(STDERR, "Set AURAKEEPER_API_TOKEN before running this example.\n");
    exit(1);
}

$connector = AuraKeeper\create_aurakeeper_connector([
    'endpoint' => getenv('AURAKEEPER_ENDPOINT') ?: 'http://127.0.0.1:3000/v1/logs/errors',
    'apiToken' => $apiToken,
    'serviceName' => 'php-runtime-example',
    'serviceVersion' => '1.0.0',
    'environment' => getenv('PHP_ENV') ?: 'development',
    'platform' => 'backend',
    'component' => 'runtime-error',
    'tags' => ['backend', 'php'],
]);

$connector->install();

throw new RuntimeException('Uncaught PHP runtime example');
