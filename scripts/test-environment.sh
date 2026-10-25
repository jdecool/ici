#!/bin/sh
# Deterministic disposable-stack settings, independent of a developer's .env.
export ROOT_DOMAIN=ici.localhost
export CENTRAL_DATABASE_URL=postgres://ici_registry:local-registry-only@postgres/ici
export PROVISIONER_DATABASE_URL=postgres://postgres:local-provisioner-only@postgres/ici
export TENANT_DATABASE_BASE_URL=postgres://postgres@postgres/ici
export POSTGRES_PASSWORD=local-provisioner-only
export REGISTRY_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
export SMTP_HOST=mailpit SMTP_PORT=1025 SMTP_TLS=false
export SMTP_FROM='Ici <noreply@ici.localhost>'
export SMTP_USERNAME= SMTP_PASSWORD=
export HTTP_PORT=0
