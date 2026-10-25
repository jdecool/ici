# Landing and tenant identity validation

Recorded on 2026-10-25 using the repository's Docker toolchains and real PostgreSQL/Mailpit services. Thresholds remain 90% coverage and 100% mutation detection. This replaces the original scaffold-only validation record.

## Functional checks

The Rust account contract exercises concurrent registration conflicts, receipt authorization, resend rotation, explicit email confirmation, durable provisioning, interrupted provisioning recovery, migration idempotence, consent persistence, independent accounts with the same email, PostgreSQL role isolation, host validation, Origin/CSRF enforcement, one-use/expired transfers, session expiry/logout, reset token reuse, session and transfer revocation, SMTP retry and rate limiting. Tests also invoke the real worker executable, including one-off tenant migrations and its continuous mode. Mutants interrupted before teardown are cleaned only in the explicitly designated test PostgreSQL instance.

Frontend tests exercise native workspace constraints, debouncing, obsolete responses, malformed JSON, network errors, field errors and retries, legal consent, email activation, polling completion/retry, general and tenant login, hidden form POST transfer, session loading/logout, password recovery and StrictMode effect cleanup. Planning-preview semantics and the intended stylesheet dimensions are checked without snapshots.

Production Playwright checks passed for two independently registered tenants created through captured emails, public and direct tenant login, independent credentials, password reset and revocation of the original session. Additional checks cover forged hosts, rejected origins, legal pages and unavailable backend states. Desktop (1280px) and mobile (390px) screenshots were inspected against the prototype; no horizontal overflow was observed.

`make e2e-https` passed with temporary mounted certificates covering both the root and wildcard hostname, certificate verification, HTTPS API routing, correct public-origin port and the HTTP redirect. Certificates and the isolated stack's volumes were removed afterwards.

The development stack was also started and checked at http://ici.localhost:5173. Vite forwards the original host/port; unknown tenants return 404 and nested tenant hosts return 400. Backend/worker reload and frontend HMR start successfully with separate cache volumes. Port 8025 was already occupied by an unrelated application, so this local run uses MAILPIT_PORT=18025. Regular development data and dependency caches are preserved.

## Final gate

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

The only mutation exclusions are three documented equivalent mutations on constant empty React effect dependency lists. No capability, adapter, UI text or application function is excluded. Thresholds were not lowered. The default `make` target was also checked to display help rather than invoke tenant migrations.

## Reports and remaining external setup

Coverage reports: `reports/coverage/rust/` and `frontend/coverage/`. Mutation reports: `reports/mutations/mutants.out/` and `frontend/reports/mutation/`. Browser reports and screenshots: `frontend/playwright-report/` and `frontend/test-results/`. Reports are generated artifacts and remain ignored by Git.

There is no configured GitHub remote URL, so branch-protection settings cannot be applied to a real repository from this checkout. After connecting the repository, require the aggregate `quality` check defined in `.github/workflows/quality.yml`. No commit, push or public deployment was performed.

The legal documents remain explicitly provisional, as requested. Public operation also requires environment-specific credentials, a unique registry encryption key, external TLS SMTP, DNS and root/wildcard certificates; see [operations](operations.md).
