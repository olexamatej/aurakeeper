# AuraKeeper

AuraKeeper is a repository-local control plane for autonomous GitHub issue execution.

The intended control model is:

1. A Codex session owns the repository.
2. You type `<start>` to Codex.
3. Codex launches the local supervisor daemon from this repo.
4. The daemon polls GitHub issues and pull requests until stopped.

## Quick start

Bootstrap the repository state and GitHub metadata once:

```bash
./bin/aurakeeper bootstrap-github
```

Start the autonomous loop:

```bash
./bin/aurakeeper start --detach
```

Check status:

```bash
./bin/aurakeeper status
```

Stop the loop:

```bash
./bin/aurakeeper stop
```

## What the supervisor does

- polls open GitHub issues
- classifies issue complexity
- spawns up to 32 worker agents with `claude --dangerously-skip-permissions --worktree <issue>`
- requires each worker to open a PR before exit
- polls ready PRs
- reviews PRs with a Claude reviewer pass
- merges safe PRs
- spawns remediation workers for fixable review findings

## Dashboard

AuraKeeper ships a web dashboard for monitoring agents, issues, and pull requests.

### 1. Start the state server

The state server exposes orchestrator state files over HTTP (default port 8787):

```bash
# via Makefile
make serve-state

# or directly
python3 scripts/state_server.py --port 8787

# or via the CLI
./bin/aurakeeper serve-state --port 8787
```

### 2. Start the frontend dev server

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server (port 5173) proxies `/api` requests to the state server
automatically, so no extra environment variables are needed for local
development.

Open <http://localhost:5173/dashboard> to view the monitoring dashboard.

### Production / custom API URL

If the state server runs on a different host or port, set `VITE_API_BASE`
before building:

```bash
VITE_API_BASE=http://my-host:8787 npm run build
```

## Repository files

- [OPERATIONS.md](OPERATIONS.md): policy and operating model
- [REPOSITORY_SETUP.md](REPOSITORY_SETUP.md): git initialization, upstream changes, and daily sync commands
- [CLAUDE.md](CLAUDE.md): repository instructions for Claude workers
- [scripts/orchestrator.py](scripts/orchestrator.py): supervisor and bootstrap commands
- [bin/aurakeeper](bin/aurakeeper): executable wrapper
