# AuraKeeper

AuraKeeper captures application errors, preserves the runtime and repository
context needed to investigate them, and runs a verified repair workflow against
the affected codebase.

The platform is designed for teams that want more than error reporting.
AuraKeeper stores structured failures, imports upstream incidents, prepares
evidence-rich repair attempts, and keeps verification as the release gate.

## What It Does

- accepts structured error events from local development and production-style
  runtimes
- provisions per-project ingestion tokens and repair settings
- imports issues from Sentry into the normalized error log pipeline
- persists repair attempts, reports, and downloadable artifacts
- runs repository-aware verification orchestration with Replicator, Worker, and
  Tester agent roles
- supports local and Docker-backed repair execution policies
- includes connector SDKs and runnable examples across multiple stacks

## Architecture

AuraKeeper is organized around a deterministic orchestration layer and focused
agents:

- the [Replicator Agent](./agents/replicator.md) reproduces failures and writes
  a concise handoff with commands, logs, and likely cause
- the [Worker Agent](./agents/worker.md) prepares the smallest safe patch and
  returns verification evidence with the repair attempt
- the verification orchestrator coordinates repository context, repair policy,
  isolated execution, artifact capture, and final report generation

The backend implementation for orchestration lives in
[`backend/src/verification/orchestrator.ts`](./backend/src/verification/orchestrator.ts).
Verification is the hard gate: if checks fail, the repair attempt does not pass.

## API Contract

The repository root [`openapi.yaml`](./openapi.yaml) is the source of truth for
the API contract. Keep implementation, SDKs, and examples aligned with it.

Current API surface includes:

- `POST /v1/projects`
- `PATCH /v1/projects/{projectId}`
- `GET /v1/examples`
- `POST /v1/examples/{exampleId}/runs`
- `GET /v1/examples/runs/{runId}`
- `GET /v1/logs/errors`
- `POST /v1/logs/errors`
- `POST /v1/sources/sentry`
- `POST /v1/sources/sentry/{sourceId}/poll`
- `GET /v1/logs/errors/{logId}/repair-attempts`
- `GET /v1/logs/errors/{logId}/artifacts/{artifactId}`

Structured error events support service metadata, runtime details, normalized
error fields, stack traces, arbitrary context, and request or user metadata.

## Repository Layout

- [`backend`](./backend): API, persistence, ingestion pipeline, Sentry import,
  and verification orchestration
- [`frontend`](./frontend): local UI for projects, logs, repair attempts, and
  example workflows
- [`cli`](./cli): installable AuraKeeper product CLI
- [`connectors`](./connectors): runtime SDKs and framework-specific connectors
- [`examples`](./examples): runnable multi-language demo projects
- [`openapi.yaml`](./openapi.yaml): canonical API contract

## Local Development

Run the full local app from the repository root:

```bash
./run-local.sh
```

The script:

- creates missing default `.env` files for backend and frontend
- installs backend and frontend dependencies
- starts the backend on `http://127.0.0.1:3000`
- starts the frontend on `http://127.0.0.1:5173`
- shuts both services down on `Ctrl+C`

## Product CLI

The installable AuraKeeper CLI lives in [`cli`](./cli). It is separate from the
runtime-focused connector in [`connectors/cli`](./connectors/cli).

Install it locally from this repository with:

```bash
npm install --prefix cli
npm run --prefix cli build
npm install -g ./cli
```

Verify installation with:

```bash
aurakeeper --help
```

Current commands:

- `aurakeeper hook`: inspects the current repository and installs an AuraKeeper
  or Sentry-based hook through an interactive flow
- `aurakeeper local`: starts the local backend, provisions a project token, and
  can inject credentials into a development command such as
  `aurakeeper local -- npm run dev`

## Connectors

Connector implementations live under [`connectors`](./connectors). Each
connector includes its own runtime code, setup instructions, and example usage.

Available connectors:

- [`connectors/javascript`](./connectors/javascript)
- [`connectors/python`](./connectors/python)
- [`connectors/nextjs`](./connectors/nextjs)
- [`connectors/react-native`](./connectors/react-native)
- [`connectors/cli`](./connectors/cli)
- [`connectors/go`](./connectors/go)
- [`connectors/jvm`](./connectors/jvm)
- [`connectors/dotnet`](./connectors/dotnet)
- [`connectors/ruby`](./connectors/ruby)
- [`connectors/php`](./connectors/php)

## Examples

Each connector has a broken example under its `examples/` directory. These
projects intentionally trigger a failure, send the event to AuraKeeper, and
ship with a matching verification command.

Typical demo flow:

1. Start the local app with `./run-local.sh`.
2. Create or select a project and copy its API token.
3. List available examples:

```bash
make list
```

4. Run one example:

```bash
AURAKEEPER_API_TOKEN=<project-token> make run python
```

5. Run its verification command:

```bash
make verify-example python
```

Examples default to `http://127.0.0.1:3000/v1/logs/errors`. Override that with
`AURAKEEPER_ENDPOINT` if the backend is running elsewhere.

You can also run all registered examples:

```bash
make run-all
```

## Validation

Repository-level validation commands:

```bash
make doctor
make bootstrap
make test
make check
make build
make validate
make validate-all
make validate-container
```

What they do:

- `make doctor`: verifies required local toolchains are installed
- `make bootstrap`: installs project dependencies
- `make test`: runs backend tests with Bun
- `make check`: runs backend checks and frontend linting
- `make build`: builds and compiles the supported app and connector targets
- `make validate`: runs doctor, bootstrap, test, check, and build
- `make validate-all`: runs `validate` plus all registered examples
- `make validate-container`: runs the validation flow inside the dev container

## Dev Container

For isolated multi-language development, use the dev container in
[`./.devcontainer/`](./.devcontainer/).

It includes Node.js, npm, pnpm, Bun, Python, Ruby, PHP, Go, Java, Maven, and
.NET. When the container starts, `.devcontainer/post-create.sh` runs
`make bootstrap` automatically.
