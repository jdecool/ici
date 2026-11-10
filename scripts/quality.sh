#!/bin/sh
# Keep each language's shared volumes sequential, and overlap only disjoint lanes.
set -eu
tools() { docker compose -p ici-tools -f compose.tools.yaml "$@"; }
make check-infra
tools build rust node
tools up --detach --wait postgres mailpit
report_directory=${QUALITY_REPORT_DIRECTORY:-reports/quality}
mkdir -p "$report_directory"
printf 'Running Rust and frontend checks; follow %s/rust.log and %s/frontend.log.\n' "$report_directory" "$report_directory"
pids=''
run_prefix=ici-quality-$$
cleanup() {
    docker stop "$run_prefix-rust" "$run_prefix-frontend" >/dev/null 2>&1 || true
    for pid in $pids; do kill "$pid" 2>/dev/null || true; done
    for pid in $pids; do wait "$pid" 2>/dev/null || true; done
}
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
tools run --name "$run_prefix-rust" --rm --no-deps rust sh scripts/quality-language.sh rust mutation > "$report_directory/rust.log" 2>&1 &
rust_pid=$!
pids="$rust_pid"
tools run --name "$run_prefix-frontend" --rm --no-deps node sh ../scripts/quality-language.sh frontend mutation > "$report_directory/frontend.log" 2>&1 &
frontend_pid=$!
pids="$pids $frontend_pid"
result=0
wait "$rust_pid" || result=1
wait "$frontend_pid" || result=1
cat "$report_directory/rust.log" "$report_directory/frontend.log"
test "$result" -eq 0
make quality-production
