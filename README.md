# AuraKeeper

AuraKeeper watches production and local development errors, groups the ones that
matter, reproduces them when it can, and opens a verified fix for a human to
review.

The first useful version should not try to be a fully autonomous engineer. It
should be a careful repair loop:

1. Capture a structured error event.
2. Group it with related failures.
3. Enrich it with runtime, deploy, request, and repository context.
4. Reproduce the failure in a sandbox.
5. Generate the smallest plausible patch.
6. Run tests or a replay.
7. Open a pull request with evidence.

## Current Surface

The repository currently defines the ingestion contract in
[openapi.yaml](./openapi.yaml).

`POST /v1/logs/errors` accepts platform-agnostic error events from web,
backend, mobile, worker, CLI, or local development runtimes. The payload already
captures the right foundation: service metadata, source runtime, normalized
error fields, stack traces, arbitrary details, request/user/session context, and
tags.

For teams already using Sentry, the backend can also store a project-scoped
Sentry source and poll that project for fresh Sentry events, mapping each one
into the same normalized `ErrorLogRequest` shape before persistence.

## Product Shape

AuraKeeper should sit between error reporting and code repair.

Traditional monitoring tells a team that something broke. AuraKeeper should
answer the next question: "What changed, why did it fail, and what is the safest
patch we can try?"

The system should produce repair attempts with clear evidence, not silently
rewrite production:

- issue summary with frequency, affected users, and first/last seen times
- suspected root cause based on stack trace, release, and code context
- reproduction command or replay fixture when available
- proposed code patch
- validation output from tests, type checks, linters, or replay
- pull request or local patch for developer approval

## Agent Roles

AuraKeeper should be built from focused agents with narrow responsibilities.

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
the Worker patch in an isolated workspace; and writes the final repair report.
The verification runner is the hard gate: if verification blocks the patch, the
orchestrator must not allow the repair even if an agent says it is safe. The
backend implementation lives in
[`backend/src/verification/orchestrator.ts`](./backend/src/verification/orchestrator.ts)
and uses an injectable agent client so different agent runtimes can be plugged in
without changing the orchestration policy.

## MVP

Build the MVP around one language and one repo workflow before expanding.

Recommended first target:

- Next.js or Node.js application errors
- GitHub repository integration
- local sandbox checkout per repair attempt
- test command configured per project
- pull request output, never direct production mutation

The MVP flow:

1. Ingest errors through the OpenAPI endpoint.
2. Persist raw events and normalized issue groups.
3. Fingerprint events by service, environment, error type, message, stack frame,
   and route or component.
4. Create an issue when a group crosses a threshold.
5. Fetch repository context for the failing service version.
6. Ask the Replicator Agent to reproduce the failure and write a handoff.
7. Ask the Worker Agent to produce a focused patch from that handoff.
8. Run the configured verification command.
9. Open a pull request that includes the error, hypothesis, patch, and test
   output.

## Implementation Plan

### 1. Ingestion API

Implement the existing OpenAPI contract as a small HTTP service.

Core responsibilities:

- authenticate bearer tokens
- validate `ErrorLogRequest`
- store immutable raw events
- return `202 accepted` quickly
- enqueue background normalization and grouping work

Suggested tables:

- `projects`: customer or workspace boundary
- `services`: logical application names and repository mapping
- `error_events`: immutable raw ingested payloads
- `error_groups`: deduplicated issues with status and fingerprint
- `repair_attempts`: generated patches, commands, logs, and outcomes

### 2. Fingerprinting

Start deterministic and boring. Fancy clustering can come later.

A first fingerprint can combine:

- `service.name`
- `environment`
- `error.type`
- normalized `error.message`
- top application stack frame
- `context.request.path` or source component when present

Store the fingerprint inputs so humans can understand why events were grouped.

### 3. Context Enrichment

Each accepted event should be enriched with:

- deploy version or git SHA
- source file and line from stack traces
- recent deploy metadata
- related commits
- project repair configuration
- reproduction hints from `error.details`

For local development, the client can send current branch, dirty state summary,
package manager, command being run, and failing test output.

### 4. Replicator Agent

The Replicator Agent should operate in an isolated checkout.

Inputs:

- grouped error summary
- representative event payload
- relevant source files
- project instructions
- allowed commands
- reproduction or diagnostic commands

Outputs:

- reproduction status
- TLDR
- likely cause
- commands run
- relevant logs and stack frames
- handoff file for the Worker Agent

### 5. Worker Agent

The Worker Agent should operate in an isolated checkout.

Inputs:

- Replicator Agent handoff file
- TLDR, likely cause, reproduction steps, commands, and logs
- relevant source files
- project instructions
- allowed commands
- verification command

Outputs:

- patch
- explanation
- commands run
- logs
- confidence
- failure reason when no safe patch is found

Keep the agent constrained. It should prefer the smallest code change that
addresses the observed failure and should never edit unrelated files as cleanup.

### 6. Verification

Every repair attempt needs evidence.

Minimum checks:

- apply patch cleanly
- run project-specific test command
- run formatter or linter when configured
- replay the original request/event when a replay fixture exists

If verification fails, keep the attempt for learning and show the failure in the
issue. Do not hide failed attempts; they are useful debugging history.

### 7. Human Review

For production, the default output should be a pull request.

The PR should include:

- error group link
- affected service and version
- reproduction notes
- proposed root cause
- validation output
- rollback considerations

Direct auto-merge can be a later opt-in feature for low-risk classes of changes
with strong tests.

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

- Implement `POST /v1/logs/errors`.
- Add storage for events, groups, and repair attempts.
- Add deterministic fingerprinting.
- Add a TypeScript SDK.
- Add a project config file for repository URL, install command, test command,
  and allowed repair paths.
- Add a repair worker that can create a patch in a sandbox checkout.
- Add GitHub pull request creation.
- Add a simple web UI for groups, attempts, and verification logs.

## Open Questions

- Which runtime should be supported first: Next.js, Python, or something else?
- Should AuraKeeper run as hosted SaaS, self-hosted infrastructure, or both?
- What source control provider is required first?
- What level of production autonomy is acceptable for the first customers?
- What data retention and redaction guarantees are required?
