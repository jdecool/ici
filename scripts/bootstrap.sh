#!/bin/sh
set -eu
# Explicit initial resolution only: existing lockfiles are preserved.
if [ ! -f Cargo.lock ]; then
    docker compose -p ici-tools -f compose.bootstrap.yaml run --build --rm rust cargo generate-lockfile
fi
if [ ! -f frontend/package-lock.json ]; then
    docker compose -p ici-tools -f compose.bootstrap.yaml run --build --rm node npm install --package-lock-only --ignore-scripts
fi
printf '%s\n' 'Dependency locks are present. Review them and include both in version control.'
