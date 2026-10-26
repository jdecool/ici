# Identity operations

## Development

Run `make dev`, open http://ici.localhost:5173 and create an account. Inspect verification and reset emails at http://localhost:8025 (Mailpit). Confirm activation explicitly, wait for the durable worker and sign in at `http://<workspace>.ici.localhost:5173`. Modern browsers resolve localhost subdomains locally; configure hosts/DNS if your environment does not. Never map container-local loopback to the web container: E2E uses Compose DNS aliases for HTTP clients and an explicit Chromium resolver rule pointing localhost subdomains to the isolated web container IP.

`make up` builds production images and starts the local stack on http://ici.localhost:8080. To capture local production-stack emails, start Mailpit with `docker compose -p ici -f compose.yaml --profile test up -d mailpit`. Mailpit is for local development and tests only. On a public installation configure an external SMTP service instead.

## Configuration

`ROOT_DOMAIN` is the root hostname without scheme or port. `PUBLIC_ORIGIN` includes scheme and any nonstandard port. All tenant links preserve that scheme and port. Change the origin together with the exposed port when overriding DEV_PORT or HTTP_PORT.

`CENTRAL_DATABASE_URL` authenticates as `ici_registry` to the central `ici` database. The worker initializes this limited role. `PROVISIONER_DATABASE_URL` is provided only to the worker and permits role/database creation. `TENANT_DATABASE_BASE_URL` supplies the database host, port and connection/TLS settings used for tenant URLs; its username, password and database are replaced by generated values.

`REGISTRY_KEY` must be 32 random bytes encoded as 64 hexadecimal characters. Supply a unique key for each real environment, for example generated with `openssl rand -hex 32`. `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_FROM`, `SMTP_USERNAME` and `SMTP_PASSWORD` configure delivery. SMTP_TLS defaults to enabled in the application; local Compose explicitly disables it for Mailpit.

TRUST_PROXY=true is enabled only for the private HTTP service behind Vite/Nginx, which overwrites X-Real-IP. It enables per-client IP rate limits. Keep the backend private and leave TRUST_PROXY disabled when exposing it directly.

The Rust configuration loader supports `NAME_FILE` instead of `NAME` for every value it reads. For secrets, mount read-only files into backend/worker and set the corresponding *_FILE environment variables using a Compose override. Keep secrets and .env files out of version control. Compose's checked-in defaults are deliberately limited to a loopback-bound local installation; replace them before any public use. Do not expose the PostgreSQL port.

## HTTPS and DNS

Use `compose.https.yaml` with the production Compose file, mount fullchain.pem and privkey.pem under `./secrets/tls/`, set `PUBLIC_ORIGIN=https://your-domain`, and configure ROOT_DOMAIN. Create DNS records for both the root domain and `*.your-domain`; obtain a certificate covering both names (wildcard certificates require DNS validation). The TLS override listens on 8443 in the container, exposed on HTTPS_BIND_ADDRESS (default 127.0.0.1) as HTTPS_PORT (default 443), and redirects HTTP to the configured PUBLIC_ORIGIN. TLS_CERT_DIRECTORY overrides the certificate directory. `make e2e-https` verifies certificate loading and hostnames with a temporary local CA certificate, plus HTTPS routing and HTTP redirects, in a disposable stack. Supply certificate renewals externally and reload Nginx after replacement. The backend validates the public host and port forwarded by Nginx, never an arbitrary forwarded host.

## Migrations and recovery

The worker applies central migrations before HTTP startup. It provisions roles, databases, tenant migrations and the administrator, publishing an active tenant only after completion. Monitor structured worker events by tenant UUID and states/attempt counts in the registry; logs omit credentials and payloads. Retry intervals increase up to one hour. Use `make migrate-tenants` after shipping a tenant migration; it waits for any competing worker cycle, visits all active tenants and retries incomplete provisioning. Stop if the command reports failure; fix the migration or infrastructure issue before retrying. Never edit an applied SQL migration: add a new version.

Health endpoints check registry connectivity; the worker health check reports successful initialization. PostgreSQL's own health check gates initialization. A failed worker cycle is logged and retried; monitor those logs rather than relying only on container liveness.

## Backups and restoration

Schedule encrypted `pg_dump -Fc` backups of `ici` and every active tenant database, plus `pg_dumpall --roles-only` from the privileged connection. Record a consistent inventory of tenant IDs, database names and registry state. For a consistent instance-wide recovery point, use PostgreSQL physical backup plus WAL archiving, or pause writes/provisioning while taking coordinated logical dumps.

Back up REGISTRY_KEY in a separately protected secret store with version history. Include SMTP credentials and deployment configuration in the operational recovery inventory. Database dumps alone cannot recover encrypted tenant connection credentials or the outbox. Never write decrypted connection URLs or email tokens to backup logs.

Restore into an isolated PostgreSQL instance: restore roles first, then central and tenant databases with ownership/privileges intact, mount the matching encryption key, and configure database host settings. Validate that tenant roles cannot connect to other databases before reopening traffic. Stored encrypted URLs retain their original database host; retain that internal DNS name during recovery or re-encrypt URLs with the correct host in an offline privileged operation. Start the worker to resume incomplete provisioning and queued email delivery, then the HTTP server. Check tenant login, reset and consent records. Practice restoration periodically and verify both registry and tenant row counts.

## Organization access and invitations

After signing in, administrators manage locations, teams and users in the three workspace tabs. Collaborators can consult locations. Create an invited user with optional team and usual location; the worker sends an activation link captured in Mailpit locally. The recipient chooses a password and accepts the current terms. Invitations expire in 48 hours; resending rotates the token. Pending accounts cannot sign in or recover a password.

Administrators can deactivate and reactivate accounts. Deactivation immediately revokes access and outstanding identity tokens; it preserves assignments and the accepted password. Reactivating an account that never accepted its invitation sends a fresh invitation. The last active administrator cannot be demoted or deactivated. Teams and locations remain undeletable while any account is attached.

Email changes for activated accounts require confirmation at the new address within 24 hours, with notification to the previous address. The previous email remains valid until confirmation, which revokes sessions and outstanding password reset/login transfer credentials. Pending addresses are reserved until expiry or replacement. Restore the current address in the edit form to cancel a pending change. Reactivate an inactive account before changing its email.

Ship the new tenant migration and run `make migrate-tenants` before reopening the upgraded HTTP application. Existing administrators remain active with no team/location; no sample data is inserted. The worker now reads each active tenant’s encrypted outbox as well as the registry outbox. Inspect tenant `outbox` attempts/retry_at and structured SMTP failure events when mail is delayed. A restart resumes pending delivery; SMTP acceptance followed by a crash before deletion can deliver the same message twice, while activation remains single-use. Tokens and decrypted payloads must never be logged.

Custom domains, scheduling and SSO are outside this delivery. Legal pages are explicitly provisional.

## Planning migration

Ship tenant migration `0003_planning.sql` and run `make migrate-tenants` before reopening the upgraded HTTP application. It creates default Monday–Friday display settings, half-day presence records and personal templates. Existing accounts, locations and teams are preserved; no presence data is generated. Hiding a weekday does not delete data. Locations referenced by historical presence or templates cannot be deleted. Occupancy counts only active users with an explicit office entry for the selected location and half-day.

## Development reset

`make fixtures` replaces ACME only. `make reset-fixtures` stops `ici-dev`, deletes its PostgreSQL volume (all companies and tenant databases), recreates ACME and starts the development application in the background. It preserves dependency/build caches and other environments. Both commands stop on failure and can be rerun. These commands use `compose.dev.yaml`; never point development database settings at a real installation. No fixture emails are sent.
