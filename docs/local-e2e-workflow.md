# Local E2E Workflow

This is the current local AuraKeeper loop for a Node.js repository:

1. Onboard the target repo with `aurakeeper onboard`.
2. The CLI starts the local backend and local fix worker if needed.
3. The connector sends an error to `POST /v1/logs/errors`.
4. The backend stores the raw log, upserts an `error_group`, and enqueues a `repair_job`.
5. The local worker claims the next pending job through `POST /v1/local/repair-jobs/claim`.
6. The worker writes run artifacts under `~/.aurakeeper/runs/<project-id>/<attempt-id>/`.
7. The worker runs a Codex Replicator pass, then a Codex Worker pass against the onboarded repo.
8. The worker runs the configured `testCommand` when present.
9. The worker reports the result through `POST /v1/local/repair-jobs/{jobId}/complete`.
10. The CLI and backend expose project state through `GET /v1/local/projects/{projectId}/status`.

## Prerequisites

- `bun` installed for the backend
- `python3` installed for the CLI
- `codex` installed and logged in for the local repair worker
- a Node.js repository with a `package.json`

## Setup AuraKeeper

Install the CLI in editable mode:

```bash
cd cli
python3 -m pip install -e .
```

Inside the target application repo, run onboarding:

```bash
aurakeeper onboard --repo . --port 3000 --admin-token bahno
```

That command currently:

- starts the local backend on `http://127.0.0.1:3000`
- starts a supervised local fix worker
- creates `.aurakeeper/config.json`
- generates `.aurakeeper/collector.js`
- writes `AURAKEEPER_API_TOKEN` and `AURAKEEPER_ENDPOINT` to `.env.local`
- installs the local JavaScript connector dependency
- stores project repair config in the backend SQLite database

You can also start the local services explicitly:

```bash
aurakeeper start --port 3000 --admin-token bahno
```

Check status from the onboarded repo:

```bash
aurakeeper status --repo .
```

## Emit a Local Error

After onboarding, start the target app normally. The generated collector bootstrap
loads the local connector and sends errors to the local backend.

For a direct backend smoke test, you can also submit a sample event manually:

```bash
curl -X POST http://127.0.0.1:3000/v1/logs/errors \
  -H "Content-Type: application/json" \
  -H "X-API-Token: <project-token>" \
  -d '{
    "occurredAt": "2026-04-18T10:00:00Z",
    "level": "error",
    "platform": "backend",
    "service": { "name": "demo-app" },
    "source": { "runtime": "node", "language": "typescript", "component": "worker" },
    "error": {
      "type": "TypeError",
      "message": "Cannot read properties of undefined",
      "stack": "TypeError: Cannot read properties of undefined\n    at src/index.ts:14:9"
    }
  }'
```

The backend immediately:

- stores the event in `error_logs`
- computes a deterministic fingerprint
- creates or updates an `error_group`
- enqueues a pending `repair_job` if there is no active job for that group

## Worker Execution

The local worker polls the backend every few seconds. When a job is available it:

- claims the job and creates a `repair_attempt`
- snapshots job context into `~/.aurakeeper/runs/<project-id>/<attempt-id>/job.json`
- runs a read-only Replicator Codex pass
- runs a workspace-write Worker Codex pass
- records `replicator.log`, `worker.log`, structured JSON outputs, and verification output
- completes the job with status `patched`, `failed`, or `needs_manual_review`

The first implementation edits the onboarded repository directly. It does not
yet create per-attempt worktrees.

## Inspect Results

Project-level workflow state:

```bash
curl -H "X-Admin-Token: bahno" \
  http://127.0.0.1:3000/v1/local/projects/<project-id>/status
```

Grouped issues:

```bash
curl -H "X-Admin-Token: bahno" \
  "http://127.0.0.1:3000/v1/local/error-groups?projectId=<project-id>"
```

Repair attempts:

```bash
curl -H "X-Admin-Token: bahno" \
  "http://127.0.0.1:3000/v1/local/repair-attempts?projectId=<project-id>"
```

Run artifacts on disk:

```text
~/.aurakeeper/
  logs/
    backend.log
    worker.log
  runs/
    <project-id>/
      <attempt-id>/
        job.json
        replicator-output.json
        replicator.log
        worker-output.json
        worker.log
        verification.json
```

## Current Limits

- the worker expects `codex exec` to be available locally
- repair attempts operate on the live repo checkout, not an isolated worktree
- verification currently runs only the configured `testCommand`
- queue retry and backoff logic are not implemented yet
