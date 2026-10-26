# Architecture

## Capabilities

The Rust workspace contains one `ici-server` crate, organized into `tenancy`, `identity`, `organization` and `planning` modules. Each capability keeps pure validation in `rules`, use cases beside adapters, and transport DTOs separate from business rules. Tenancy owns workspace normalization, exact host matching and the registration use case with an atomic reservation/outbox port. Identity owns account validation, terms version, session policy and the login use case with account and password-verification ports. PostgreSQL and Argon2 adapters implement these ports. Rules and use cases remain independent of Axum, Tokio and Serde by convention. The crate also owns cryptography, SMTP and composition, with separate HTTP and privileged worker executables. See [the consolidation decision](decisions/0003-single-backend-crate.md).

Organization owns location and team validation. Its server adapters persist tenant-scoped locations, teams and optional user assignments. Identity owns account roles, pending/active/inactive status, invitations and verified email changes. Organization mutations lock the tenant company row before authorization and validation; this serializes membership changes and preserves at least one active administrator under concurrent requests. Foreign keys prevent deleting referenced teams or locations, including references from inactive accounts.

The frontend `app` composes the landing page and public feature exports. `tenancy` owns registration, availability and status; `identity` owns login, verification, recovery and tenant home. `organization` owns authenticated workspace composition and location, company and user administration. `planning` owns Configuration, Planning, My Week, personal templates and location occupancy. App composition supplies the authenticated session through identity’s public interface. Collaborators read team presence and locations and edit their own presence; administrators also manage organization settings and other active users’ presence. `shared` contains transport parsing and form fields. ESLint enforces imports through other features' export-only index files. External JSON is parsed from unknown, and effects ignore obsolete responses. No router or state-management dependency is needed for the ordinary page URLs.

## Data and processes

The HTTP process connects to the central registry with a role limited to DML. It resolves validated tenant hosts only when their registry state is active. A bounded cache opens tenant pools using encrypted per-tenant credentials. PostgreSQL itself denies cross-tenant database connections; a missing application filter cannot merge users from separate databases.

The privileged `ici-worker` process initializes the registry, performs idempotent role/database provisioning, runs tenant migrations, inserts the first administrator/consent, marks the tenant active, and delivers encrypted outbox messages through SMTP. It has a separate runtime credential absent from HTTP. PostgreSQL advisory locking serializes cycles across workers. Retry state survives restarts.

The central schema owns workspace reservations, pending registrations, verification digests, provisioning states, encrypted connection credentials, encrypted outbox entries, short-lived login transfer digests and rate-limit windows. Each tenant database owns company, users, consents, sessions, password reset digests, locations, teams, invitations, pending email changes and an encrypted email outbox. New accounts have no usable password until invitation acceptance records consent. Invites expire after 48 hours and email-change confirmations after 24 hours. Both require explicit POST confirmation and are single-use. Current emails remain usable until confirmation; unexpired pending emails are reserved within the tenant. Resending or replacing a request invalidates its predecessor.

New identity emails are queued in the same tenant transaction as their associated state change. The worker drains both registry and tenant outboxes with durable SMTP retries. Delivery is at least once: a crash after SMTP acceptance can produce a duplicate email with the same single-use link. Existing password recovery continues to use the registry outbox. Deactivation removes sessions, reset/invitation/email-change tokens and increments credential_version; handoff checks that version and current active status. Email confirmation also revokes sessions and resets. Session permissions always read the current role and active status. SQL migrations are embedded at build time under `server/migrations/central` and `server/migrations/tenant`.

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
| GET/POST /api/locations | Read locations / create a location (admin) |
| PATCH/DELETE /api/locations/{id} | Update or delete an unreferenced location (admin) |
| GET/POST /api/teams | List or create teams (admin) |
| PATCH/DELETE /api/teams/{id} | Rename or delete an empty team (admin) |
| GET/POST /api/users | List users or create a pending invited account (admin) |
| PATCH /api/users/{id} | Update profile, role, status, optional team/location and request email change (admin) |
| POST /api/users/{id}/invitation | Rotate and resend a pending invitation (admin) |
| POST /api/auth/accept-invitation | Set password, record terms consent and activate a pending account |
| POST /api/auth/confirm-email | Confirm a pending email change and revoke previous credentials/session transfers |
| GET /health | Registry liveness; no host-specific authentication |

Mutation requests require an exact Origin matching the current host's configured origin; handoff additionally accepts the configured public origin. The Host must match the configured scheme's port and be either the root or exactly one valid workspace label below it. Unknown, inactive, nested and misleading suffix hosts are rejected, as are URI user information and malformed or noncanonical ports in Host. Registration routes are available only on the root origin. Cookie scope is always host-only. Public login never places a transfer code in the URL.

## Runtime

Vite explicitly permits `ici.localhost` and its subdomains for local HMR and forwards the original Host to the same-origin `/api` proxy. Nginx preserves Host including port, serves the SPA and proxies APIs and health. Production services run as unprivileged users. The optional HTTPS override uses mounted certificates and retains the original host/port. Docker DNS aliases resolve E2E public and tenant hosts to that isolated stack's web service rather than container loopback.

Local development/test SMTP uses Mailpit. Public SMTP is supplied by configuration; no hosting or deployment is automated. GitHub's `quality` aggregate remains the required branch-protection check.

## Organization payloads

Location writes contain `name`, `code`, optional `city` and `address`; names are 1–100 characters and codes are normalized to 2–3 uppercase ASCII letters. Optional details are limited to 500 characters. Team writes contain `name` (1–100 characters); team names are unique ignoring case. List responses use `locations`, `teams` or `users` arrays; location/team records include `id` and attached `members` counts.

User writes contain `first_name`, `last_name`, `email`, `role` (`admin` or `collaborator`), nullable `team_id` and `location_id`, and optional `status`. PATCH replaces those profile fields; omitted status is preserved. Creation always produces `pending`. Setting `active` on a never-activated inactive account produces `pending` and a fresh invitation. Activated accounts cannot return to `pending`. Active account email changes require confirmation; inactive activated accounts must be reactivated before an email change. Sending the current address cancels any pending change; sending the same pending address preserves its confirmation link. User lists include nullable `pending_email`; no password hashes or tokens are exposed. Session responses include the stable user `id`.

Mutations return an object with `id`, `updated`, `deleted` or `sent`. Conflicts return 409 (`already_exists`, `email_unavailable`, `resource_in_use`, `last_administrator`), missing tenant resources return 404 `not_found`, and insufficient roles return 403 `forbidden`. Every authenticated mutation requires `X-CSRF-Token` as well as exact Origin. Invitation acceptance requires `token`, `password`, `accepted_terms` and `terms_version`; email confirmation requires `token`. Tokens appear only in email URL fragments and POST bodies.

## Planning and occupancy

The internal `planning::rules` module validates civil dates, displayed weekdays and presence values. Its server adapters own tenant settings, dated half-day entries and personal weekly templates. All writes use the existing company-row lock and current session authorization. Collaborators edit themselves; administrators may edit any active user. Weekly reads use a repeatable-read snapshot and expose display names and organization assignments, without account emails or credentials. Pending and inactive accounts are omitted. The frontend `planning` feature owns all presence views and calculates occupancy from the same weekly response; organization composes it with existing location administration.

| Request | Purpose |
| --- | --- |
| GET/PUT /api/planning/settings | Read displayed weekdays / replace them (admin) |
| GET /api/planning/week?start=YYYY-MM-DD | Monday-based weekly snapshot for authenticated members |
| PUT /api/planning/entries | Atomically replace or clear up to 56 half-days for one active user, spanning at most 28 days |
| GET/PUT /api/planning/template | Read / replace the current user's weekly template |
| POST /api/planning/template/apply | Apply the current user's template from a Monday for `weeks: 1` or `4` |

Settings contain sorted, distinct `work_days` (Monday=0 through Sunday=6), with at least one day. Entry writes contain `user_id` and `entries`, each with `date`, `half` (`am`/`pm`), `status` (`office`/`remote`/`travel`/`off`/`none`), nullable `location_id` and optional `note` (500 characters maximum). Office requires a tenant location; other statuses require a null location. `none` deletes the slot. Repeated slots in a batch are rejected. Template replacement uses `entries` with `weekday`, `half`, `status` and `location_id`; omitted slots are unset. Templates have no notes. Applying a template replaces all displayed slots and clears their notes without confirmation, including deleting slots unset in the template. Hidden weekdays retain existing entries and template values. Dates are civil dates; the browser's local date selects the current Monday. Missing entries never inherit a template automatically. New tenants and migrated accounts receive no sample presence data.

Location references from entries or templates prevent deletion with `resource_in_use`. Historical entries remain stored when a user is deactivated, but disappear from planning and occupancy until reactivation. Last committed writes win; there is no realtime synchronization, capacity management or desk reservation.

## Explicit demonstration fixtures

The privileged worker supports `--fixtures`, reusing provisioning and its advisory lock. It replaces only ACME tenant data transactionally and invalidates central login transfers. Ordinary provisioning never inserts sample data. `make fixtures` targets development; `make reset-fixtures` deletes the development PostgreSQL volume before loading fixtures and restarting the application. See README for demo credentials and the fixture-only password exception.
