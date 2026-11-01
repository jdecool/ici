# Quality policy

## Gates

All gates run on every PR and main. Format, lint, type/static analysis, tests, coverage, mutations, dependency audits and production builds must succeed. GitHub's aggregate `quality` check fails when any matrix job fails or is cancelled. Configure it as a required branch-protection check after creating the remote repository.

The CI matrix groups checks by language and production stack. Each language installs dependencies once and runs its unit/integration suite with coverage, rather than repeating the same suite without instrumentation. Rust doctests remain a separate mandatory command. Standalone test, coverage and audit targets remain available. Production images are built once before the HTTP and HTTPS stacks run in separate Compose projects; standalone E2E commands still build their own images.

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

The mount-only React effects for App configuration narrowly exclude the ArrayDeclaration mutation on their empty dependency lists: replacing [] with one constant string preserves the same effect lifetime across renders. Obsolete responses are still tested through StrictMode; no conditional or cleanup mutation is excluded. POST bodies, methods and headers remain mutation-tested. No UI text, field, whole function, capability or adapter is excluded.

The organization dialog's mounted ref is non-null when its effect runs and the captured element remains available during cleanup. Only OptionalChaining mutations on these two defensive ref accesses are excluded; tests verify opening, closing, Escape behavior, busy-state cancellation and focus restoration. Its constant dependency-array mutation has the same mount-only equivalence described above. Two workspace empty-array fallbacks are consumed only while data is absent, when member/user content is not rendered; only ArrayDeclaration mutations on those fallback expressions are excluded. A StringLiteral mutation on the new-team-member editor discriminant is also equivalent at runtime: both the valid value and the mutated value take the user-form/save branch, and the new record has no ID that could trigger a current-account refresh. Only that literal is excluded; TypeScript statically enforces its union type. All loading, filtering, authorization, action and rendering conditions remain measured.

## Database test isolation

Rust account contracts require TEST_DATABASE_URL and ICI_TEST_DATABASE=1, supplied only by the ici-tools Compose project. Before each contract run they clear the registry and drop generated ici_t_<UUID> databases/roles in that dedicated PostgreSQL instance. This also recovers from mutants killed before teardown. Never point the test environment at development or production data. Cache volumes remain persistent; regular dev/production databases are in separate Compose projects.

Planning and organization contracts provision only their own two tenants, independently of the account lifecycle. A shared asynchronous lock serializes these contracts because they reset the same registry and PostgreSQL roles. Interrupted outbox-renaming tests are recovered before initialization. Rust mutations remain sequential against this shared instance.

The tools stack's Mailpit requires explicit test SMTP authentication. Development and production-stack E2E capture also exercise unauthenticated local delivery. This detects regressions that accidentally omit configured SMTP credentials without requiring access to a real mail provider.

The occupancy chart narrowly excludes OptionalChaining on its defensive weekday-label lookup. The authenticated planning API rejects all weekday indexes outside 0–6, for which the seven labels are present. Removing only the optional access has identical runtime behavior on accepted data; histogram values, selection, labels and normalization remain mutation-tested.

Planning also narrowly excludes three equivalents: the default renderer's `null` versus `undefined` return (both render no React content), the initial loading boolean (a null week independently selects the same loading branch before either response handler resets loading), and the mount-only subscription dependency array (the same constant-sentinel equivalence as other mount effects). No response, authorization, state-transition or event-handler condition is excluded.

The planning toolbar also excludes only OptionalChaining on the selected-user name lookup: a selection can originate only from a current user, and every refresh or view change clears it before the user collection changes. The lookup predicate and the visible selected name remain mutation-tested.

Planning behavior tests record browser error events and assert that none occurred after every test. This converts deliberately broken pointer mutants into explicit failed assertions instead of triggering a Vitest/Stryker error-formatting crash. Default error reporting is prevented only inside that test suite while the error message is retained for the mandatory assertion; errors are never ignored or accepted.

The initial `moved` pointer flag narrowly excludes BooleanLiteral: every pointer-down resets it before permission, button or touch guards, and keyboard activation ignores it. Its initial value therefore cannot affect a real interaction. Touch activation after mouse dragging is explicitly tested; no event-handler reset or permission guard is excluded.

## Local mutation runtime

Keep asynchronous race tests deterministic: hold obsolete HTTP responses with
`src/test/responseGate.ts`, observe the current response, then release the obsolete
response before asserting that the current UI is preserved. Do not replace this
ordering with fixed sleeps or shorten global timeouts to improve mutation scores.

Member input and planning date/half-day validation have direct unit tests so invalid
mutations fail before the PostgreSQL lifecycle contracts. Those contracts remain
mandatory. Planning and organization share a lazily computed password hash within
one test process; identity tests still exercise real password hashing and login.
No production cryptographic parameters or mutation scopes are changed.
