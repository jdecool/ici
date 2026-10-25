#!/bin/sh
set -eu
# Isolated project does not stop the developer's running stack.
export COMPOSE_PROJECT_NAME=ici-e2e
export HTTP_PORT=0
cleanup() { docker compose -f compose.yaml --profile test down --remove-orphans; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker compose -f compose.yaml --profile test build
docker compose -f compose.yaml up -d --wait --wait-timeout 120 backend web
docker compose -f compose.yaml --profile test run --rm --no-deps e2e
