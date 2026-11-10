#!/bin/sh
set -eu
# Fail on stale locks before cargo-mutants performs its own metadata discovery.
cargo metadata --locked --format-version 1 > /dev/null
# cargo-mutants creates only the last path segment; a fresh checkout has no reports/.
mkdir -p reports
# CI spreads the sequential suite over runners; unset runs every mutant.
cargo mutants --workspace --output reports/mutations ${MUTATION_SHARD:+--shard "$MUTATION_SHARD"}
