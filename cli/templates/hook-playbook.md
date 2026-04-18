# AuraKeeper Hook Playbook

The `aurakeeper hook` command should make the smallest safe integration for the
current project.

When the selected provider is Sentry, apply the same minimal-edit rules but use
the project's existing Sentry conventions and environment variables such as
`SENTRY_DSN` instead of AuraKeeper runtime hooks.

## Integration rules

- Prefer minimal, targeted edits over broad refactors.
- Do not hardcode secrets or environment-specific URLs.
- Use `AURAKEEPER_API_TOKEN` for the ingestion token.
- Use `AURAKEEPER_ENDPOINT` when an endpoint is needed. Default to
  `http://127.0.0.1:3000/v1/logs/errors` in local-oriented examples.
- Make sure the installed hook actually runs with the project's `.env` values
  available.
- Prefer attaching the hook at an entrypoint that already loads `.env`. If the
  project does not load `.env` yet, add the smallest conventional loading step
  needed for the hook to see `AURAKEEPER_ENDPOINT` and `AURAKEEPER_API_TOKEN`.
- Treat [`openapi.yaml`](../../openapi.yaml) as the source of truth for
  AuraKeeper payloads and headers.
- AuraKeeper hooks must send `POST /v1/logs/errors` requests that match the
  `ErrorLogRequest` schema.
- Required top-level fields are `occurredAt`, `level`, `platform`, `service`,
  `source`, and `error`.
- `service.name` is required.
- `source.runtime` and `source.language` are required. `framework` and
  `component` are optional.
- `error.message` is required. `type`, `code`, `stack`, `handled`, and
  `details` are optional.
- Put extra metadata under `error.details` or `context`. Do not invent extra
  top-level keys.
- Send the API token in `X-API-Token` or `Authorization: Bearer <token>`.
- Reuse the project's existing package manager, scripts, patterns, and entrypoints.
- Update README/setup docs when the integration adds new runtime steps.
- If the project already has a global error-reporting path, extend that instead
  of adding a second competing mechanism.

## Preferred outcomes

- Node.js or TypeScript apps: add a bootstrap or instrumentation file that
  captures unhandled exceptions and rejections.
- CLI tools: install process hooks close to the executable entrypoint. Prefer
  reusing [`connectors/cli/aurakeeper.js`](../../connectors/cli/aurakeeper.js)
  when that fits cleanly instead of hand-writing fetch payloads.
- Python apps: use `sys.excepthook` or the app's existing startup path.
- Web/server frameworks: attach the smallest framework-appropriate integration
  and keep secrets in environment variables.

## CLI hook payload baseline

When you must write a custom CLI hook instead of reusing the shipped connector,
the request body should look like this:

```json
{
  "eventId": "optional-client-id",
  "occurredAt": "2026-04-18T08:32:17Z",
  "level": "error",
  "platform": "cli",
  "environment": "development",
  "service": {
    "name": "repo-doctor",
    "version": "2026.04.18"
  },
  "source": {
    "runtime": "node",
    "language": "javascript",
    "component": "main"
  },
  "error": {
    "type": "Error",
    "message": "Command failed",
    "stack": "Error: Command failed...",
    "handled": false,
    "details": {
      "argv": [
        "npm",
        "test"
      ],
      "cwd": "/workspace/repo"
    }
  },
  "context": {
    "tags": [
      "cli",
      "local-dev"
    ],
    "session": {
      "argv": [
        "npm",
        "test"
      ],
      "cwd": "/workspace/repo"
    }
  }
}
```

## Output expectations

- Make the code changes directly in the repository.
- Return a concise summary of what changed.
- List the changed files.
- Include any follow-up steps needed to finish setup.
