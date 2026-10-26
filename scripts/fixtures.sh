#!/bin/sh
set -eu
# Optional project override is used by disposable integration checks.
project=${FIXTURES_PROJECT:-ici-dev}
compose() { docker compose -p "$project" -f compose.dev.yaml "$@"; }
if [ "${1:-}" = reset ]; then
    echo "Deleting ALL development data in $project before loading ACME fixtures."
    compose down --remove-orphans
    volume="${project}_postgres-data"
    existing_volume=$(docker volume ls --quiet --filter "name=^${volume}$")
    if [ -n "$existing_volume" ]; then
        docker volume rm "$volume"
    fi
fi
compose up --detach --wait postgres mailpit
compose run --build --rm --no-deps worker cargo run --locked -p ici-server --bin ici-worker -- --fixtures
if [ "${1:-}" = reset ]; then
    compose up --build --detach --wait backend worker web
fi
