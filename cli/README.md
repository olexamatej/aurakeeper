# AuraKeeper CLI

Install globally:

```bash
npm install -g aurakeeper
```

Current commands:

- `aurakeeper hook` - inspect the current project, prompt for a preferred
  installation style, and run a Codex-backed agent that integrates AuraKeeper
  into the repository.

## Requirements

- Node.js 20+
- `codex` available on `PATH`, or set `CODEX_PATH` / `AURAKEEPER_CODEX_PATH`

## Hook command

Run inside the project you want to instrument:

```bash
aurakeeper hook
```

The command:

- inspects the current directory for common project manifests
- uses `@clack/prompts` for a small interactive TUI
- can optionally collect the ingestion endpoint URL and API token up front
- runs a Codex agent in the current repository
- asks the agent to either apply a premade hook pattern or write a custom one
- reports changed files and follow-up steps

The generated integration should use environment variables instead of hardcoded
credentials:

- `AURAKEEPER_API_TOKEN`
- `AURAKEEPER_ENDPOINT`
