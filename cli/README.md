# AuraKeeper CLI

Python CLI for local onboarding and backend supervision.

## Development

```bash
cd cli
python3 -m pip install -e .
aurakeeper --help
```

## Commands

- `aurakeeper onboard --repo .` onboards a local Node.js repository, writes the
  connector bootstrap, provisions a local backend project, and starts the local
  worker pipeline.
- `aurakeeper start` starts the backend and the local fix worker.
- `aurakeeper start --no-worker` starts only the backend.
- `aurakeeper status --repo .` shows backend and worker process state and, when
  `.aurakeeper/config.json` is present, the current local project queue status.

## Local Workflow

The local worker pipeline uses the backend as the durable control plane:

1. `POST /v1/logs/errors` accepts a local error event.
2. The backend stores the event, upserts an error group, and enqueues a repair job.
3. The worker claims the job, writes run artifacts under `~/.aurakeeper/runs/`,
   runs Replicator and Worker Codex passes, and reports completion.
4. `aurakeeper status --repo .` or the local read APIs show grouped issues and attempts.

See [docs/local-e2e-workflow.md](../docs/local-e2e-workflow.md) for the full
end-to-end walkthrough.
