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
case "${1:-}" in
    rust)
        measure check-rust sh scripts/check-rust.sh
        measure coverage-rust sh scripts/coverage-rust.sh
        measure doctests cargo test --workspace --doc --locked
        measure mutation-rust sh scripts/mutation-rust.sh
        measure audit-rust cargo deny --locked check
        ;;
    frontend)
        measure check-frontend npm run check
        measure coverage-frontend npm run coverage
        measure mutation-frontend npm run mutation
        measure audit-frontend npm run audit:dependencies
        ;;
    *) echo 'Usage: quality-language.sh rust|frontend' >&2; exit 2 ;;
esac
