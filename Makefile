.PHONY: list run

EXAMPLE ?= $(word 2,$(MAKECMDGOALS))

list:
	@node -e 'const r=require("./examples/registry.json"); for (const e of r) console.log(`$${e.id}\t$${e.name}\t$${e.description}`)'

run:
	@node scripts/run-example.mjs "$(EXAMPLE)"

%:
	@:
