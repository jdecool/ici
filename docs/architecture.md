# Architecture

## Capabilities

The Rust workspace contains independent `tenancy` and `identity` cores, the original `greeting` capability and `ici-server`. Tenancy owns workspace normalization, exact host boundaries and the registration use case with an atomic reservation/outbox port. Identity owns account validation, terms version, session policy and the login use case with account and password-verification ports. The server implements these outgoing ports with PostgreSQL and Argon2 adapters. The cores depend on neither Axum, Tokio nor Serde. The server owns HTTP DTOs, PostgreSQL/SQLx adapters, cryptography, SMTP and composition. Adapters are grouped under their capability. There are no global controller/service/repository layers.

The frontend `app` composes the landing page and public feature exports. `tenancy` owns registration, availability and status; `identity` owns login, verification, recovery and tenant home. `shared` contains transport parsing and form fields. ESLint enforces imports through other features' export-only index files. External JSON is parsed from unknown, and effects ignore obsolete responses. No router or state-management dependency is needed for the ordinary page URLs.

## Data and processes

The HTTP process connects to the central registry with a role limited to DML. It resolves validated tenant hosts only when their registry state is active. A bounded cache opens tenant pools using encrypted per-tenant credentials. PostgreSQL itself denies cross-tenant database connections; a missing application filter cannot merge users from separate databases.

The privileged `ici-worker` process initializes the registry, performs idempotent role/database provisioning, runs tenant migrations, inserts the first administrator/consent, marks the tenant active, and delivers encrypted outbox messages through SMTP. It has a separate runtime credential absent from HTTP. PostgreSQL advisory locking serializes cycles across workers. Retry state survives restarts.

The central schema owns workspace reservations, pending registrations, verification digests, provisioning states, encrypted connection credentials, encrypted outbox entries, short-lived login transfer digests and rate-limit windows. Each tenant database owns company, users, consents, sessions and password reset digests. SQL migrations are embedded at build time under `server/migrations/central` and `server/migrations/tenant`.

See [the identity decision](decisions/0002-tenant-identity.md) for security policy, dependency rationale and failure semantics, and [operations](operations.md) for secrets, migrations, TLS and recovery.

## HTTP contracts

All product endpoints are under `/api` and return JSON unless otherwise stated. Errors contain a stable `code` and optional `fields` map. Invalid input is 422, conflicting reservations 409, missing sessions 401, rejected origins/CSRF 403 and rate limits 429. Infrastructure failures return 503 without internal details. JSON/form decoding errors use the same error envelope. `/health` returns JSON and checks central connectivity.

| Request | Purpose |
| --- | --- |
| GET /api/config | Public origin, domain, tenant context and accepted terms version |
| GET /api/tenants/availability?slug=… | Indicative availability; registration settles conflicts atomically |
| POST /api/registrations | Reserve a workspace and atomically enqueue verification; returns opaque receipt |
| POST /api/registrations/resend | Rotate verification token using Bearer receipt |
| POST /api/registrations/verify | Explicitly consume token and queue provisioning; returns fresh receipt |
| GET /api/registrations/status | Poll state using Authorization: Bearer receipt |
| POST /api/auth/login | Validate tenant account; return one-use code and tenant POST target |
| POST /api/auth/handoff | Consume form-encoded code, set local cookie and redirect with 303 to / |
| GET /api/auth/session | Current tenant user, company and CSRF token |
| POST /api/auth/logout | Revoke session; requires X-CSRF-Token |
| POST /api/auth/forgot-password | Always report sent for existing/unknown valid accounts |
| POST /api/auth/reset-password | Consume token, change password, revoke sessions and login transfers |
| GET /api/hello | Original greeting contract retained |
| GET /health | Registry liveness; no host-specific authentication |

Mutation requests require an exact Origin matching the current host's configured origin; handoff additionally accepts the configured public origin. The Host must match the configured scheme's port and be either the root or exactly one valid workspace label below it. Unknown, inactive, nested and misleading suffix hosts are rejected, as are URI user information and malformed or noncanonical ports in Host. Registration routes are available only on the root origin. Cookie scope is always host-only. Public login never places a transfer code in the URL.

## Runtime

Vite explicitly permits `ici.localhost` and its subdomains for local HMR and forwards the original Host to the same-origin `/api` proxy. Nginx preserves Host including port, serves the SPA and proxies APIs and health. Production services run as unprivileged users. The optional HTTPS override uses mounted certificates and retains the original host/port. Docker DNS aliases resolve E2E public and tenant hosts to that isolated stack's web service rather than container loopback.

Local development/test SMTP uses Mailpit. Public SMTP is supplied by configuration; no hosting or deployment is automated. GitHub's `quality` aggregate remains the required branch-protection check.
