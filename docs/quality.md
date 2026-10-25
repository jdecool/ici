# Quality policy

## Gates

All gates run on every PR and main. Format, lint, type/static analysis, tests, coverage, mutations, dependency audits and production builds must succeed. GitHub's aggregate `quality` check fails when any matrix job fails or is cancelled. Configure it as a required branch-protection check after creating the remote repository.

Rust uses standard rustfmt, Clippy with warnings denied, Cargo tests, cargo-llvm-cov, cargo-mutants and cargo-deny. Frontend uses Prettier, typed ESLint (React, hooks, accessibility and architecture rules), tsc, Vitest, Testing Library, MSW, V8 coverage, Stryker and Playwright/Chromium. MSW rejects unexpected HTTP requests.

## Coverage

Backend: 90% lines and functions over application crates and HTTP adapters. Frontend: 90% lines, statements, functions and branches over all source files, including files not imported by tests. HTML and LCOV reports are retained. Unit/integration suites produce coverage; production E2E tests are a separate gate and are not merged into these percentages.

Explicit exclusions:

- Rust `server/src/main.rs`: process bootstrap, listener and OS signal wiring. Container health checks and E2E tests exercise startup and serving; signal behavior is not claimed to have coverage.
- Rust integration test source and test-only code: not application behavior.
- Frontend `src/main.tsx`: DOM mounting only, exercised by production browser tests.
- Frontend `src/**/index.ts`: export-only barrels with no executable logic. If logic is added, move it into measured source.
- Frontend test files and `src/test`: fixtures and test setup.

No core capability, HTTP adapter, API client, component or app composition is excluded. Record any future narrow exclusion here with the reason and compensating test.

## Mutations

Run full suites with `make mutation`. No incremental-only or changed-file-only shortcut substitutes for the PR gate. cargo-mutants must return zero: missed mutations, timeouts, baseline failures and tool errors fail the command; noncompiling mutants are inconclusive and excluded by the tool. Stryker's break threshold is 100, with HTML/JSON reports. Its score uses the runner's detected-mutant semantics (including detected timeouts); viable survivors and uncovered mutants reduce the score and fail the gate. Test infrastructure and bootstrap/export-only files have the same exclusions as coverage.

Never change thresholds to accommodate failing tests. Investigate equivalent mutants individually and document any narrowly justified suppression; no blanket exclusions are allowed.

## Audits and reproducibility

cargo-deny checks advisory, license and source policies. npm audit blocks high/critical advisories in production and development dependencies. Registry/advisory outages fail audit jobs instead of silently skipping them. Locked dependency installs are required in normal execution. Bootstrap is an explicit initial setup step, never a CI fallback.

See docs/validation.md for checks actually executed during scaffolding. Tool configuration is not evidence that a gate passed.

## Identity dependency license decisions

The SMTP quoted-printable encoder `quoted_printable` 0.5.2 uses the permissive 0BSD license. Rustls' Mozilla CA datasets `webpki-roots` 0.26.11 and 1.0.11 use CDLA-Permissive-2.0 for certificate data. `deny.toml` permits only these named, resolved versions under those licenses; it does not change the general license allowlist or advisory policy. SQLx and Lettre require these components for PostgreSQL/SMTP TLS. Workspace path dependencies also declare their exact package version, preserving the wildcard ban.

Vite and Vitest were upgraded to compatible patch releases (7.3.7 and 4.1.12) to fix advisories present in the original lockfile; npm audit fix refreshed vulnerable transitive development dependencies. No new frontend runtime dependency was added.

## Equivalent mutation decisions

Three mount-only React effects (App configuration, identity session and greeting) narrowly exclude the ArrayDeclaration mutation on their empty dependency lists: replacing [] with one constant string preserves the same effect lifetime across renders. Obsolete responses are still tested through StrictMode; no conditional or cleanup mutation is excluded. POST bodies, methods and headers remain mutation-tested. No UI text, field, whole function, capability or adapter is excluded.

## Database test isolation

Rust account contracts require TEST_DATABASE_URL and ICI_TEST_DATABASE=1, supplied only by the ici-tools Compose project. Before each contract run they clear the registry and drop generated ici_t_<UUID> databases/roles in that dedicated PostgreSQL instance. This also recovers from mutants killed before teardown. Never point the test environment at development or production data. Cache volumes remain persistent; regular dev/production databases are in separate Compose projects.

The tools stack's Mailpit requires explicit test SMTP authentication. Development and production-stack E2E capture also exercise unauthenticated local delivery. This detects regressions that accidentally omit configured SMTP credentials without requiring access to a real mail provider.
