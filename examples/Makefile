.PHONY: doctor bootstrap test check build validate validate-all validate-container list run run-all

EXAMPLE ?= $(word 2,$(MAKECMDGOALS))

doctor:
	@$(MAKE) -C .. doctor

bootstrap:
	@$(MAKE) -C .. bootstrap

test:
	@$(MAKE) -C .. test

check:
	@$(MAKE) -C .. check

build:
	@$(MAKE) -C .. build

validate:
	@$(MAKE) -C .. validate

validate-all:
	@$(MAKE) -C .. validate-all

validate-container:
	@$(MAKE) -C .. validate-container

list:
	@$(MAKE) -C .. list

run:
	@node ../scripts/run-example.mjs "$(EXAMPLE)"

run-all:
	@$(MAKE) -C .. run-all

%:
	@:
