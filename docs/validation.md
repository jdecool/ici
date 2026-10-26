# Landing and tenant identity validation

> Latest status: backend consolidation checks are validated. The consolidation results below supersede the earlier delivery checkpoints.

Recorded on 2026-10-25 using the repository's Docker toolchains and real PostgreSQL/Mailpit services. Thresholds remain 90% coverage and 100% mutation detection. This replaces the original scaffold-only validation record.

## Functional checks

The Rust account contract exercises concurrent registration conflicts, receipt authorization, resend rotation, explicit email confirmation, durable provisioning, interrupted provisioning recovery, migration idempotence, consent persistence, independent accounts with the same email, PostgreSQL role isolation, host validation, Origin/CSRF enforcement, one-use/expired transfers, session expiry/logout, reset token reuse, session and transfer revocation, SMTP retry and rate limiting. Tests also invoke the real worker executable, including one-off tenant migrations and its continuous mode. Mutants interrupted before teardown are cleaned only in the explicitly designated test PostgreSQL instance.

Frontend tests exercise native workspace constraints, debouncing, obsolete responses, malformed JSON, network errors, field errors and retries, legal consent, email activation, polling completion/retry, general and tenant login, hidden form POST transfer, session loading/logout, password recovery and StrictMode effect cleanup. Planning-preview semantics and the intended stylesheet dimensions are checked without snapshots.

Production Playwright checks passed for two independently registered tenants created through captured emails, public and direct tenant login, independent credentials, password reset and revocation of the original session. Additional checks cover forged hosts, rejected origins, legal pages and unavailable backend states. Desktop (1280px) and mobile (390px) screenshots were inspected against the prototype; no horizontal overflow was observed.

`make e2e-https` passed with temporary mounted certificates covering both the root and wildcard hostname, certificate verification, HTTPS API routing, correct public-origin port and the HTTP redirect. Certificates and the isolated stack's volumes were removed afterwards.

The development stack was also started and checked at http://ici.localhost:5173. Vite forwards the original host/port; unknown tenants return 404 and nested tenant hosts return 400. Backend/worker reload and frontend HMR start successfully with separate cache volumes. Port 8025 was already occupied by an unrelated application, so this local run uses MAILPIT_PORT=18025. Regular development data and dependency caches are preserved.

## Identity delivery gate (historical)

The final `make quality` aggregate completed successfully (exit 0). Formatting, lint, type/static and architecture analysis, unit/integration/doc tests, coverage, full mutation suites, dependency audits, production builds, Playwright E2E and the mounted-certificate HTTPS check all passed.

| Check | Final result |
| --- | --- |
| Rust tests | 20 passed; doc tests passed |
| Frontend tests | 120 passed across 10 files |
| Rust coverage | 97.75% lines (1652/1690), 98.01% functions (197/201) |
| Frontend coverage | 100% lines, statements, functions and branches |
| Rust mutations | 248 tested: 183 detected, 65 noncompiling; zero survivors or timeouts |
| Frontend mutations | 678 detected; zero survivors, uncovered mutants or timeouts; 100% |
| Dependency audits | Rust advisories, bans, licenses and sources passed; npm reported zero vulnerabilities |
| Production browser tests | 4 passed |
| HTTPS | Trusted root/wildcard certificates, API origin/port and HTTP redirect passed |

At that checkpoint, the only mutation exclusions were three documented equivalent mutations on constant empty React effect dependency lists. No capability, adapter, UI text or application function is excluded. Thresholds were not lowered. The default `make` target was also checked to display help rather than invoke tenant migrations.

## Reports and remaining external setup

Coverage reports: `reports/coverage/rust/` and `frontend/coverage/`. Mutation reports: `reports/mutations/mutants.out/` and `frontend/reports/mutation/`. Browser reports and screenshots: `frontend/playwright-report/` and `frontend/test-results/`. Reports are generated artifacts and remain ignored by Git.

There is no configured GitHub remote URL, so branch-protection settings cannot be applied to a real repository from this checkout. After connecting the repository, require the aggregate `quality` check defined in `.github/workflows/quality.yml`. No commit, push or public deployment was performed.

The legal documents remain explicitly provisional, as requested. Public operation also requires environment-specific credentials, a unique registry encryption key, external TLS SMTP, DNS and root/wildcard certificates; see [operations](operations.md).

## Organization delivery — 2026-10-25

Locations, teams, user administration, invitations and verified email changes were implemented and validated. Existing tenant administrators are preserved by the versioned tenant migration, with no initial team/location assignment. No external dependency was added; Cargo.lock adds only the local organization capability crate.

| Check | Result |
| --- | --- |
| Formatting, lint, types/static analysis and architecture | Passed for Rust and frontend; Compose configurations and shell syntax passed |
| Rust tests | 21 passed; workspace doc tests passed; no ignored tests |
| Frontend tests | 182 passed across 15 files; architecture tests passed |
| Rust coverage | 98.07% lines, 98.18% functions |
| Frontend coverage | 100% lines/statements/functions, 99.37% branches |
| Rust mutations | Full 389-mutant run: 245 caught, 134 noncompiling, 10 initially missed; stronger tests then caught all 14 mutations selected around those surviving branches, including all 10 survivors; no timeouts |
| Frontend mutations | Full runs followed by survivor rechecks on unchanged application code: 1,432 caught, 8 documented equivalents ignored; 100%; zero survivors, uncovered mutants, timeouts or runner errors |
| Audits | Rust advisory/license/source policies passed; npm reported zero vulnerabilities |
| Production builds and E2E | Images built; all 4 Playwright tests passed, including real Mailpit invitations, collaborator access, verified email change, deactivation and reactivation |
| HTTPS | Mounted root/wildcard certificates, configured API origin/port and HTTP redirects passed |

The individual gates were executed explicitly; the `make quality` aggregate was not invoked for this delivery. Full mutation passes identified missing assertions, which were added without removing existing tests or lowering thresholds. The final Rust survivor recheck is in `reports/mutations-recheck/mutants.out/`; the original full run remains in `reports/mutations/mutants.out/`. The frontend report combines the full run and subsequent checks of its remaining mutants using Stryker's report cache. Only the narrow equivalent mutations documented in [quality](quality.md) are excluded.

The database contracts cover tenant isolation, permissions/CSRF, deletion constraints, upgrade from the previous schema, invitation expiration/rotation, pending-account recovery denial, email reservation/confirmation/cancellation, session/handoff revocation, SMTP retry across worker restarts, serialized writes and concurrent administrator changes. The browser workflow also checks the collaborator's restricted navigation and captures desktop/mobile workspace screenshots; both were visually inspected with no horizontal overflow.

Run `make migrate-tenants` against an existing installation before reopening the upgraded HTTP application, as described in [operations](operations.md). This validation used disposable test stacks and did not migrate development/production data, create commits, push or deploy.

## Planning implementation checkpoint — 2026-10-25

Configuration, team planning, personal presence, weekly templates and location occupancy are implemented with tenant persistence. Templates overwrite existing displayed slots without confirmation. No sample presence data is inserted. Tenant migration `0003_planning.sql` must run before reopening an existing installation.

The current worktree includes pre-existing organization/identity changes, which were preserved. Planning adds the local capability crate and enables the existing UUID dependency's Serde feature for typed JSON transport; no new external library was introduced.

| Check | Observed result |
| --- | --- |
| Static checks | Initial `make check` passed; final Rust static/workspace/doc tests passed; final frontend format/lint/types/architecture passed |
| Frontend tests and coverage | Final run: 205 passed, 19 files; 95.84% lines, 95.61% statements, 93.76% branches, 93.44% functions |
| Rust coverage | Full gate passed before the subsequent boundary-test additions and redundant calendar-precheck removal: 98.03% lines, 97.54% functions |
| Audits and production builds | Passed in the full gate sequence; production images rebuilt by subsequent E2E runs |
| HTTP E2E | Final rerun: 4 passed; includes configuration, four-week template overwrite, reload persistence, occupancy, administrator edits and mobile overflow assertion |
| HTTPS E2E | Passed in the full gate sequence |
| Rust mutations | Initial full run: 557 tested, 374 caught, 167 unviable, 16 missed. Three redundant precheck mutations were removed by simplifying the precheck. Boundary and validation tests then caught 21 of 22 targeted mutants; the final year-9999 boundary test caught the remaining mutant. Original and recheck logs are preserved |
| Frontend mutations | Full campaign is still running on its initial source/test snapshot. Survivors and a timeout have already been detected. Quality acceptance is incomplete |

The E2E regression exposed two pointer issues: re-entering the same slot incorrectly counted as dragging, and rendering the floating selection toolbar on pointer-down could cover the cell before click completion. A pending drag now stays in a ref until a different slot is entered. The regression test verifies that pointer-down alone exposes no toolbar and a simple click opens the editor. New navigation tabs also wrap to avoid mobile overflow.

Reports for this checkpoint are in `reports/planning/`. `results.txt` records the original gate sequence, so its failed HTTP E2E/Rust mutation entries are superseded by `e2e-final.log`, `rust-recheck.log` and `rust-year-recheck.log`. `rust-final-check.log`, `pointer-overlay-fix.log` and `frontend-final-coverage.log` describe the final checks. Do not interpret the original matrix as a fully green `make quality` run.

Remaining work: let the full frontend mutation run finish, inspect `frontend/reports/mutation/mutation.json`, strengthen behavior tests for viable survivors and timeouts, and recheck against the current tree (the MyWeek and pointer regression tests were added after that campaign started). Preserve the full report before incremental rechecks. Do not lower thresholds or exclude application code. Revalidate affected checks after any further source changes. No commit, push, deployment or migration of a developer/production database was performed.

## Planning continuation checkpoint — 2026-10-25

The initial full frontend mutation campaign finished and its report was preserved as `frontend/reports/mutation/planning-initial-full.json`. Behavior tests were strengthened without lowering thresholds. Targeted rechecks now report 100% for the API/calendar (256 killed), MyWeek/Occupancy/PresenceEditor (214 killed), and Planning/Workspace (1,027 killed, no surviving or uncovered mutants). Two pointer mutants in that last report initially crashed Vitest/Stryker's error formatter. Planning tests now record browser errors and assert that none occurred, converting these invalid event handlers into ordinary failed assertions. A fresh, non-incremental recheck of all eight mutations on the affected pointer condition reports eight killed, zero survivors, uncovered mutants, timeouts or runner errors. See `reports/planning/pointer-runner-final.log`.

The final continuation test/coverage run passes 260 frontend tests. Formatting, ESLint, TypeScript and architecture checks pass. The complete Chromium E2E workflow passes four tests, including mouse dragging followed by keyboard activation, configuration/template persistence and mobile overflow. A further regression test verifies that selecting the already-current week performs a real refresh rather than trapping the loading state. Navigation and mutation refreshes now share selection/editor cleanup, and the multi-slot payload uses an inclusive slice rather than a mutable index loop. Notes are validated against the server's 500-Unicode-character limit.

The original full Rust mutation pass and its successful survivor rechecks remain documented above. No Rust application source has changed since those rechecks. New equivalent-mutation exclusions are limited to the defensive weekday lookup, default null/undefined renderer, initial loading sentinel, mount-only subscription dependency list and selected-user lookup described in `docs/quality.md`. No authorization, response, handler or transition condition is excluded.

A fresh `make quality` aggregate is currently running, with its full output in `reports/planning/quality-final.log`. Its checks, tests and coverage have completed and it has reached the full 552-mutant Rust campaign. This is the required final acceptance run; do not mark the overall delivery complete until it exits successfully. Subsequent gates include the full frontend mutation suite, audits, production builds and HTTP/HTTPS E2E. The process was started in exec session 19663. Resume by inspecting that log and process status, address any actual failures, then update this record with the aggregate result. No commit, push, deployment or migration of developer/production databases was performed.


## Final planning validation — 2026-10-26

All required checks are now validated. Configuration, team planning, personal presence, weekly templates and location occupancy are persisted and covered by behavior tests. Existing uncommitted organization and identity work was preserved.

| Check | Final result |
| --- | --- |
| Formatting, lint, TypeScript, Rust static analysis and architecture | Passed |
| Rust tests | 23 passed, no ignored tests; workspace doc tests passed |
| Frontend tests | 261 passed across the complete suite |
| Coverage | Rust: 98.25% lines, 97.85% functions. Frontend: 99.86% lines, 99.87% statements, 98.81% branches, 99.67% functions. Both 90% gates passed |
| Full Rust mutations | 552 tested: 385 caught, 167 unviable, zero survivors or timeouts |
| Full frontend mutations | 2,528 killed, 100% score, zero surviving/uncovered mutants, timeouts or runner errors |
| Dependency audits | Rust advisory/license/source checks passed; npm reported zero vulnerabilities |
| Production builds | Backend, worker and web images built successfully |
| Production HTTP E2E | Four passed, including presence persistence, template overwrite, occupancy, mouse/keyboard interaction and responsive layout |
| Production HTTPS E2E | Mounted root/wildcard certificates, API routing and HTTP redirects passed |

The initial `make quality` completed its Rust gates but stopped on one frontend mutant. That case exposed touch activation following a mouse drag. The pointer flag now resets before the touch/permission guards, and a regression test verifies the transition. The complete frontend static checks, tests, coverage and mutation suite were rerun successfully; the remaining `make audit build e2e e2e-https` stages then completed with exit code zero. Rust application code was unchanged, so its already-passing full suite was not repeated. This records successful completion of every required gate, rather than claiming that the interrupted aggregate command itself exited successfully.

Final evidence: `reports/planning/quality-final.log` (full Rust gates), `reports/planning/frontend-quality-final.log` (complete final frontend validation), and `reports/planning/quality-final-remaining.log` (audits, builds and E2E). The final Stryker report is `frontend/reports/mutation/mutation.json`; Rust outcomes are in `reports/mutations/mutants.out/outcomes.json`. Earlier failed or partial reports remain for diagnosis and are superseded by these results.

Apply `make migrate-tenants` before reopening an existing installation with tenant migration `0003_planning.sql`. No developer/production database was migrated, and no commit, push or deployment was performed.


## Backend consolidation — 2026-10-26

The backend now uses one `ici-server` crate with capability modules; the greeting demonstration and `/api/hello` are removed. All required gates passed across the following runs; the initial `make quality` aggregate itself did not finish successfully.

- Initial `make quality`: configuration, formatting, lint, static analysis, Rust unit/integration/doc tests, frontend tests, coverage and full Rust mutations passed. Rust coverage reached 98.25% lines and 97.82% functions; all 546 mutants were classified (383 caught, 163 unviable, no survivors or timeouts).
- The initial frontend mutation run crashed with a missing Stryker installation file while another Node container used the shared tools cache. An isolated Node volume avoided the crash. That complete run found two surviving mutations in the existing current-week calculation. Regression cases now assert the exact Monday for Monday, Wednesday, Sunday and a year boundary, without changing application behavior.
- Final `make check-frontend test-frontend coverage-frontend mutation-frontend`, using the isolated Node project, passed: 249 tests, coverage thresholds met and 100% mutation detection with no survivors or timeouts.
- `make audit build e2e e2e-https` passed, including four production Playwright scenarios and mounted root/wildcard certificate, HTTPS routing and HTTP redirect checks. The frontend audit reported zero vulnerabilities; Rust advisory, dependency, license and source checks passed.

Logs are retained under `reports/backend-consolidation/`: `quality.log`, `frontend-mutation-first.log`, `frontend-final.log` and `remaining.log`. Detailed mutation reports remain in `reports/mutations/mutants.out/outcomes.json` and `frontend/reports/mutation/mutation.json`. Docker commands ran sequentially against each shared cache; frontend retries used project `ici-refactor-validation` to avoid interference from another tools process. Existing local changes were preserved. No commit, push or deployment was performed.
