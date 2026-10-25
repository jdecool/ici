# ici

A Rust/Axum backend and React/TypeScript/Vite frontend, organized by capability. React displays the message from `GET /api/hello`; there is no database or authentication.

## Start

Install Docker with Compose v2 and Make. Copy `.env.example` to `.env` only to override the host ports or logging. Rust and Node are provided by the containers.

```sh
# First checkout only, if Cargo.lock or frontend/package-lock.json is absent:
make bootstrap
# Review and include the generated locks in the first commit.
make dev
```

Open http://localhost:5173. Rust reloads when backend files change; React uses Vite HMR. Initial image builds compile the Rust quality tools and can take several minutes. Subsequent builds reuse Docker layers and named dependency/build caches.

```sh
make up      # Production images at http://localhost:8080
make down    # Stop services, preserving caches
```

Development and production use a same-origin proxy for `/api`, avoiding browser CORS configuration. Production also proxies `/health`. The backend is reachable on port 3000 only within the Compose network.

## Repository map

```text
backend/crates/
  greeting/             Independent greeting capability
  server/src/greeting/  HTTP adapter for that capability
  server/tests/         HTTP integration contracts
frontend/src/
  app/                  Application composition
  features/greeting/    Greeting UI, client and tests
  test/                 Shared test infrastructure
frontend/e2e/            Production-stack browser and HTTP tests
docs/                    Architecture, quality policy and decisions
scripts/                 Shared local/CI commands
.github/workflows/       Required quality gates
```

## Quality commands

| Command | Purpose |
| --- | --- |
| `make check` | Format, lint, static analysis and architectural boundaries |
| `make test` | Unit, HTTP integration, React integration and Rust doc tests |
| `make coverage` | 90% minimum backend and frontend coverage |
| `make mutation` | Full mutation runs with 100% required score |
| `make audit` | Dependency vulnerabilities, Rust licenses and sources |
| `make e2e` | Build, start and test production containers; always tear down |
| `make build` | Build production images |
| `make quality` | All required gates |
| `make format` | Apply source formatting |

Use serial Make invocations; tool services share cache volumes. `make e2e` uses an isolated project name and a dynamically allocated host port, so it can run alongside the regular production stack.

Reports appear under `reports/`, `frontend/coverage/`, `frontend/reports/`, `frontend/playwright-report/`, and `frontend/test-results/`. CI uploads them even when checks fail. See [quality policy](docs/quality.md) for thresholds and exclusions, [architecture](docs/architecture.md) for dependency boundaries, and [contribution guide](CONTRIBUTING.md) for workflow.

## Bootstrap and reproducibility

Normal commands require Cargo.lock and frontend/package-lock.json, use `--locked`/`npm ci`, and never regenerate locks. `make bootstrap` is the explicit dependency-resolution operation for a new skeleton; run it with network access and commit both generated files before opening a PR. Versioned images and tools are declared in Dockerfiles, rust-toolchain.toml and frontend/package.json. The browser image version must equal @playwright/test.

GitHub Actions runs every gate on every PR and on main. After creating the remote repository, require the `quality` status check in branch protection. This repository does not publish images or deploy services automatically.

For restricted-environment validation results and remaining setup, see [validation record](docs/validation.md).
