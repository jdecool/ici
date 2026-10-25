#!/usr/bin/env bash
set -euo pipefail

# Keep capability cores independent from HTTP/runtime/serialization frameworks.
violations="$(
    cargo metadata --no-deps --format-version 1 --locked |
        jq -r '
            .packages[]
            | select(.name != "ici-server")
            | .name as $package
            | .dependencies[]
            | select(.kind != "dev")
            | select(.name as $dependency
                | ["axum", "tokio", "tower", "tower-http", "serde", "serde_json", "ici-server"]
                | index($dependency))
            | "\($package) core depends on infrastructure: \(.name)"
        '
)"

if [[ -n "$violations" ]]; then
    printf '%s\n' "$violations" >&2
    exit 1
fi

printf '%s\n' 'Backend architecture boundaries passed'
