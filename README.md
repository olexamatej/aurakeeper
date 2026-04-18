# AuraKeeper

AuraKeeper ingests production and local development errors, preserves the
runtime and repository context needed to investigate them, and is growing
toward an evidence-first repair loop.

The core loop is:

1. Capture a structured error event.
2. Group it with related failures.
3. Enrich it with runtime, deploy, request, and repository context.
4. Reproduce the failure in a sandbox.
5. Generate the smallest plausible patch.
6. Run tests or a replay.
7. Produce a repair report that a human can review.

## Current Surface

The repository root [openapi.yaml](./openapi.yaml) is the source of truth for
the API contract, and the backend already implements the current surface:

- `POST /v1/projects` to create a project and mint an ingestion token
- `GET /v1/logs/errors` to list stored error logs for a project
- `POST /v1/logs/errors` to ingest normalized error events
- `POST /v1/sources/sentry` to attach a Sentry source to a project
- `POST /v1/sources/sentry/:sourceId/poll` to import fresh Sentry events
- `GET /v1/logs/errors/:logId/repair-attempts` to list persisted repair attempts
- `GET /v1/logs/errors/:logId/artifacts/:artifactId` to fetch stored artifacts

The error event shape already covers service metadata, runtime information,
normalized error fields, stack traces, arbitrary details, and request or user
context. Repair attempts can already persist reports and copied artifacts for a
given error log.

## Product Shape

AuraKeeper sits between error reporting and code repair.

Traditional monitoring tells a team that something broke. AuraKeeper is meant
to answer the next question: "What changed, why did it fail, and what is the
safest patch we can try?"

The system is designed to produce repair attempts with clear evidence, not
silently rewrite production:

- issue summary with frequency, affected users, and first/last seen times
- suspected root cause based on stack trace, release, and code context
- reproduction command or replay fixture when available
- proposed code patch
- validation output from tests, type checks, linters, or replay
- pull request or local patch for developer approval

## Agent Roles

AuraKeeper is built around focused agents with narrow responsibilities.

The [Replicator Agent](./agents/replicator.md) receives an error event or
grouped issue, tries to reproduce it, and writes a short handoff with the TLDR,
likely cause, commands run, and relevant logs.

The [Worker Agent](./agents/worker.md) waits for the Replicator Agent handoff,
identifies the smallest safe fix, and changes the least amount of LOC needed.
It should prefer targeted patches over broad refactors and return verification
evidence with every repair attempt.

The Orchestrator is the deterministic controller around those agents. It gathers
repository context, project instructions, OpenAPI contracts, repair config, and
stack-relevant files; chooses Docker or local execution from policy; calls the
Replicator, Worker, and Tester agents in order; runs the verification runner on
the Worker patch in an isolated workspace; exposes `agent-browser` capability to
the Replicator and Tester for frontend bug reproduction and UI verification when
the issue looks browser-facing; and writes the final repair report.
The verification runner is the hard gate: if verification blocks the patch, the
orchestrator must not allow the repair even if an agent says it is safe. The
backend implementation lives in
[`backend/src/verification/orchestrator.ts`](./backend/src/verification/orchestrator.ts)
and uses an injectable agent client so different agent runtimes can be plugged in
without changing the orchestration policy.

## Implemented Today

The backend and verification code already cover a meaningful slice of the MVP:

- project-scoped token provisioning and validated error ingestion
- SQLite persistence for projects, error logs, repair attempts, and artifacts
- Sentry import into the normalized error log pipeline
- repository-aware verification orchestration with Replicator, Worker, and Tester roles
- backend selection between local and Docker execution
- project config loading from `.aurakeeper.json`, `.aurakeeper.yml`, or `.aurakeeper.yaml`
- browser automation handoff for frontend-facing reproduction and verification
- durable artifact storage and retrieval for completed repair attempts

The current implementation is strongest around evidence collection and
verification. It already supports isolated workspaces, patch application,
verification commands, and persisted repair reports, but it does not yet close
the loop by creating pull requests or managing grouped issues end to end.

## Client SDKs

Small SDKs should make the ingestion API easy to adopt.

Initial SDKs:

- JavaScript for browser and Node.js in [`connectors/javascript`](./connectors/javascript)
- Python for backend, workers, and CLI tools in [`connectors/python`](./connectors/python)
- Next.js in [`connectors/nextjs`](./connectors/nextjs)
- React Native in [`connectors/react-native`](./connectors/react-native)
- CLI and local development in [`connectors/cli`](./connectors/cli)
- Go in [`connectors/go`](./connectors/go)
- JVM in [`connectors/jvm`](./connectors/jvm)
- .NET in [`connectors/dotnet`](./connectors/dotnet)
- Ruby in [`connectors/ruby`](./connectors/ruby)

## Product CLI

The installable AuraKeeper product CLI lives in [`cli`](./cli). It is separate
from the runtime-focused Node.js connector in [`connectors/cli`](./connectors/cli).

Current command surface:

- `aurakeeper hook` inspects the current repository, opens a small interactive
  TUI with `@clack/prompts`, and then runs a Codex-backed agent in that
  directory to add either an AuraKeeper hook or a Sentry-based hook using
  either a premade pattern or a project-specific implementation.

## Connector Examples

Each connector has a small runtime-error example under its `examples/` directory.
Create or select a project in the web UI, then use the Connector examples panel
to launch a whitelisted local demo against that project.

The same demos can be run from the repository root:

```bash
AURAKEEPER_API_TOKEN=<project-token> make run python
```

List available examples with:

```bash
make list
```

Examples default to `http://127.0.0.1:3000/v1/logs/errors`. Override that with
`AURAKEEPER_ENDPOINT` when the backend runs elsewhere.
- PHP in [`connectors/php`](./connectors/php)

SDK responsibilities:

- catch unhandled exceptions
- capture framework-specific context
- scrub secrets and obvious personal data
- attach release/version metadata
- retry safely
- preserve `eventId` for idempotency

Example event:

```json
{
  "eventId": "767d5a66-2b41-4c2e-90e8-6dd0149491df",
  "occurredAt": "2026-04-18T08:32:17Z",
  "level": "error",
  "platform": "web",
  "environment": "production",
  "service": {
    "name": "aura-web",
    "version": "2026.04.18"
  },
  "source": {
    "runtime": "node",
    "language": "typescript",
    "framework": "next.js",
    "component": "app-router"
  },
  "error": {
    "type": "TypeError",
    "message": "Cannot read properties of undefined",
    "stack": "TypeError: Cannot read properties of undefined\n    at DashboardPage...",
    "handled": false
  },
  "context": {
    "request": {
      "method": "GET",
      "path": "/dashboard",
      "requestId": "req_123"
    },
    "tags": ["frontend", "nextjs"]
  }
}
```

## What To Avoid Early

Avoid building the hardest version first.

- Do not auto-push to production in the MVP.
- Do not start with every language and framework.
- Do not depend only on LLM confidence; require command output.
- Do not treat logs as safe by default; add scrubbing and retention controls.
- Do not group unrelated errors just because the messages look similar.

## Near-Term Backlog

- Add deterministic fingerprinting and first-class issue grouping.
- Enrich stored events with deploy and repository metadata.
- Create pull requests from successful repair attempts.
- Replace the placeholder frontend with a real UI for logs, attempts, and artifacts.
- Add more end-to-end wiring between ingestion, issue state, and repair orchestration.

## Open Questions

- Should issue grouping stay deterministic and explicit, or should the project add
  a learned clustering layer later?
- Which source control provider should be supported first for PR creation?
- What level of automation is acceptable before a human review step becomes optional?
- What data retention and redaction guarantees are required for hosted deployments?
