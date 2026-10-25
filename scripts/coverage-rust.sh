#!/bin/sh
set -eu
mkdir -p reports/coverage/rust
# main.rs contains process wiring and signals, exercised by container smoke tests.
ignore='backend/crates/server/src/main\.rs|/tests/'
cargo llvm-cov clean --workspace
cargo llvm-cov --workspace --all-targets --locked --no-report
cargo llvm-cov report --ignore-filename-regex "$ignore" --html --output-dir reports/coverage/rust
cargo llvm-cov report --ignore-filename-regex "$ignore" --lcov --output-path reports/coverage/rust/lcov.info
cargo llvm-cov report --ignore-filename-regex "$ignore" --fail-under-lines 90 --fail-under-functions 90
