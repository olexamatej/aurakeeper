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
- `DATABASE_PATH` - SQLite database location. Defaults to `data/aurakeeper.sqlite`.
- `PORT` - bind port. Defaults to `3000`.

## Example Requests

Create a project and receive its ingestion token:

```bash
curl -X POST http://localhost:3000/v1/projects \
  -H 'Content-Type: application/json' \
  -H 'X-Admin-Token: bahno' \
  -d '{
    "name": "aura-web"
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
