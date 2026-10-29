# Development

The backend uses Rust/Axum and the frontend uses React/TypeScript/Vite, organized by capability. The French landing page follows `.design/`. Registration reserves a workspace, verifies email and provisions an isolated PostgreSQL database. Each tenant owns its accounts, consent records, sessions and password recovery. Its authenticated workspace manages presence locations, teams and users, including email invitations and verified email changes. Weekly presence planning, personal templates, configurable displayed weekdays and location occupancy are persisted per tenant.

See [Getting started](getting-started.md) for requirements, local startup, email activation and fixtures.

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

Reports appear under `reports/`, `frontend/coverage/`, `frontend/reports/`, `frontend/playwright-report/`, and `frontend/test-results/`. CI uploads them even when checks fail. See [quality policy](quality.md) for thresholds and exclusions, [architecture](architecture.md) for dependency boundaries, and [contribution guide](../CONTRIBUTING.md) for workflow.

## Bootstrap and reproducibility

Normal commands require Cargo.lock and frontend/package-lock.json, use `--locked`/`npm ci`, and never regenerate locks. `make bootstrap` is the explicit dependency-resolution operation for a new skeleton; run it with network access and commit both generated files before opening a PR. Versioned images and tools are declared in Dockerfiles, rust-toolchain.toml and frontend/package.json. The browser image version must equal @playwright/test.

GitHub Actions runs every gate on every PR and on main. After creating the remote repository, require the `quality` status check in branch protection. This repository does not publish images or deploy services automatically.

For restricted-environment validation results and remaining setup, see [validation record](validation.md).
