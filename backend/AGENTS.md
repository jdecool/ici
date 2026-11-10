# Backend instructions

Root AGENTS.md also applies.

## Structure and conventions

- Keep capabilities as modules under backend/crates/server/src/<capability>, with pure validation in rules.rs and use cases beside adapters.
- Keep HTTP adapters under server/src/<capability>. Only the server composition root wires adapters and opens sockets.
- Domain and application code must not import Axum, Tokio, Serde, transport DTOs or infrastructure. A real outgoing dependency is modeled as a core-owned port and an adapter implementing it. Do not add a trait solely to wrap a pure function.
- Use Rust 2024, standard rustfmt, snake_case functions/modules, UpperCamelCase types, minimal visibility and idiomatic ownership. Prefer explicit error types at domain boundaries, Result propagation and exhaustive matching.
- unsafe is forbidden. Do not use unwrap/expect in application code. Tests should return Result when practical. Do not blanket-enable every pedantic Clippy lint or suppress warnings globally.
- Keep stable HTTP contracts covered by server integration tests. Do not serialize domain types directly just to simplify a handler.

## Focused checks

Commands below run from the repository root:

```sh
docker compose -p ici-tools -f compose.tools.yaml run --build --rm rust cargo test --locked -p ici-server --lib
docker compose -p ici-tools -f compose.tools.yaml run --build --rm rust cargo test --locked -p ici-server --test http
make check-rust
make coverage-rust
make mutation-rust
make audit-rust
```

Put unit tests in each module's cfg(test) block and public integration tests in the server crate's tests directory. HTTP tests build the actual router through tower::ServiceExt without opening a port. Account contracts require the tools stack PostgreSQL and Mailpit services; do not silently skip these tests when PostgreSQL is absent. The worker executable is also exercised as a subprocess with runtime secrets. Functional tests run against production images via make e2e.

Coverage includes all capability modules and HTTP adapters, requiring 90% lines/functions. Only process startup and signal handling in server/src/main.rs is excluded; its startup is exercised through container health checks. cargo-mutants mutates the pure domain listed in .cargo/mutants.toml (rules.rs files and framework-independent identity/tenancy logic) and must succeed with no missed mutations or timeouts. Do not exclude crates or adapters from coverage, and do not move logic out of the mutation scope to avoid a surviving mutant.
