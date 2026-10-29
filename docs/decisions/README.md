# Architecture decision records

Decisions explaining the architecture and its tradeoffs. See the [documentation index](../README.md) for implementation and operating guides.

- [0001 — Capability-oriented, containerized foundation](0001-foundation.md) — accepted; its separate backend capability crates are superseded by decision 0003.
- [0002 — Tenant identity and database isolation](0002-tenant-identity.md) — accepted; registration, tenant databases, sessions, provisioning and email delivery.
- [0003 — Consolidate backend capabilities into one crate](0003-single-backend-crate.md) — accepted; capability modules within one server crate, with separate HTTP and worker executables.
