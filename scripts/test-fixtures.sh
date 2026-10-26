#!/bin/sh
# Verify reset orchestration without touching a running Docker environment.
set -eu
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cat > "$scratch/docker" <<'MOCK'
#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FIXTURES_TEST_LOG"
if [ "$1 $2" = 'volume ls' ]; then
    echo ici-fixtures-test_postgres-data
fi
if [ "${FIXTURES_TEST_FAIL:-}" = 1 ] && [ "$1 $2" = 'volume rm' ]; then
    exit 42
fi
MOCK
chmod +x "$scratch/docker"
export PATH="$scratch:$PATH" FIXTURES_PROJECT=ici-fixtures-test FIXTURES_TEST_LOG="$scratch/calls"
sh scripts/fixtures.sh reset
cat > "$scratch/expected" <<'EXPECTED'
compose -p ici-fixtures-test -f compose.dev.yaml down --remove-orphans
volume ls --quiet --filter name=^ici-fixtures-test_postgres-data$
volume rm ici-fixtures-test_postgres-data
compose -p ici-fixtures-test -f compose.dev.yaml up --detach --wait postgres mailpit
compose -p ici-fixtures-test -f compose.dev.yaml run --build --rm --no-deps worker cargo run --locked -p ici-server --bin ici-worker -- --fixtures
compose -p ici-fixtures-test -f compose.dev.yaml up --build --detach --wait backend worker web
EXPECTED
diff -u "$scratch/expected" "$FIXTURES_TEST_LOG"
: > "$FIXTURES_TEST_LOG"
if FIXTURES_TEST_FAIL=1 sh scripts/fixtures.sh reset; then
    echo 'Reset must fail when deleting the database volume fails' >&2
    exit 1
else
    result=$?
    test "$result" -eq 42
fi
test "$(wc -l < "$FIXTURES_TEST_LOG" | tr -d ' ')" -eq 3
: > "$FIXTURES_TEST_LOG"
sh scripts/fixtures.sh
test "$(wc -l < "$FIXTURES_TEST_LOG" | tr -d ' ')" -eq 2
if grep -E 'volume|down' "$FIXTURES_TEST_LOG"; then
    echo 'Ordinary fixture loading must preserve database volumes' >&2
    exit 1
fi
echo 'Fixture command orchestration passed'
