# AuraKeeper CLI

Install globally:

```bash
npm install -g aurakeeper
```

Current commands:

- `aurakeeper hook` - inspect the current project, prompt for a preferred
  installation style, choose AuraKeeper or Sentry as the hook provider, and run
  a Codex-backed agent that integrates the selected setup into the repository.
- `aurakeeper local` - verify that the current project already has an
  AuraKeeper hook, offer to install it when missing, start a local AuraKeeper
  backend, provision a local project token, and optionally run a local dev
  command with the right `AURAKEEPER_*` environment variables injected.

## Requirements

- Node.js 20+
- `codex` available on `PATH`, or set `CODEX_PATH` / `AURAKEEPER_CODEX_PATH`
- `bun` available on `PATH`, or set `AURAKEEPER_BUN_PATH` for `aurakeeper local`

## Hook command

Run inside the project you want to instrument:

```bash
aurakeeper hook
```

Or select the provider up front:

```bash
aurakeeper hook --provider sentry
```

The command:

- inspects the current directory for common project manifests
- uses `@clack/prompts` for a small interactive TUI
- can install either AuraKeeper hooks or Sentry-based error capture
- can optionally collect the ingestion endpoint URL and API token up front for
  the AuraKeeper path
- runs a Codex agent in the current repository
- asks the agent to either apply a premade hook pattern or write a custom one
- reports changed files and follow-up steps

AuraKeeper integrations should use environment variables instead of hardcoded
credentials:

- `AURAKEEPER_API_TOKEN`
- `AURAKEEPER_ENDPOINT`

Sentry integrations should use environment variables as well, typically:

- `SENTRY_DSN`

## Local command

Run the local AuraKeeper backend for the current project:

```bash
aurakeeper local
```

Or start the backend and your dev server together:

```bash
aurakeeper local -- npm run dev
```

The command:

- checks whether an AuraKeeper hook is already present in the current project
- prompts to run the AuraKeeper hook installer when it is missing
- starts the repository's local backend on `http://127.0.0.1:3000` by default
- provisions or refreshes a local project with `repair.autoTrigger: true`
- writes reusable local credentials to `.aurakeeper/local.env`
- updates the project `.env` so AuraKeeper variables point at the local server
- injects the detected AuraKeeper env variables into the forwarded dev command
  when you pass one after `--`

Use `--port <number>` to bind the local backend to a different port.
