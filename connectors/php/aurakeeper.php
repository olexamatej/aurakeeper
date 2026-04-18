<?php

declare(strict_types=1);

namespace AuraKeeper;

use ErrorException;
use JsonSerializable;
use RuntimeException;
use Throwable;

final class AuraKeeperConnector
{
    private array $options;
    private bool $installed = false;
    private bool $shutdownRegistered = false;
    private $previousExceptionHandler;
    private $previousErrorHandler;

    public function __construct(array $options)
    {
        if (empty($options['endpoint'])) {
            throw new RuntimeException('AuraKeeperConnector requires an endpoint.');
        }

        if (empty($options['apiToken'])) {
            throw new RuntimeException('AuraKeeperConnector requires an apiToken.');
        }

        if (empty($options['serviceName'])) {
            throw new RuntimeException('AuraKeeperConnector requires a serviceName.');
        }

        $this->options = $options;
        $this->previousExceptionHandler = null;
        $this->previousErrorHandler = null;
    }

    public function install(): self
    {
        if ($this->installed) {
            return $this;
        }

        if (($this->options['captureExceptions'] ?? true) !== false) {
            $this->previousExceptionHandler = set_exception_handler([$this, 'handleException']);
        }

        if (($this->options['captureErrors'] ?? true) !== false) {
            $this->previousErrorHandler = set_error_handler([$this, 'handleError']);
        }

        if (($this->options['captureShutdown'] ?? true) !== false && !$this->shutdownRegistered) {
            register_shutdown_function([$this, 'handleShutdown']);
            $this->shutdownRegistered = true;
        }

        $this->installed = true;
        return $this;
    }

    public function uninstall(): self
    {
        if (!$this->installed) {
            return $this;
        }

        if (($this->options['captureExceptions'] ?? true) !== false) {
            restore_exception_handler();
        }

        if (($this->options['captureErrors'] ?? true) !== false) {
            restore_error_handler();
        }

        $this->installed = false;
        return $this;
    }

    public function close(): self
    {
        return $this->uninstall();
    }

    public function captureException(Throwable $error, array $overrides = []): ?array
    {
        $payload = $this->buildPayload($error, $overrides);

        if ($payload === null) {
            return null;
        }

        return $this->send($payload);
    }

    public function captureMessage(string $message, array $overrides = []): ?array
    {
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 1)[0] ?? [];
        $synthetic = new ErrorException(
            $message,
            0,
            E_USER_NOTICE,
            isset($caller['file']) && is_string($caller['file']) ? $caller['file'] : __FILE__,
            isset($caller['line']) && is_int($caller['line']) ? $caller['line'] : __LINE__
        );

        return $this->captureException($synthetic, array_merge([
            'type' => 'Message',
            'message' => $message,
        ], $overrides));
    }

    public function flush(): array
    {
        return [];
    }

    public function handleException(Throwable $error): void
    {
        try {
            $this->captureException($error, [
                'handled' => false,
                'level' => 'critical',
                'platform' => $this->options['platform'] ?? $this->detectPlatform(),
                'source' => [
                    'runtime' => $this->detectRuntime(),
                ],
            ]);
        } catch (Throwable $transportError) {
            $this->handleTransportFailure($transportError);
        }

        if (is_callable($this->previousExceptionHandler)) {
            call_user_func($this->previousExceptionHandler, $error);
            return;
        }

        error_log($this->formatThrowableForLog($error));
    }

    public function handleError(int $severity, string $message, string $file, int $line): bool
    {
        if (!(error_reporting() & $severity)) {
            return false;
        }

        $error = new ErrorException($message, 0, $severity, $file, $line);

        try {
            $this->captureException($error, [
                'handled' => false,
                'level' => $this->mapPhpSeverityToLevel($severity),
                'details' => [
                    'severity' => $severity,
                    'severityName' => $this->mapPhpSeverityToName($severity),
                ],
            ]);
        } catch (Throwable $transportError) {
            $this->handleTransportFailure($transportError);
        }

        if (is_callable($this->previousErrorHandler)) {
            return (bool) call_user_func($this->previousErrorHandler, $severity, $message, $file, $line);
        }

        return false;
    }

    public function handleShutdown(): void
    {
        if (!$this->installed) {
            return;
        }

        $lastError = error_get_last();

        if ($lastError === null || !$this->isFatalErrorType((int) $lastError['type'])) {
            return;
        }

        $fatal = new ErrorException(
            (string) $lastError['message'],
            0,
            (int) $lastError['type'],
            (string) $lastError['file'],
            (int) $lastError['line']
        );

        try {
            $this->captureException($fatal, [
                'handled' => false,
                'level' => 'critical',
                'details' => [
                    'severity' => (int) $lastError['type'],
                    'severityName' => $this->mapPhpSeverityToName((int) $lastError['type']),
                    'shutdown' => true,
                ],
            ]);
        } catch (Throwable $transportError) {
            $this->handleTransportFailure($transportError);
        }
    }

    private function buildPayload(Throwable $error, array $overrides): ?array
    {
        $normalized = $this->normalizeThrowable($error);
        $mergedDetails = $this->sanitizeJsonValue(
            $this->mergeObjects($normalized['details'] ?? [], $this->asArray($overrides['details'] ?? []))
        );
        $mergedContext = $this->buildContext($overrides);

        $payload = [
            'eventId' => $overrides['eventId'] ?? $this->generateEventId(),
            'occurredAt' => $overrides['occurredAt'] ?? gmdate(DATE_ATOM),
            'level' => $overrides['level'] ?? 'error',
            'platform' => $overrides['platform'] ?? ($this->options['platform'] ?? $this->detectPlatform()),
            'environment' => $overrides['environment'] ?? ($this->options['environment'] ?? null),
            'service' => $this->compactObject($this->mergeObjects([
                'name' => $this->options['serviceName'],
                'version' => $this->options['serviceVersion'] ?? null,
                'instanceId' => $this->options['instanceId'] ?? null,
            ], $this->asArray($overrides['service'] ?? []))),
            'source' => $this->compactObject($this->mergeObjects([
                'runtime' => $this->detectRuntime(),
                'language' => $this->options['language'] ?? 'php',
                'framework' => $this->options['framework'] ?? null,
                'component' => $this->options['component'] ?? null,
            ], $this->asArray($overrides['source'] ?? []))),
            'error' => $this->compactObject([
                'type' => $overrides['type'] ?? $normalized['type'],
                'message' => $overrides['message'] ?? $normalized['message'],
                'code' => $overrides['code'] ?? $normalized['code'],
                'stack' => $overrides['stack'] ?? $normalized['stack'],
                'handled' => array_key_exists('handled', $overrides) ? (bool) $overrides['handled'] : true,
                'details' => !empty($mergedDetails) ? $mergedDetails : null,
            ]),
            'context' => !empty($mergedContext) ? $mergedContext : null,
        ];

        if (isset($this->options['beforeSend']) && is_callable($this->options['beforeSend'])) {
            $nextPayload = call_user_func($this->options['beforeSend'], $payload);

            if ($nextPayload === false || $nextPayload === null) {
                return null;
            }

            if (!is_array($nextPayload)) {
                throw new RuntimeException('AuraKeeper beforeSend must return an array, null, or false.');
            }

            $payload = $nextPayload;
        }

        return $this->pruneEmpty($payload);
    }

    private function buildContext(array $overrides): array
    {
        $optionContext = $this->asArray($this->options['context'] ?? []);
        $overrideContext = $this->asArray($overrides['context'] ?? []);
        $autoRequestContext = $this->detectRequestContext();
        $tags = array_merge(
            $this->normalizeTags($this->options['tags'] ?? []),
            $this->normalizeTags($optionContext['tags'] ?? []),
            $this->normalizeTags($overrideContext['tags'] ?? []),
            $this->normalizeTags($overrides['tags'] ?? [])
        );

        return $this->pruneEmpty($this->sanitizeJsonValue($this->mergeObjects(
            $optionContext,
            $overrideContext,
            [
                'request' => $this->mergeObjects(
                    $autoRequestContext,
                    $this->asArray($optionContext['request'] ?? []),
                    $this->asArray($overrideContext['request'] ?? []),
                    $this->asArray($overrides['request'] ?? [])
                ),
                'user' => $this->mergeObjects(
                    $this->asArray($optionContext['user'] ?? []),
                    $this->asArray($overrideContext['user'] ?? []),
                    $this->asArray($overrides['user'] ?? [])
                ),
                'session' => $this->mergeObjects(
                    $this->asArray($optionContext['session'] ?? []),
                    $this->asArray($overrideContext['session'] ?? []),
                    $this->asArray($overrides['session'] ?? [])
                ),
                'device' => $this->mergeObjects(
                    $this->asArray($optionContext['device'] ?? []),
                    $this->asArray($overrideContext['device'] ?? []),
                    $this->asArray($overrides['device'] ?? [])
                ),
                'correlationId' => $overrides['correlationId']
                    ?? ($overrideContext['correlationId'] ?? ($optionContext['correlationId'] ?? null)),
                'tags' => !empty($tags) ? $this->uniqueStrings($tags) : null,
            ]
        )));
    }

    private function send(array $payload): array
    {
        $transport = $this->options['transport'] ?? [$this, 'defaultTransport'];

        if (!is_callable($transport)) {
            throw new RuntimeException('AuraKeeper transport must be callable.');
        }

        return (array) call_user_func($transport, [
            'endpoint' => $this->options['endpoint'],
            'apiToken' => $this->options['apiToken'],
            'api_token' => $this->options['apiToken'],
            'payload' => $payload,
            'headers' => is_array($this->options['headers'] ?? null) ? $this->options['headers'] : [],
            'timeout' => (float) ($this->options['timeout'] ?? 5.0),
        ]);
    }

    private function defaultTransport(array $config): array
    {
        if (!function_exists('stream_context_create') || !function_exists('file_get_contents')) {
            throw new RuntimeException('AuraKeeper default transport requires stream_context_create and file_get_contents.');
        }

        $body = json_encode($config['payload'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        if ($body === false) {
            throw new RuntimeException('AuraKeeper failed to encode the error payload as JSON.');
        }

        $headers = array_merge([
            'Content-Type: application/json',
            'X-API-Token: ' . $config['apiToken'],
        ], $this->formatHeaders($config['headers'] ?? []));

        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => implode("\r\n", $headers),
                'content' => $body,
                'timeout' => (float) ($config['timeout'] ?? 5.0),
                'ignore_errors' => true,
            ],
        ]);

        $responseBody = @file_get_contents((string) $config['endpoint'], false, $context);
        $responseHeaders = isset($http_response_header) && is_array($http_response_header)
            ? $http_response_header
            : [];
        $status = $this->extractStatusCode($responseHeaders);

        if ($responseBody === false) {
            $lastError = error_get_last();
            $message = is_array($lastError) && isset($lastError['message'])
                ? $lastError['message']
                : 'Unknown transport failure';
            throw new RuntimeException('AuraKeeper request failed: ' . $message);
        }

        if ($status >= 200 && $status < 300) {
            return [
                'status' => $status,
                'body' => $responseBody,
                'headers' => $responseHeaders,
            ];
        }

        throw new RuntimeException(sprintf(
            'AuraKeeper request failed with status %d: %s',
            $status > 0 ? $status : 0,
            trim($responseBody)
        ));
    }

    private function normalizeThrowable(Throwable $error): array
    {
        $details = [
            'file' => $error->getFile(),
            'line' => $error->getLine(),
        ];

        if ($error instanceof ErrorException) {
            $details['severity'] = $error->getSeverity();
            $details['severityName'] = $this->mapPhpSeverityToName($error->getSeverity());
        }

        return [
            'type' => get_class($error),
            'message' => $error->getMessage() !== '' ? $error->getMessage() : 'Unknown error',
            'code' => $error->getCode() !== 0 ? (string) $error->getCode() : null,
            'stack' => $error->__toString(),
            'details' => $this->sanitizeJsonValue($details),
        ];
    }

    private function detectPlatform(): string
    {
        return PHP_SAPI === 'cli' ? 'cli' : 'backend';
    }

    private function detectRuntime(): string
    {
        return match (PHP_SAPI) {
            'cli' => 'php-cli',
            'fpm-fcgi' => 'php-fpm',
            'apache2handler' => 'apache',
            default => 'php',
        };
    }

    private function detectRequestContext(): array
    {
        if (PHP_SAPI === 'cli' || empty($_SERVER)) {
            return [];
        }

        $headers = $this->readRequestHeaders();
        $path = $_SERVER['REQUEST_URI'] ?? null;

        return $this->pruneEmpty([
            'method' => $_SERVER['REQUEST_METHOD'] ?? null,
            'path' => is_string($path) ? strtok($path, '?') : null,
            'requestId' => $headers['x-request-id'] ?? $headers['x-correlation-id'] ?? null,
            'host' => $_SERVER['HTTP_HOST'] ?? null,
            'scheme' => $this->detectRequestScheme(),
            'url' => isset($_SERVER['REQUEST_URI'], $_SERVER['HTTP_HOST'])
                ? sprintf('%s://%s%s', $this->detectRequestScheme(), $_SERVER['HTTP_HOST'], $_SERVER['REQUEST_URI'])
                : null,
        ]);
    }

    private function detectRequestScheme(): ?string
    {
        if (PHP_SAPI === 'cli') {
            return null;
        }

        if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
            return 'https';
        }

        if (($_SERVER['SERVER_PORT'] ?? null) === '443') {
            return 'https';
        }

        return 'http';
    }

    private function readRequestHeaders(): array
    {
        if (function_exists('getallheaders')) {
            $headers = getallheaders();
            if (is_array($headers)) {
                return $this->normalizeHeaderMap($headers);
            }
        }

        $headers = [];

        foreach ($_SERVER as $key => $value) {
            if (!is_string($value)) {
                continue;
            }

            if (str_starts_with($key, 'HTTP_')) {
                $name = strtolower(str_replace('_', '-', substr($key, 5)));
                $headers[$name] = $value;
            }
        }

        return $headers;
    }

    private function normalizeHeaderMap(array $headers): array
    {
        $normalized = [];

        foreach ($headers as $key => $value) {
            if (!is_string($key) || !is_scalar($value)) {
                continue;
            }

            $normalized[strtolower($key)] = (string) $value;
        }

        return $normalized;
    }

    private function formatHeaders(array $headers): array
    {
        $formatted = [];

        foreach ($headers as $key => $value) {
            if (!is_string($key) || !is_scalar($value)) {
                continue;
            }

            $formatted[] = $key . ': ' . $value;
        }

        return $formatted;
    }

    private function extractStatusCode(array $headers): int
    {
        foreach ($headers as $header) {
            if (!is_string($header)) {
                continue;
            }

            if (preg_match('/\s(\d{3})\s/', $header, $matches) === 1) {
                return (int) $matches[1];
            }
        }

        return 0;
    }

    private function isFatalErrorType(int $severity): bool
    {
        return in_array($severity, [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true);
    }

    private function mapPhpSeverityToLevel(int $severity): string
    {
        return match ($severity) {
            E_WARNING, E_USER_WARNING, E_CORE_WARNING, E_COMPILE_WARNING => 'warning',
            E_NOTICE, E_USER_NOTICE, E_STRICT, E_DEPRECATED, E_USER_DEPRECATED => 'info',
            E_PARSE, E_ERROR, E_CORE_ERROR, E_COMPILE_ERROR, E_RECOVERABLE_ERROR, E_USER_ERROR => 'critical',
            default => 'error',
        };
    }

    private function mapPhpSeverityToName(int $severity): string
    {
        return match ($severity) {
            E_ERROR => 'E_ERROR',
            E_WARNING => 'E_WARNING',
            E_PARSE => 'E_PARSE',
            E_NOTICE => 'E_NOTICE',
            E_CORE_ERROR => 'E_CORE_ERROR',
            E_CORE_WARNING => 'E_CORE_WARNING',
            E_COMPILE_ERROR => 'E_COMPILE_ERROR',
            E_COMPILE_WARNING => 'E_COMPILE_WARNING',
            E_USER_ERROR => 'E_USER_ERROR',
            E_USER_WARNING => 'E_USER_WARNING',
            E_USER_NOTICE => 'E_USER_NOTICE',
            E_STRICT => 'E_STRICT',
            E_RECOVERABLE_ERROR => 'E_RECOVERABLE_ERROR',
            E_DEPRECATED => 'E_DEPRECATED',
            E_USER_DEPRECATED => 'E_USER_DEPRECATED',
            default => 'E_UNKNOWN',
        };
    }

    private function generateEventId(): string
    {
        try {
            return sprintf(
                '%s-%s-%s-%s-%s',
                bin2hex(random_bytes(4)),
                bin2hex(random_bytes(2)),
                bin2hex(random_bytes(2)),
                bin2hex(random_bytes(2)),
                bin2hex(random_bytes(6))
            );
        } catch (Throwable) {
            return 'evt_' . uniqid('', true);
        }
    }

    private function normalizeTags(mixed $tags): array
    {
        if (!is_array($tags)) {
            return [];
        }

        $normalized = [];

        foreach ($tags as $tag) {
            if (is_string($tag) && $tag !== '') {
                $normalized[] = $tag;
            }
        }

        return $normalized;
    }

    private function uniqueStrings(array $values): array
    {
        $output = [];

        foreach ($values as $value) {
            if (!is_string($value) || $value === '' || in_array($value, $output, true)) {
                continue;
            }

            $output[] = $value;
        }

        return $output;
    }

    private function asArray(mixed $value): array
    {
        return is_array($value) ? $value : [];
    }

    private function mergeObjects(array ...$objects): array
    {
        $merged = [];

        foreach ($objects as $object) {
            foreach ($object as $key => $value) {
                if ($value !== null) {
                    $merged[$key] = $value;
                }
            }
        }

        return $merged;
    }

    private function compactObject(array $value): array
    {
        $output = [];

        foreach ($value as $key => $entry) {
            if ($entry !== null) {
                $output[$key] = $entry;
            }
        }

        return $output;
    }

    private function pruneEmpty(mixed $value): mixed
    {
        if (is_array($value)) {
            $isList = array_is_list($value);
            $next = [];

            foreach ($value as $key => $entry) {
                $pruned = $this->pruneEmpty($entry);

                if ($pruned === null || $pruned === [] || $pruned === '') {
                    continue;
                }

                if ($isList) {
                    $next[] = $pruned;
                } else {
                    $next[$key] = $pruned;
                }
            }

            return $next === [] ? [] : $next;
        }

        return $value;
    }

    private function sanitizeJsonValue(mixed $value, array &$seen = [], int $depth = 0): mixed
    {
        if ($value === null || is_scalar($value)) {
            return $value;
        }

        if ($depth >= 6) {
            return '[MaxDepth]';
        }

        if ($value instanceof Throwable) {
            return $this->compactObject([
                'type' => get_class($value),
                'message' => $value->getMessage(),
                'code' => $value->getCode() !== 0 ? (string) $value->getCode() : null,
            ]);
        }

        if ($value instanceof JsonSerializable) {
            return $this->sanitizeJsonValue($value->jsonSerialize(), $seen, $depth + 1);
        }

        if (is_object($value)) {
            $objectId = spl_object_id($value);

            if (isset($seen[$objectId])) {
                return '[Circular]';
            }

            $seen[$objectId] = true;
            $output = [];

            foreach (get_object_vars($value) as $key => $entry) {
                $output[$key] = $this->sanitizeJsonValue($entry, $seen, $depth + 1);
            }

            unset($seen[$objectId]);
            return $output;
        }

        if (!is_array($value)) {
            return (string) $value;
        }

        $output = [];

        foreach ($value as $key => $entry) {
            $output[$key] = $this->sanitizeJsonValue($entry, $seen, $depth + 1);
        }

        return $output;
    }

    private function handleTransportFailure(Throwable $error): void
    {
        if (isset($this->options['onTransportError']) && is_callable($this->options['onTransportError'])) {
            call_user_func($this->options['onTransportError'], $error);
            return;
        }

        error_log('AuraKeeper failed to send error log: ' . $error->getMessage());
    }

    private function formatThrowableForLog(Throwable $error): string
    {
        return sprintf(
            'Uncaught %s: %s in %s:%d',
            get_class($error),
            $error->getMessage(),
            $error->getFile(),
            $error->getLine()
        );
    }
}

function create_aurakeeper_connector(array $options): AuraKeeperConnector
{
    return new AuraKeeperConnector($options);
}
