# AuraKeeper Hook Playbook

The `aurakeeper hook` command should make the smallest safe integration for the
current project.

## Integration rules

- Prefer minimal, targeted edits over broad refactors.
- Do not hardcode secrets or environment-specific URLs.
- Use `AURAKEEPER_API_TOKEN` for the ingestion token.
- Use `AURAKEEPER_ENDPOINT` when an endpoint is needed. Default to
  `http://127.0.0.1:3000/v1/logs/errors` in local-oriented examples.
- Reuse the project's existing package manager, scripts, patterns, and entrypoints.
- Update README/setup docs when the integration adds new runtime steps.
- If the project already has a global error-reporting path, extend that instead
  of adding a second competing mechanism.

## Preferred outcomes

- Node.js or TypeScript apps: add a bootstrap or instrumentation file that
  captures unhandled exceptions and rejections.
- CLI tools: install process hooks close to the executable entrypoint.
- Python apps: use `sys.excepthook` or the app's existing startup path.
- Web/server frameworks: attach the smallest framework-appropriate integration
  and keep secrets in environment variables.

## Output expectations

- Make the code changes directly in the repository.
- Return a concise summary of what changed.
- List the changed files.
- Include any follow-up steps needed to finish setup.
