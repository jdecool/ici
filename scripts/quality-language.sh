#!/bin/sh
# One container and dependency installation per language, with observable timings.
set -eu
measure() {
    label=$1
    shift
    started=$(date +%s)
    result=0
    "$@" || result=$?
    printf '[quality] %s: %ss (exit %s)\n' "$label" "$(($(date +%s) - started))" "$result"
    return "$result"
}
usage() { echo 'Usage: quality-language.sh rust|frontend [mutation]' >&2; exit 2; }
# CI runs mutations as separate sharded jobs; local lanes append them here.
mutation=${2:-}
case "$mutation" in ''|mutation) ;; *) usage ;; esac
case "${1:-}" in
    rust)
        measure check-rust sh scripts/check-rust.sh
        measure coverage-rust sh scripts/coverage-rust.sh
        measure doctests cargo test --workspace --doc --locked
        measure audit-rust cargo deny --locked check
        if [ "$mutation" = mutation ]; then measure mutation-rust sh scripts/mutation-rust.sh; fi
        ;;
    frontend)
        measure check-frontend npm run check
        measure coverage-frontend npm run coverage
        measure audit-frontend npm run audit:dependencies
        if [ "$mutation" = mutation ]; then measure mutation-frontend npm run mutation; fi
        ;;
    *) usage ;;
esac
