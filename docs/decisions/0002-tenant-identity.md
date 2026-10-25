# Tenant identity and database isolation

Status: accepted. Product UI remains French; implementation and operational documentation use English.

## Decision

Capability cores own the registration and login use cases and their outgoing reservation, account and password-verification ports. The server supplies SQLx/Argon2 adapters; The corresponding HTTP handlers map these use cases to stable transport contracts.

A central PostgreSQL registry reserves normalized workspace names for 24 hours. An atomic unique constraint decides concurrent reservations. An opaque receipt authorizes status polling and resends; verification tokens are hashed and consumed by an explicit POST. Clicking an email GET never provisions infrastructure.

Each tenant owns a database on a shared PostgreSQL instance. Database and role names use a generated UUID, never user input. The application role has only CONNECT, schema USAGE and table DML. PUBLIC access to tenant databases and schemas is revoked; tenant roles cannot create databases, roles or tables. The central application role cannot create infrastructure. The HTTP process has no provisioner credential.

`ici-worker` owns privileged DDL, central and tenant SQLx migrations, provisioning retries and SMTP delivery. A PostgreSQL advisory lock serializes worker cycles. Credentials are persisted encrypted before DDL starts, allowing interrupted role creation, database creation, migration and administrator insertion to resume. CREATE DATABASE is deliberately outside a transaction. Administrator and consent insertion is atomic and idempotent. Only the completed tenant becomes active. Failed provisioning remains visible and retries with capped exponential backoff. Existing tenant migrations run with `make migrate-tenants`.

The registry stores encrypted connection URLs and encrypted SMTP payloads using AES-256-GCM with a runtime key. Sent outbox entries are deleted. Delivery is at least once: a crash after SMTP acceptance and before deletion can duplicate an email. Pending password hashes and personal information are removed from the registry after successful provisioning. Unverified reservations are purged on expiry.

Passwords use Argon2id with unique random salts. Accounts and sessions belong to one tenant; email domains never determine membership. A public login creates a 60-second hashed transfer code. A form POST from the configured public origin to the tenant consumes it and sets a host-only session cookie. Codes and passwords never appear in redirect URLs. Credential versions prevent outstanding transfers racing a password reset from reopening a revoked session. A row lock serializes session creation and password resets for the account.

Session cookies are HttpOnly, SameSite=Lax, Secure under HTTPS, with server expirations of 12 hours or 30 days. Origin validation protects unauthenticated mutations; authenticated logout also requires a session-bound CSRF token. There is no parent-domain cookie. Email links carry tokens in fragments. The API uses no-store and no-referrer. HTML pages use strict-origin-when-cross-origin so the browser retains Origin on the cross-origin form POST; fragments and POST bodies never enter Referer. Request bodies, cookies, credentials and token-bearing URLs are not logged.

## Dependencies

- SQLx supplies PostgreSQL pooling, runtime queries, transactions and embedded versioned migrations. Queries are checked by real PostgreSQL integration tests, without requiring database access at compilation.
- Argon2 provides password hashing and PHC verification; rand generates 256-bit tokens and salts.
- SHA-256/hex store token digests; AES-GCM encrypts secrets with authenticated nonces. UUIDs provide opaque internal database identifiers.
- Lettre sends email asynchronously through SMTP, supporting STARTTLS and optional credentials.
- URL parses and constructs environment-specific origins and database connection options.

Mailpit is pinned to 1.30.1 for local/test SMTP capture, including the request-size fixes described in [the upstream advisory](https://github.com/axllent/mailpit/security/advisories/GHSA-28pq-6qxg-wg5r). It is absent from the default production profile.

Frontend routing uses ordinary URLs and same-origin fetch without an added router or state-management dependency. Features expose only their export barrels. Host and origin validation uses the configured root domain, scheme and port; no business rule hard-codes the local domain.

## Consequences

Backups must include the registry, every tenant database, PostgreSQL roles and the encryption key. Losing the key makes stored database credentials and queued emails unreadable. Pool count is bounded to 16 tenants with four connections each; stale pools are evicted on access after five minutes. This is an initial per-process bound, not a distributed global pool budget.

Local Compose defaults are development credentials only. Public operation requires rotated secrets, authenticated TLS SMTP, wildcard DNS/certificates and replacement legal documents. No public hosting or deployment is configured.

References: [PostgreSQL CREATE DATABASE](https://www.postgresql.org/docs/current/sql-createdatabase.html), [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [Lettre](https://docs.rs/lettre/0.11.23/lettre/), [Argon2](https://docs.rs/argon2/0.5.3/argon2/).
