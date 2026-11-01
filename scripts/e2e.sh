#!/bin/sh
set -eu
. scripts/test-environment.sh
export PUBLIC_ORIGIN=http://ici.localhost:8080
# Isolated project does not stop the developer's running stack.
export COMPOSE_PROJECT_NAME=ici-e2e
export HTTP_PORT=0
cleanup() {
    result=$?
    if [ "$result" -ne 0 ]; then
        mkdir -p reports
        docker compose -f compose.yaml logs backend worker > reports/e2e-stack.log 2>&1
    fi
    docker compose -f compose.yaml --profile test down --remove-orphans --volumes
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ "${ICI_E2E_PREBUILT:-0}" != 1 ]; then
    docker compose -f compose.yaml --profile test build backend worker web
fi
docker compose -f compose.yaml --profile test build e2e
docker compose -f compose.yaml up --no-build -d --wait --wait-timeout 180 backend worker web mailpit
web_container="$(docker compose -f compose.yaml ps -q web)"
web_address="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$web_container")"
docker compose -f compose.yaml --profile test run --rm --no-deps -e E2E_WEB_IP="$web_address" e2e
