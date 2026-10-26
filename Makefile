SHELL := /bin/sh
.NOTPARALLEL:
TOOLS = docker compose -p ici-tools -f compose.tools.yaml
DEV = docker compose -p ici-dev -f compose.dev.yaml
PROD = docker compose -p ici -f compose.yaml
RUST = $(TOOLS) run --build --rm rust
NODE = $(TOOLS) run --build --rm node

.PHONY: fixtures migrate-tenants bootstrap require-locks check-infra help dev check check-rust check-frontend test test-rust test-frontend coverage coverage-rust coverage-frontend mutation mutation-rust mutation-frontend audit audit-rust audit-frontend e2e e2e-https build up down quality format
help:
	@printf '%s\n' \
		'   ___       _       .---.' \
		'  |_ _| ___ (_)     /  o  \' \
		'   | | / __|| |     \     /' \
		'   | || (__ | |      \   /' \
		'  |___|\___||_|       \_/' \
		'' \
		'  Usage: make <target>' \
		'' \
		'  Development' \
		'    bootstrap          Generate missing dependency lockfiles' \
		'    dev                Start development servers with live reload' \
		'    fixtures           Reload ACME demonstration data in development' \
		'    format             Apply Rust and frontend formatting' \
		'    down               Stop development, production and tool services' \
		'' \
		'  Quality' \
		'    check              Run formatting, lint and static analysis checks' \
		'    test               Run unit, integration and Rust doc tests' \
		'    coverage           Enforce 90% coverage in each language' \
		'    mutation           Run mutation suites (100% required)' \
		'    audit              Check dependency vulnerabilities and policies' \
		'    e2e                Test production containers in an isolated stack' \
		'    e2e-https          Verify HTTPS routing and HTTP redirects' \
		'    quality            Run all required quality gates' \
		'' \
		'  Focused checks' \
		'    check-infra        Validate Compose files and shell script syntax' \
		'    check-rust         Run Rust formatting, lint and static analysis' \
		'    check-frontend     Run frontend formatting, lint and type checks' \
		'    test-rust          Run Rust unit, integration and doc tests' \
		'    test-frontend      Run frontend unit and integration tests' \
		'    coverage-rust      Enforce Rust coverage' \
		'    coverage-frontend  Enforce frontend coverage' \
		'    mutation-rust      Run Rust mutation tests' \
		'    mutation-frontend  Run frontend mutation tests' \
		'    audit-rust         Check Rust dependencies, licenses and sources' \
		'    audit-frontend     Check frontend dependencies' \
		'' \
		'  Production' \
		'    build              Build production images' \
		'    up                 Start production services in the background' \
		'    migrate-tenants    Apply migrations to all active tenant databases' \
		'' \
		'  Run make help (or make) to display this help.'
migrate-tenants: require-locks
	$(PROD) run --rm worker --migrate-tenants
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
	PUBLIC_ORIGIN=https://ici.localhost docker compose -f compose.yaml -f compose.https.yaml config --quiet
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
e2e-https: require-locks
	sh scripts/e2e-https.sh
build: require-locks
	$(PROD) build backend worker web
up: require-locks
	$(PROD) up --build --detach --wait backend worker web
down:
	$(DEV) down --remove-orphans
	$(PROD) down --remove-orphans
	$(TOOLS) down --remove-orphans
quality: check test coverage mutation audit build e2e e2e-https
format:
	$(RUST) cargo fmt --all
	$(NODE) npm run format

fixtures: require-locks
	sh scripts/fixtures.sh
