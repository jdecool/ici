#!/bin/sh
set -eu
. scripts/test-environment.sh
export COMPOSE_PROJECT_NAME=ici-e2e-https
export PUBLIC_ORIGIN=https://ici.localhost:8443
export HTTPS_PORT=0
TLS_CERT_DIRECTORY="$(mktemp -d)"
export TLS_CERT_DIRECTORY
chmod 755 "$TLS_CERT_DIRECTORY"
stack() { docker compose -f compose.yaml -f compose.https.yaml --profile test "$@"; }
cleanup() {
    result=$?
    if [ "$result" -ne 0 ]; then
        mkdir -p reports
        stack logs backend worker web > reports/e2e-https.log 2>&1
    fi
    stack down --remove-orphans --volumes
    rm -rf -- "$TLS_CERT_DIRECTORY"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
stack build backend worker web
stack run --rm --no-deps --user 0:0 --entrypoint sh -v "$TLS_CERT_DIRECTORY:/tls" backend -c 'openssl req -x509 -nodes -newkey rsa:2048 -keyout /tls/privkey.pem -out /tls/fullchain.pem -days 1 -subj /CN=ici.localhost -addext "subjectAltName=DNS:ici.localhost,DNS:*.ici.localhost" && chmod 644 /tls/privkey.pem'
stack up -d --wait --wait-timeout 180 backend worker web mailpit
config="$(stack exec -T backend curl --fail --silent --cacert /dev/stdin --connect-to ici.localhost:8443:web:8443 https://ici.localhost:8443/api/config < "$TLS_CERT_DIRECTORY/fullchain.pem")"
case "$config" in
    *'"public_origin":"https://ici.localhost:8443"'*) ;;
    *) echo 'HTTPS public configuration did not preserve its origin' >&2; exit 1 ;;
esac
redirect="$(stack exec -T backend curl --silent --output /dev/null --write-out '%{http_code} %{redirect_url}' -H 'Host: ici.localhost:8080' http://web:8080/login)"
test "$redirect" = '308 https://ici.localhost:8443/login'
status="$(stack exec -T backend curl --silent --output /dev/null --write-out '%{http_code}' --cacert /dev/stdin --connect-to acme.ici.localhost:8443:web:8443 https://acme.ici.localhost:8443/api/config < "$TLS_CERT_DIRECTORY/fullchain.pem")"
test "$status" = 404
printf '%s\n' 'Mounted root/wildcard certificates, HTTPS API and HTTP redirect passed'
