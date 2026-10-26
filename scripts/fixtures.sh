#!/bin/sh
set -eu
# Optional project override is used by disposable integration checks.
project=${FIXTURES_PROJECT:-ici-dev}
compose() { docker compose -p "$project" -f compose.dev.yaml "$@"; }
compose up --detach --wait postgres mailpit
compose run --build --rm --no-deps worker cargo run --locked -p ici-server --bin ici-worker -- --fixtures
