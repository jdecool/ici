# Architecture

## Backend

The Cargo workspace is a capability-oriented monolith. `greeting` is a domain/application crate without framework dependencies. Its `hello()` use case returns a message. `ici-server` owns HTTP DTOs, Axum routing, runtime setup and logging. Its greeting adapter calls the core and maps its result to JSON.

```text
HTTP client -> server/greeting adapter -> greeting use case
                        ^
                 server composition
```

Dependencies point inward; the core never imports the server. Cargo crate boundaries isolate the public API, and the architecture check rejects framework/transport dependencies in capability crates. As real I/O needs appear, define the outgoing port in the owning capability and implement it in an adapter, injecting it from the server. The current pure use case does not need a port trait or persistence adapter.

Add new capabilities under their business names. Avoid global controllers/services/repositories directories. Within a larger capability, domain/application/ports modules may clarify responsibility, but empty layers are not required.

## Frontend

`app` composes public feature components. The greeting feature owns its HTTP client, runtime response validation, rendering and tests. Feature index.ts files are export-only public interfaces. The ESLint architecture rule resolves relative paths and rejects internal cross-feature imports, feature-to-app dependencies and upward shared dependencies. Path aliases are intentionally absent.

The HTTP client returns a typed message or rejects. The UI exposes loading, success and error states. Effects ignore stale resolutions after cleanup, including StrictMode's setup/cleanup cycle.

## Public HTTP contract

| Request | Status | JSON |
| --- | --- | --- |
| GET /api/hello | 200 | `{"message":"Hello World"}` |
| GET /health | 200 | `{"status":"ok"}` |

Responses use application/json. Unknown backend routes return 404; unsupported greeting methods return 405. There are no credentials, database migrations or external services. Frontend validation requires a JSON object with a string message; additional fields are tolerated.

## Runtime

Vite proxies API requests in development; Nginx serves compiled assets and proxies API/health in production. The Rust server emits structured logs and shuts down on SIGINT/SIGTERM. Production services run as non-root users. Environment configuration is limited to bind address, log filter and host ports.
