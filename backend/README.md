# AuraKeeper Backend

Basic Bun + Elysia + Drizzle + SQLite backend that implements the OpenAPI contract
from the repository root.

## Development

```bash
bun run dev
```

## Configuration

The server reads these environment variables:

- `ADMIN_TOKEN` - expected value for the `X-Admin-Token` header on `POST /v1/projects`. Defaults to `bahno`.
- `CORS_ALLOWED_ORIGINS` - comma-separated list of browser origins allowed to call the API. Defaults to `http://localhost:5173`.
- `DATABASE_PATH` - SQLite database location. Defaults to `data/aurakeeper.sqlite`.
- `ARTIFACTS_PATH` - persistent directory for copied repair artifacts. Defaults to `data/artifacts`.
- `CODEX_PATH` - path to the `codex` executable used by the repair agent client. Defaults to `codex`.
- `CODEX_MODEL` - optional model override passed to `codex exec`.
- `CODEX_PROFILE` - optional Codex profile name passed to `codex exec`.
- `CODEX_SANDBOX` - Codex sandbox mode for agent runs. Defaults to `workspace-write`.
- `PORT` - bind port. Defaults to `3000`.

Project-specific verification settings can also live in `.aurakeeper.json`,
`.aurakeeper.yml`, or `.aurakeeper.yaml` at the repository root. Frontend
projects can now configure browser automation for the `replicator` and `tester`
agents through a `browser` block, for example:

```json
{
  "browser": {
    "enabled": true,
    "roles": ["replicator", "tester"],
    "command": "agent-browser",
    "targetUrl": "http://127.0.0.1:3000",
    "startupCommand": "pnpm dev",
    "startupCwd": "frontend",
    "allowedDomains": ["127.0.0.1", "localhost"]
  }
}
```

When a browser-facing error is detected, the orchestrator passes this capability
to those agents and keeps the patched verification workspace alive long enough
for browser-based tester runs.

Repair attempts can now be durably linked to a stored error log. The helper in
`src/repair-artifacts.ts` copies the orchestration artifacts into
`ARTIFACTS_PATH/<projectId>/<errorLogId>/<repairAttemptId>/`, records metadata
in SQLite, and exposes them through:

- `GET /v1/logs/errors/:logId/repair-attempts`
- `GET /v1/logs/errors/:logId/artifacts/:artifactId`

The verification module also includes a `CodexCliAgentClient` in
`src/verification/codex-agent.ts`. It runs each orchestrator role through
`codex exec`, passes the role prompt plus serialized task payload on stdin, and
requires the final answer to match a JSON schema so the orchestrator can parse
structured agent output safely.

## Example Requests

Create a project and receive its ingestion token:

```bash
curl -X POST http://localhost:3000/v1/projects \
  -H 'Content-Type: application/json' \
  -H 'X-Admin-Token: bahno' \
  -d '{
    "name": "aura-web",
    "repair": {
      "checkoutPath": "/absolute/path/to/aura-web",
      "backend": "local",
      "environment": "local",
      "trustLevel": "trusted",
      "autoTrigger": true
    }
  }'
```

Update an existing project's repair behavior:

```bash
curl -X PATCH http://localhost:3000/v1/projects/<project-id> \
  -H 'Content-Type: application/json' \
  -H 'X-Admin-Token: bahno' \
  -d '{
    "repair": {
      "checkoutPath": "/absolute/path/to/aura-web",
      "backend": "local",
      "environment": "local",
      "trustLevel": "trusted",
      "autoTrigger": false
    }
  }'
```

Submit an error log using the returned project token:

```bash
curl -X POST http://localhost:3000/v1/logs/errors \
  -H 'Content-Type: application/json' \
  -H 'X-API-Token: <project-token>' \
  -d '{
    "occurredAt": "2026-04-18T08:32:17Z",
    "level": "error",
    "platform": "web",
    "service": { "name": "aura-web" },
    "source": { "runtime": "node", "language": "typescript" },
    "error": { "message": "Cannot read properties of undefined" }
  }'
```

List stored error logs for the project:

```bash
curl http://localhost:3000/v1/logs/errors \
  -H 'X-API-Token: <project-token>'
```

Accepted error logs are created with the default workflow state `new_error`.
If the project has `repair.autoTrigger: true` and a configured checkout path,
the backend immediately queues the Codex-backed repair pipeline for the new log
and advances the log state into the repair workflow.

Manually trigger a repair attempt for a previously stored log:

```bash
curl -X POST http://localhost:3000/v1/logs/errors/<log-id>/repair-attempts \
  -H 'Content-Type: application/json' \
  -H 'X-API-Token: <project-token>' \
  -d '{
    "issueSummary": "Focus on the stale dashboard value regression"
  }'
```

Connect a project-scoped Sentry source:

```bash
curl -X POST http://localhost:3000/v1/sources/sentry \
  -H 'Content-Type: application/json' \
  -H 'X-API-Token: <project-token>' \
  -d '{
    "organizationSlug": "acme",
    "projectSlug": "aura-web",
    "authToken": "sntrys_1234567890abcdef",
    "environment": "production",
    "maxEventsPerPoll": 100,
    "service": { "name": "aura-web", "version": "2026.04.18" },
    "source": {
      "runtime": "node",
      "language": "typescript",
      "framework": "next.js",
      "component": "app-router"
    }
  }'
```

Poll the configured Sentry source and import any new events into `error_logs`:

```bash
curl -X POST http://localhost:3000/v1/sources/sentry/<source-id>/poll \
  -H 'X-API-Token: <project-token>'
```

## Local Connector Examples

The backend exposes admin-protected development endpoints for launching
whitelisted connector examples from the web UI:

- `GET /v1/examples`
- `POST /v1/examples/:exampleId/runs`
- `GET /v1/examples/runs/:runId`

These endpoints execute local commands from the repository's
`examples/registry.json`, so they are intended for local development only and
require `X-Admin-Token`.
