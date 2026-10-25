#!/bin/sh
set -eu
# Fail on stale locks before cargo-mutants performs its own metadata discovery.
cargo metadata --locked --format-version 1 > /dev/null
cargo mutants --workspace --output reports/mutations
