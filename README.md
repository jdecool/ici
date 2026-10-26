# ici

A Rust/Axum backend and React/TypeScript/Vite frontend, organized by capability. The French landing page follows `.design/`. Registration reserves a workspace, verifies email and provisions an isolated PostgreSQL database. Each tenant owns its accounts, consent records, sessions and password recovery. Its authenticated workspace manages presence locations, teams and users, including email invitations and verified email changes. Weekly presence planning, personal templates, configurable displayed weekdays and location occupancy are persisted per tenant.

## Start

Install Docker with Compose v2 and Make. Copy `.env.example` to `.env` only to override the host ports or logging. Rust and Node are provided by the containers.

```sh
# First checkout only, if Cargo.lock or frontend/package-lock.json is absent:
make bootstrap
# Review and include the generated locks in the first commit.
make dev
```

Open http://ici.localhost:5173. Rust reloads when backend files change; React uses Vite HMR. Initial image builds compile the Rust quality tools and can take several minutes. Subsequent builds reuse Docker layers and named dependency/build caches.

```sh
make up      # Production images at http://ici.localhost:8080
make down    # Stop services, preserving caches
```

Development email is captured by Mailpit at http://localhost:8025. Tenant workspaces use `http://<workspace>.ici.localhost:5173` (port 8080 for the local production images). PostgreSQL persists across `make down`; E2E uses its own disposable database volume. See [operations](docs/operations.md) for configuration, production SMTP, TLS, migrations and backup/restore.

Development and production use a same-origin proxy for `/api`, avoiding browser CORS configuration. Production also proxies `/health`. The backend is reachable on port 3000 only within the Compose network.

## Password policy

New passwords require 8–128 characters including a lowercase letter, an uppercase letter, an ASCII digit and a symbol or punctuation character. Existing passwords remain usable for login.

## Development fixtures

```sh
make fixtures        # Create or reset ACME only; preserve other workspaces
make reset-fixtures  # Delete ALL development data, reload ACME and start the app
```

`make reset-fixtures` stops the `ici-dev` stack and deletes its PostgreSQL volume, including every workspace and tenant database. It preserves build/dependency caches, local files and other Compose projects. There is no interactive confirmation. Failures stop the command; rerun after resolving the error.

Open http://acme.ici.localhost:5173 after `make dev` or `make reset-fixtures`:

| Role | Email | Password |
| --- | --- | --- |
| Administrator | admin@example.com | password |
| Collaborator | user@example.com | password |

ACME contains ten active accounts, three locations (Paris - Siège, Lyon - Confluence, Lyon - Part Dieu), and random weekday half-day presence across five weeks centered on the current Europe/Paris week. All demo accounts use `password`; this is an explicit fixture-only exception. Reloading fixtures replaces ACME data and invalidates its sessions; it sends no emails.

## Repository map

```text
backend/crates/
  server/src/tenancy/    Workspace rules, registration, registry and worker
  server/src/identity/   Account rules, authentication and adapters
  server/src/organization/ Location and team rules and HTTP handlers
  server/src/planning/   Presence rules, calendar and HTTP handlers
  server/tests/         HTTP integration contracts
frontend/src/
  app/                  Application composition
  features/tenancy/     Registration, availability and activation status
  features/identity/    Login, email verification, recovery and invitations
  features/organization/ Locations, teams and user administration
  features/planning/    Weekly presence, templates and occupancy
  shared/               Transport validation and form fields
  test/                 Shared test infrastructure
frontend/e2e/            Production-stack browser and HTTP tests
docs/                    Architecture, quality policy and decisions
scripts/                 Shared local/CI commands
.github/workflows/       Required quality gates
```

## Quality commands

| Command | Purpose |
| --- | --- |
| `make check` | Format, lint, static analysis and frontend architectural boundaries |
| `make test` | Unit, HTTP integration, React integration and Rust doc tests |
| `make coverage` | 90% minimum backend and frontend coverage |
| `make mutation` | Full mutation runs with 100% required score |
| `make audit` | Dependency vulnerabilities, Rust licenses and sources |
| `make e2e-https` | Verify mounted TLS certificates, HTTPS routing and redirects |
| `make e2e` | Build, start and test production containers; always tear down |
| `make build` | Build production images |
| `make migrate-tenants` | Apply migrations to every active tenant database |
| `make quality` | All required gates |
| `make format` | Apply source formatting |

Use serial Make invocations; tool services share cache volumes. `make e2e` uses an isolated project name and a dynamically allocated host port, so it can run alongside the regular production stack.

Reports appear under `reports/`, `frontend/coverage/`, `frontend/reports/`, `frontend/playwright-report/`, and `frontend/test-results/`. CI uploads them even when checks fail. See [quality policy](docs/quality.md) for thresholds and exclusions, [architecture](docs/architecture.md) for dependency boundaries, and [contribution guide](CONTRIBUTING.md) for workflow.

## Bootstrap and reproducibility

Normal commands require Cargo.lock and frontend/package-lock.json, use `--locked`/`npm ci`, and never regenerate locks. `make bootstrap` is the explicit dependency-resolution operation for a new skeleton; run it with network access and commit both generated files before opening a PR. Versioned images and tools are declared in Dockerfiles, rust-toolchain.toml and frontend/package.json. The browser image version must equal @playwright/test.

GitHub Actions runs every gate on every PR and on main. After creating the remote repository, require the `quality` status check in branch protection. This repository does not publish images or deploy services automatically.

For restricted-environment validation results and remaining setup, see [validation record](docs/validation.md).
