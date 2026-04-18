# AuraKeeper Backend

Basic Bun + Elysia + Drizzle + SQLite backend that implements the OpenAPI contract
from the repository root.

## Development

```bash
bun run dev
```

## Configuration

The server reads these environment variables:

- `ADMIN_TOKEN` - expected value for local admin endpoints such as project creation, onboarding config, workflow status, and repair job coordination. Defaults to `bahno`.
- `DATABASE_PATH` - SQLite database location. Defaults to `data/aurakeeper.sqlite`.
- `PORT` - bind port. Defaults to `3000`.

## Local Workflow Surface

The backend now acts as the local workflow control plane as well as the
ingestion service. In addition to project creation and error ingestion, it
supports:

- collector selection for local onboarding
- local project config storage
- local project workflow status reads
- error group listing
- repair attempt listing
- repair job claim and completion endpoints for the local worker

The OpenAPI contract in [`../openapi.yaml`](../openapi.yaml) is the source of
truth for these endpoints.

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

See [docs/local-e2e-workflow.md](../docs/local-e2e-workflow.md) for the full
onboard -> ingest -> queue -> claim -> complete loop.
