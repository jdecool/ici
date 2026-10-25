SHELL := /bin/sh
.NOTPARALLEL:
TOOLS = docker compose -p ici-tools -f compose.tools.yaml
DEV = docker compose -p ici-dev -f compose.dev.yaml
PROD = docker compose -p ici -f compose.yaml
RUST = $(TOOLS) run --build --rm rust
NODE = $(TOOLS) run --build --rm node

.PHONY: bootstrap require-locks check-infra help dev check check-rust check-frontend test test-rust test-frontend coverage coverage-rust coverage-frontend mutation mutation-rust mutation-frontend audit audit-rust audit-frontend e2e build up down quality format
help:
	@echo 'bootstrap dev check test coverage mutation audit e2e build up down quality format'
bootstrap:
	sh scripts/bootstrap.sh
require-locks:
	@test -f Cargo.lock -a -f frontend/package-lock.json || { echo 'Missing dependency locks. Run make bootstrap with network access, then commit both lockfiles.' >&2; exit 1; }
dev: require-locks
	$(DEV) up --build
check: check-infra check-rust check-frontend
check-infra:
	docker compose -f compose.yaml config --quiet
	docker compose -f compose.dev.yaml config --quiet
	docker compose -f compose.tools.yaml config --quiet
	docker compose -f compose.bootstrap.yaml config --quiet
	set -e; for script in scripts/*.sh; do bash -n "$$script"; done
check-rust: require-locks
	$(RUST) sh scripts/check-rust.sh
check-frontend: require-locks
	$(NODE) npm run check
test: test-rust test-frontend
test-rust: require-locks
	$(RUST) cargo test --workspace --all-targets --locked
	$(RUST) cargo test --workspace --doc --locked
test-frontend: require-locks
	$(NODE) npm test
coverage: coverage-rust coverage-frontend
coverage-rust: require-locks
	$(RUST) sh scripts/coverage-rust.sh
coverage-frontend: require-locks
	$(NODE) npm run coverage
mutation: mutation-rust mutation-frontend
mutation-rust: require-locks
	$(RUST) sh scripts/mutation-rust.sh
mutation-frontend: require-locks
	$(NODE) npm run mutation
audit: audit-rust audit-frontend
audit-rust: require-locks
	$(RUST) cargo deny --locked check
audit-frontend: require-locks
	$(NODE) npm run audit:dependencies
e2e: require-locks
	sh scripts/e2e.sh
build: require-locks
	$(PROD) build backend web
up: require-locks
	$(PROD) up --build --detach --wait backend web
down:
	$(DEV) down --remove-orphans
	$(PROD) down --remove-orphans
	$(TOOLS) down --remove-orphans
quality: check test coverage mutation audit build e2e
format:
	$(RUST) cargo fmt --all
	$(NODE) npm run format
