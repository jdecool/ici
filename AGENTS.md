# Agent instructions

## Project and scope

ici is a containerized Rust/Axum and React/TypeScript monorepo. It provides a public landing page, tenant registration, email activation and isolated tenant authentication. Read this file, the nearest nested AGENTS.md, README.md, and docs/architecture.md before changing code. All source identifiers, comments, documentation, and commit messages are English.

## AI / Agent rules

* Think Before Coding: No silent assumptions. Push back if a simpler approach exists.
* Simplicity First: Minimum code required. No speculative features.
* Surgical Changes: Touch only what you must. Do not “improve” adjacent formatting.
* Goal-Driven Execution: Define success criteria and loop until verified, rather than blindly following rigid steps.

### Rule 1 — Think Before Coding

State assumptions explicitly. If uncertain, ask rather than guess.
Push back when a simpler approach exists. Stop when confused.

### Rule 2 — Simplicity First

Minimum code that solves the problem. Nothing speculative.
No features beyond what was asked. No abstractions for single-use code.

### Rule 3 — Surgical Changes

Touch only what you must. Clean up only your own mess.
Don't "improve" adjacent code, comments, or formatting. Match existing style.

### Rule 4 — Goal-Driven Execution

Define success criteria. Loop until verified.
Don't follow steps. Define success and iterate independently.

### Rule 5 — Token budgets are not advisory

Per-task: 4,000 tokens. Per-session: 30,000 tokens.
If approaching budget, summarize and start fresh. Surface the breach.

### Rule 6 — Read before you write

Before adding code, read exports, immediate callers, shared utilities.
If unsure why code is structured a certain way, ask.

### Rule 7 — Checkpoint after every significant step

Summarize what was done, what's verified, what's left.
Don't continue from a state you can't describe back. Stop and restate.

### Rule 8 — Fail loud

"Completed" is wrong if anything was skipped silently.
"Tests pass" is wrong if any were skipped.
Default to surfacing uncertainty, not hiding it.

## Architecture

Organize work by capability, not by global technical layers. The Rust server crate groups rules, use cases and adapters by capability. Dependencies point inward toward framework-independent rules and use cases. Frontend features own their API clients, types, UI and tests; other features and app composition consume their index.ts entry point. Do not invent ports, repositories, databases or abstractions without a real use case.

## Setup and commands

Prerequisites: Docker with Compose v2 and Make. No host Rust or Node installation is required. If dependency locks have not yet been generated, run `make bootstrap`, review Cargo.lock and frontend/package-lock.json, and include them in the first commit. CI never generates missing locks.

- `make fixtures`: create or reset ACME demonstration data in development only.
- `make reset-fixtures`: delete all development database data, reload ACME and restart development services.
- `make dev`: backend reload and frontend HMR; http://ici.localhost:5173.
- `make check`: formatting, lint, type/static analysis and frontend architecture checks.
- `make test`: Rust unit/integration/doc tests and frontend unit/integration tests.
- `make coverage`: enforce 90% coverage in each language.
- `make mutation`: Rust and frontend mutation suites over the scope in docs/quality.md; 100% required.
- `make audit`: dependency vulnerability/license/source policy checks.
- `make e2e`: build and test production containers in an isolated Compose project.
- `make e2e-https`: verify mounted root/wildcard certificates, HTTPS routing and HTTP redirects in a disposable stack.
- `make build`: build production images; `make up`: run them on http://ici.localhost:8080.
- `make migrate-tenants`: apply migrations to all active tenant databases using the privileged worker.
- `make quality`: the complete CI-equivalent gate.
- `make format`: intentionally rewrite formatting; `make down`: stop project services without deleting persistent caches.

Read docs/operations.md when changing provisioning, SMTP, secrets, TLS or backup procedures. See nested files for focused commands. Do not run commands concurrently against the same tool/cache volumes. CI uses isolated runners.

## Working agreement

1. Inspect current code, local instructions and tests before editing. Keep changes focused on the requested behavior.
2. Preserve the user's work. Do not reset or clean the worktree, create commits, push, or deploy unless requested.
3. Add meaningful behavior tests for changed behavior and regressions. Test public contracts and observable results, not implementation details.
4. Update documentation and architecture decisions when commands, boundaries, contracts or tooling change.
5. Run relevant checks during development, then all required checks before declaring the work complete. Report exact results and environmental blockers; never claim unrun checks passed.
6. Do not lower thresholds, suppress failing tests, introduce broad lint disables, or exclude application code to obtain a green build. Record a concrete justification for any narrow technical exclusion in docs/quality.md.
7. Explain new dependencies. Update and commit lockfiles with dependency changes; production and CI use locked installs. Never put credentials or local .env files in version control.

## Completion and review

Required checks: format, lint, static analysis, unit/integration/doc tests, coverage, mutations, dependency audits, production builds and functional/E2E tests. No surviving viable mutants are accepted. Branch protection must require GitHub's `quality` check. Configuration lives in .github/workflows/quality.yml; there is no automatic publication or deployment.

Do not automatically delegate work: use multiple agents only when explicitly requested. Keep this file aligned with executable commands rather than adding generic guidance.
