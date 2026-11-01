#!/bin/sh
# Exercise gate orchestration and failure propagation without running the suites.
set -eu
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir "$scratch/bin"
cat > "$scratch/bin/command" <<'MOCK'
#!/bin/sh
set -eu
name=${0##*/}
printf '%s %s\n' "$name" "$*" >> "$QUALITY_TEST_LOG"
case "$name $*" in
    *"run --name ici-quality-"*)
        if [ "${QUALITY_TEST_BLOCK:-0}" = 1 ]; then
            echo "$$" >> "$QUALITY_TEST_PIDS"
            exec sleep 30
        fi
        ;;
    "docker stop "*)
        if [ -f "$QUALITY_TEST_PIDS" ]; then
            while read -r pid; do kill "$pid" 2>/dev/null || true; done < "$QUALITY_TEST_PIDS"
        fi
        ;;
esac
case "$name $*" in
    "npm run mutation") exit "${QUALITY_TEST_FAIL:-0}" ;;
    *"run --name ici-quality-"*"-rust"*) exit "${QUALITY_TEST_FAIL:-0}" ;;
esac
MOCK
chmod +x "$scratch/bin/command"
for command in docker make cargo npm sh; do
    ln -s command "$scratch/bin/$command"
done
export PATH="$scratch/bin:$PATH" QUALITY_TEST_LOG="$scratch/calls" QUALITY_REPORT_DIRECTORY="$scratch/reports" QUALITY_TEST_PIDS="$scratch/pids"
/bin/sh scripts/quality-language.sh frontend
cat > "$scratch/expected" <<'EXPECTED'
npm run check
npm run coverage
npm run mutation
npm run audit:dependencies
EXPECTED
diff -u "$scratch/expected" "$QUALITY_TEST_LOG"
: > "$QUALITY_TEST_LOG"
/bin/sh scripts/quality-language.sh rust
cat > "$scratch/expected" <<'EXPECTED'
sh scripts/check-rust.sh
sh scripts/coverage-rust.sh
cargo test --workspace --doc --locked
sh scripts/mutation-rust.sh
cargo deny --locked check
EXPECTED
diff -u "$scratch/expected" "$QUALITY_TEST_LOG"
: > "$QUALITY_TEST_LOG"
if QUALITY_TEST_FAIL=42 /bin/sh scripts/quality-language.sh frontend; then
    echo 'A failed mutation gate must fail the lane' >&2; exit 1
else
    test "$?" -eq 42
fi
test "$(wc -l < "$QUALITY_TEST_LOG" | tr -d ' ')" -eq 3
: > "$QUALITY_TEST_LOG"
/bin/sh scripts/quality.sh
test "$(grep -c 'run --name ici-quality-' "$QUALITY_TEST_LOG")" -eq 2
test "$(grep -c '^make quality-production$' "$QUALITY_TEST_LOG")" -eq 1
: > "$QUALITY_TEST_LOG"
if QUALITY_TEST_FAIL=42 /bin/sh scripts/quality.sh; then
    echo 'A failed lane must fail quality' >&2; exit 1
fi
if grep '^make quality-production$' "$QUALITY_TEST_LOG"; then
    echo 'Production must not run after a failed lane' >&2; exit 1
fi
: > "$QUALITY_TEST_LOG"
QUALITY_TEST_BLOCK=1 /bin/sh scripts/quality.sh > "$scratch/interruption.log" 2>&1 &
quality_pid=$!
attempt=0
until [ -f "$QUALITY_TEST_PIDS" ] && [ "$(wc -l < "$QUALITY_TEST_PIDS" | tr -d ' ')" -eq 2 ]; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 100 ]; then
        kill "$quality_pid" 2>/dev/null || true
        echo 'Quality lanes failed to start' >&2; exit 1
    fi
    sleep 0.1
done
kill -TERM "$quality_pid"
if wait "$quality_pid"; then
    echo 'Interrupted quality must fail' >&2; exit 1
else
    test "$?" -eq 143
fi
grep '^docker stop ici-quality-' "$QUALITY_TEST_LOG" > /dev/null
if grep '^make quality-production$' "$QUALITY_TEST_LOG"; then
    echo 'Production must not run after interruption' >&2; exit 1
fi
echo 'Quality orchestration passed'
