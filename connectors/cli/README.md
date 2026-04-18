# AuraKeeper CLI Connector

Node.js connector for CLI tools and local-development workflows that send
structured errors to AuraKeeper's `POST /v1/logs/errors` endpoint.

## Features

- Automatic process-level capture with `uncaughtException` and
  `unhandledRejection`
- Manual capture for handled exceptions and plain messages
- `captureCommandFailure()` helper for failed subprocesses and test commands
- Automatic CLI context for `cwd`, `argv`, command, package manager, and Node.js
  runtime details
- Optional git repository enrichment when the current working directory is inside
  a repository
- Payloads normalized to the schema in [`openapi.yaml`](../../openapi.yaml)
- No external dependencies

## Files

- [`aurakeeper.js`](./aurakeeper.js): standalone CommonJS connector module
- [`examples/`](./examples): practical CLI setup examples

## Usage

```js
const { spawnSync } = require("node:child_process");
const { createAuraKeeperCliConnector } = require("./aurakeeper");

const connector = createAuraKeeperCliConnector({
  endpoint: "https://api.example.com/v1/logs/errors",
  apiToken: process.env.AURAKEEPER_API_TOKEN,
  serviceName: "repo-doctor",
  serviceVersion: "2026.04.18",
  environment: process.env.NODE_ENV || "development",
  component: "lint-command",
  tags: ["cli", "local-dev"],
});

connector.install();

async function main() {
  const result = spawnSync("npm", ["test"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    await connector.captureCommandFailure(
      {
        command: "npm test",
        cwd: process.cwd(),
        exitCode: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      {
        handled: true,
        details: {
          workflow: "pre-push",
        },
      }
    );
  }
}

main().finally(() => connector.flush());
```

## API

### `createAuraKeeperCliConnector(options)`

Creates a connector instance.

### `connector.install()`

Registers automatic handlers for uncaught exceptions and unhandled promise
rejections.

### `connector.captureException(error, overrides)`

Sends a handled exception. `overrides` can supply `level`, `handled`,
`correlationId`, `details`, `request`, `user`, `session`, `device`, `tags`, and
other payload fields from the schema.

### `connector.captureMessage(message, overrides)`

Sends a synthetic error built from a string message.

### `connector.captureCommandFailure(commandResult, overrides)`

Normalizes a failed command or subprocess result into `error.details.failedCommand`
and `context.session`.

Accepted `commandResult` fields:

- `command`: shell command string
- `argv` or `args`: argument array used to derive a command string
- `cwd`: working directory for the failed command
- `exitCode` or `status`: numeric exit code
- `signal`: terminating signal
- `stdout`: command stdout as string or `Buffer`
- `stderr`: command stderr as string or `Buffer`
- `output`: combined output string or `Buffer`
- `error`: nested `Error` instance
- `message`: explicit error message override

### `connector.flush()`

Waits for all in-flight sends and resolves with `Promise.allSettled()` results.

### `connector.uninstall()`

Restores the original process listener state by removing the handlers that
`install()` added.

## Options

- `endpoint`: Full AuraKeeper ingestion URL
- `apiToken`: API token sent as `X-API-Token`
- `serviceName`: Required logical service name
- `serviceVersion`: Optional application version or git SHA
- `environment`: Optional environment such as `development`
- `platform`: Optional override, defaults to `cli`
- `language`: Optional source language, defaults to `javascript`
- `framework`: Optional framework or library name included in `source.framework`
- `component`: Optional component name included in `source.component`
- `instanceId`: Optional service instance identifier
- `command`: Optional command string override for `context.session.command`
- `argv`: Optional argument array override for `context.session.argv`
- `cwd`: Optional working directory override for context and git lookup
- `packageManager`: Optional package manager override
- `context`: Optional shared context merged into every event
- `tags`: Optional tags appended to `context.tags`
- `headers`: Optional additional HTTP headers
- `fetch`: Optional fetch implementation override
- `transport`: Optional custom transport function
- `beforeSend`: Optional hook to mutate or drop a payload before it is sent
- `onTransportError`: Optional callback used by automatic hook capture
- `captureUncaught`: Disable `uncaughtException` capture with `false`
- `captureRejections`: Disable `unhandledRejection` capture with `false`
- `captureProcessContext`: Disable automatic `cwd`/`argv`/device/process context
  with `false`
- `captureDeviceContext`: Disable automatic `context.device` fields with `false`
- `captureGitContext`: Disable git repository enrichment with `false`
- `outputLimit`: Maximum number of characters retained for command output fields
  before truncation

## Payload Shape

The connector keeps CLI-specific metadata inside the shared schema:

- `service`: name/version/instance metadata
- `source`: `runtime: node`, `language: javascript`, optional framework/component
- `error`: normalized message, stack, handled flag, and `details`
- `context.session`: command, `argv`, `cwd`, package manager, pid
- `context.repository`: git root, branch, commit, and a dirty summary when
  available
- `context.device`: hostname, platform, architecture, OS release
- `context.process`: Node.js process details

## Notes

- The default transport uses `fetch`. On Node.js runtimes without global fetch,
  pass `options.fetch` or `options.transport`.
- `captureCommandFailure()` truncates large output values if `outputLimit` is set.
- Git enrichment is best-effort and silently skipped when `git` is unavailable or
  the current directory is not part of a repository.
- Full examples are available in [`examples/`](./examples).
