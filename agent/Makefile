PYTHON := python3

.PHONY: bootstrap-github start status stop serve-state

bootstrap-github:
	./bin/aurakeeper bootstrap-github

start:
	./bin/aurakeeper start --detach

status:
	./bin/aurakeeper status

stop:
	./bin/aurakeeper stop

serve-state:
	$(PYTHON) scripts/state_server.py

