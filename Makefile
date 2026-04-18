SHELL := /bin/bash

.PHONY: doctor bootstrap test check build validate validate-all validate-container app-validate-container examples-doctor examples-validate examples-validate-container list run verify-example run-all

EXAMPLE ?= $(word 2,$(MAKECMDGOALS))
DEV_IMAGE ?= aurakeeper-dev:local
DEV_WORKDIR ?= /workspaces/aurakeeper

doctor:
	@missing=0; \
	for cmd in node npm bun pnpm python3 ruby php go javac java mvn dotnet; do \
		if ! command -v $$cmd >/dev/null 2>&1; then \
			echo "Missing tool: $$cmd"; \
			missing=1; \
		fi; \
	done; \
	if [[ $$missing -ne 0 ]]; then \
		echo "Run in the dev container or install the missing tools above."; \
		exit 2; \
	fi; \
	echo "Toolchain is ready."

bootstrap:
	@command -v bun >/dev/null 2>&1 || { echo "bun is required (use the dev container)."; exit 2; }
	@command -v npm >/dev/null 2>&1 || { echo "npm is required (use the dev container)."; exit 2; }
	@command -v pnpm >/dev/null 2>&1 || { echo "pnpm is required (run: corepack enable && corepack prepare pnpm@latest --activate)."; exit 2; }
	@cd backend && bun install --frozen-lockfile
	@cd frontend && CI=true pnpm install --frozen-lockfile
	@cd connectors/nextjs/examples/app-router && node -e "require('node:fs').rmSync('node_modules',{recursive:true,force:true,maxRetries:10,retryDelay:100})" && npm install --no-audit --no-fund --no-package-lock
	@cd connectors/react-native/examples/basic && node -e "require('node:fs').rmSync('node_modules',{recursive:true,force:true,maxRetries:10,retryDelay:100})" && npm install --no-audit --no-fund --no-package-lock

test:
	@cd backend && bun test

check:
	@cd backend && bun run check
	@cd frontend && pnpm lint

build:
	@cd backend && bun run check
	@cd frontend && pnpm build
	@cd connectors/jvm && mvn -q package
	@dotnet build connectors/dotnet/examples/ConsoleApp/ConsoleApp.csproj -v minimal

validate: doctor bootstrap test check build

validate-all: validate
	@AURAKEEPER_API_TOKEN="$${AURAKEEPER_API_TOKEN:-dummy}" AURAKEEPER_ENDPOINT="$${AURAKEEPER_ENDPOINT}" $(MAKE) run-all

examples-doctor:
	@missing=0; \
	for cmd in node npm python3 ruby php go javac java mvn dotnet; do \
		if ! command -v $$cmd >/dev/null 2>&1; then \
			echo "Missing tool for examples: $$cmd"; \
			missing=1; \
		fi; \
	done; \
	if [[ $$missing -ne 0 ]]; then \
		echo "Install the missing tools above or run in the examples container workflow."; \
		exit 2; \
	fi; \
	echo "Example toolchain is ready."

examples-validate: examples-doctor
	@AURAKEEPER_API_TOKEN="$${AURAKEEPER_API_TOKEN:-dummy}" AURAKEEPER_ENDPOINT="$${AURAKEEPER_ENDPOINT}" $(MAKE) run-all

validate-container: examples-validate-container

examples-validate-container:
	@docker build -f .devcontainer/Dockerfile -t "$(DEV_IMAGE)" .
	@docker run --rm \
		-v "$$(pwd):$(DEV_WORKDIR)" \
		-w "$(DEV_WORKDIR)" \
		-e AURAKEEPER_API_TOKEN="$$AURAKEEPER_API_TOKEN" \
		-e AURAKEEPER_ENDPOINT="$$AURAKEEPER_ENDPOINT" \
		"$(DEV_IMAGE)" \
		bash -lc 'source .devcontainer/post-create.sh && make examples-validate'

app-validate-container:
	@docker build -f .devcontainer/Dockerfile -t "$(DEV_IMAGE)" .
	@docker run --rm \
		-v "$$(pwd):$(DEV_WORKDIR)" \
		-w "$(DEV_WORKDIR)" \
		-e AURAKEEPER_API_TOKEN="$$AURAKEEPER_API_TOKEN" \
		-e AURAKEEPER_ENDPOINT="$$AURAKEEPER_ENDPOINT" \
		"$(DEV_IMAGE)" \
		bash -lc 'source .devcontainer/post-create.sh && make validate-all'

list:
	@node -e 'const r=require("./examples/registry.json"); for (const e of r) console.log(`$${e.id}\t$${e.name}\t$${e.description}`)'

run:
	@AURAKEEPER_API_TOKEN="$${AURAKEEPER_API_TOKEN:-dummy}" AURAKEEPER_ENDPOINT="$${AURAKEEPER_ENDPOINT}" node scripts/run-example.mjs "$(EXAMPLE)"

verify-example:
	@node scripts/verify-example.mjs "$(EXAMPLE)"

run-all:
	@ids=$$(node -e 'const r=require("./examples/registry.json"); console.log(r.map((e) => e.id).join(" "))'); \
	rc=0; \
	for id in $$ids; do \
		echo ""; \
		echo "=== $$id ==="; \
		AURAKEEPER_API_TOKEN="$${AURAKEEPER_API_TOKEN:-dummy}" AURAKEEPER_ENDPOINT="$$AURAKEEPER_ENDPOINT" node scripts/run-example.mjs "$$id"; \
		code=$$?; \
		if [ $$code -ne 0 ]; then \
			rc=$$code; \
		fi; \
	done; \
	exit $$rc

%:
	@:
