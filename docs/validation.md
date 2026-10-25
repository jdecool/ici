# Scaffold validation

Recorded on 2026-10-25. This is a validation record, not a claim that the complete CI suite is green.

## Executed successfully

- `cargo test --workspace --all-targets --locked --offline`: 5 tests passed (one core unit test and four HTTP integration tests).
- `cargo test --workspace --doc --locked --offline`: passed; no doctests currently defined.
- `cargo build --workspace --locked --offline`: passed.
- `cargo fmt --all -- --check`: passed.
- `cargo clippy --workspace --all-targets --all-features --locked --offline -- -D warnings`: passed.
- `bash scripts/check-architecture.sh`: passed; uses jq to inspect Cargo metadata.
- The Bash architecture guard also passed 11 isolated scenarios: allowed core/server and test dependencies, rejection of seven infrastructure dependencies, malformed JSON, and Cargo failure propagation.
- `node --test frontend/eslint/*.test.js`: 14 positive/negative boundary-rule checks passed.
- Prettier 3.9.10, extracted from the existing local package cache: frontend formatting check passed.
- `make check-infra`: all four Compose definitions and shell script syntax passed.
- ShellCheck on scripts and actionlint on the GitHub Actions workflow: passed.
- TOML/JSON manifests parsed successfully.
- An additional native Node check imported the real TypeScript API client and exercised 13 success, invalid-payload, HTTP-error, network-error and invalid-JSON cases with a stubbed fetch. This was not the Vitest/MSW suite.

## Environmental blockers

The managed sandbox denies access to the Docker socket and binding a local TCP listener. Network requests from npm to registry.npmjs.org fail with ENOTFOUND. Rust dependencies and Cargo.lock are available, but the complete frontend dependency tree is not. Creation of .git is also denied by the workspace permission profile.

Consequently, frontend/package-lock.json has not been generated. Full frontend ESLint/TypeScript/Vitest checks, measured coverage, mutation runs, dependency audits, container builds and Playwright E2E runs have not been verified. No coverage percentage or mutation score has been claimed. The Rust HTTP integration tests use the actual router in-process; the real-listener smoke test was blocked before serving a request.

## Finish initialization in an unrestricted development environment

```sh
git init -b main
make bootstrap
make quality
make dev
```

Bootstrap preserves the existing Cargo.lock and generates the missing frontend lock using the pinned dependencies. Review and include both lockfiles in version control before opening the first PR. Normal builds and CI require locks and never silently regenerate them. Resolve any errors exposed by the complete suite; do not reduce thresholds or suppress tests.

After creating the GitHub repository, make the aggregate `quality` check mandatory in branch protection. No remote repository, commit, push or deployment has been created by this scaffold.
