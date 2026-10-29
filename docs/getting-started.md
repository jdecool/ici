# Getting started

Requirements, starting the local stack and trying the application with demonstration data. For day-to-day commands and the repository map, see [Development](development.md).

## Requirements and startup

Install Docker with Compose v2 and Make. Copy `.env.example` to `.env` only to override the host ports or logging. Rust and Node are provided by the containers.

```sh
# First checkout only, if Cargo.lock or frontend/package-lock.json is absent:
make bootstrap
# Review and include the generated locks in the first commit.
make dev
```

Open http://ici.localhost:5173. Rust reloads when backend files change; React uses Vite HMR. Initial image builds compile the Rust quality tools and can take several minutes. Subsequent builds reuse Docker layers and named dependency/build caches.

```sh
make up      # Production images at http://ici.localhost:8080
make down    # Stop services, preserving caches
```

Development email is captured by Mailpit at http://localhost:8025. Tenant workspaces use `http://<workspace>.ici.localhost:5173` (port 8080 for the local production images). PostgreSQL persists across `make down`; E2E uses its own disposable database volume. See [operations](operations.md) for configuration, production SMTP, TLS, migrations and backup/restore.

Development and production use a same-origin proxy for `/api`, avoiding browser CORS configuration. Production also proxies `/health`. The backend is reachable on port 3000 only within the Compose network.

## Registration and activation

Create a workspace from the public landing page. Open the verification email in [Mailpit](http://localhost:8025), confirm activation explicitly and wait for the worker to finish provisioning. Sign in at `http://<workspace>.ici.localhost:5173`.

## Password policy

New passwords require 8–128 characters including a lowercase letter, an uppercase letter, an ASCII digit and a symbol or punctuation character. Existing passwords remain usable for login.

## Development fixtures

```sh
make fixtures        # Create or reset ACME only; preserve other workspaces
make reset-fixtures  # Delete ALL development data, reload ACME and start the app
```

`make reset-fixtures` stops the `ici-dev` stack and deletes its PostgreSQL volume, including every workspace and tenant database. It preserves build/dependency caches, local files and other Compose projects. There is no interactive confirmation. Failures stop the command; rerun after resolving the error.

After loading fixtures, open http://acme.ici.localhost:5173 with the development stack running:

| Role | Email | Password |
| --- | --- | --- |
| Administrator | admin@example.com | password |
| Collaborator | user@example.com | password |

ACME contains ten active accounts, three locations (Paris - Siège, Lyon - Confluence, Lyon - Part Dieu), and random weekday half-day presence across five weeks centered on the current Europe/Paris week. All demo accounts use `password`; this is an explicit fixture-only exception. Reloading fixtures replaces ACME data and invalidates its sessions; it sends no emails.

