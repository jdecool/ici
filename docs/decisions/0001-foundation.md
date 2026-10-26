# 0001 — Capability-oriented, containerized foundation

Status: accepted; the separate backend capability crates are superseded by [0003](0003-single-backend-crate.md).

Use Rust 2024 with Axum/Tokio, and React with strict TypeScript/Vite. Use a Cargo workspace and a single npm frontend package. Keep a separate crate for each backend capability core; group HTTP adapters by capability inside the server. Use frontend feature slices with public entry points.

This makes business capabilities visible in the tree and keeps frameworks outside the core. The cost is a small amount of crate/adapter boilerplate. The initial greeting has no outgoing dependencies, so an artificial repository, database or port trait would add no useful boundary.

Docker Compose is the reference development, test and runtime environment. GitHub Actions invokes the same Make targets. All quality gates, including complete mutation runs, are required on every PR despite their additional runtime. Coverage is 90% in each language; mutation score is 100%.

No SSR, cloud deployment, authentication, persistence, global state manager or frontend router is included. Documentation, code and agent instructions are English.
