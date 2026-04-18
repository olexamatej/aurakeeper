# AuraKeeper

AuraKeeper automatically fixes errors in production and in local development setups.

For local development, run everything with one command from the repository root:

```bash
./run-local.sh
```

This script creates missing local `.env` defaults, installs backend/frontend
dependencies, and starts both services together.

OpenAPI spec: see [openapi.yaml](openapi.yaml). Treat it as ground truth that all parts of the monorepop must adhear to. Keep it in sync in case something changes.

Application connectors are in the `connectors/` folder.
Each connector should live in its own subdirectory and include:

- the connector implementation file(s)
- a `README.md` describing usage and setup
- any package/runtime metadata needed for that connector such as `package.json`
- an `examples/` directory for concrete runtime setup examples when applicable
