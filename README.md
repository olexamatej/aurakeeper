# AuraKeeper

AuraKeeper is an agent-driven runtime repair tool that uses the CLI to set up
runtime error hooks in existing projects, captures application errors,
reproduces them in isolated workspaces, generates minimal fixes, verifies and
tests them, and promotes verified patches back to the target repository.

It combines CLI-based onboarding, frontend monitoring, multi-agent repair
orchestration, local or Docker sandboxing, configurable promotion modes, and
connector support across multiple stacks so the full error-to-fix workflow can
run in one system.

## What It Does

AuraKeeper connects the pieces needed to move from a runtime failure to a
verified code change:

- **Project onboarding:** `aurakeeper hook` inspects an existing repository and
  sets up the runtime error capture needed for that project. `aurakeeper local`
  can run the local AuraKeeper backend, provision project credentials, and pass
  those credentials into a development command.
- **Error ingestion:** applications send structured runtime errors with service
  metadata, stack traces, runtime details, request context, user context, and
  arbitrary debugging data. AuraKeeper can also import upstream incidents from
  Sentry into the same normalized error log pipeline.
- **Frontend monitoring:** the UI lets you create or select projects, configure
  repair targets, inspect ingested errors, track state changes, start manual
  repairs, and review previous repair attempts and artifacts.
- **Automated repair orchestration:** when `autoTrigger` is enabled and a
  checkout path is configured, new errors can queue the repair flow
  automatically. The orchestrator gathers repository context and runs the
  staged pipeline from backend selection through replication, patching,
  verification, testing, promotion, and completion.
- **Agent roles:** the Replicator reproduces the failure and narrows the likely
  cause, the Worker creates the smallest safe patch, and the Tester reviews
  verification output and regression risk before the repair can pass.
- **Sandboxed verification:** repair work runs in isolated local or Docker
  workspaces. Production, hosted, or untrusted contexts prefer Docker, while
  trusted local projects can use local execution when allowed by policy.
- **Patch promotion:** verified patches can be applied back to the original
  checkout automatically, or kept pending for manual review and apply.
- **Artifacts and examples:** repair attempts persist reports, patches,
  verification output, and downloadable artifacts. Connector SDKs and runnable
  examples cover CLI, JavaScript, Next.js, React Native, Python, Go, JVM, .NET,
  Ruby, and PHP.

## End-to-End Flow

1. Run `aurakeeper hook` in an existing project to install runtime error capture.
2. Run `aurakeeper local` or `./run-local.sh` to start AuraKeeper locally.
3. Create or select a project in the frontend and configure its repair target.
4. Trigger a runtime error from the app or a connector example.
5. AuraKeeper ingests the error, queues a repair, and runs the agent pipeline:
   `backend_selection -> context -> replicator -> worker -> verification -> tester -> promotion -> complete`.
6. Review the patch, verification output, reports, and artifacts in the UI.
7. Promote the verified patch automatically or apply it manually.

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
- `POST /v1/logs/errors/{logId}/repair-attempts`
- `GET /v1/logs/errors/{logId}/repair-attempts`
- `POST /v1/logs/errors/{logId}/repair-attempts/{repairAttemptId}/apply`
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
