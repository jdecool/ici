CREATE TABLE tenants (
    id uuid PRIMARY KEY,
    slug text UNIQUE NOT NULL,
    state text NOT NULL CHECK (state IN ('pending','queued','provisioning','active','failed')),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
    first_name text,
    last_name text,
    email text,
    password_hash text,
    terms_version text NOT NULL,
    consent_at timestamptz NOT NULL DEFAULT now(),
    verification_hash text UNIQUE,
    receipt_hash text UNIQUE NOT NULL,
    database_secret text,
    attempts integer NOT NULL DEFAULT 0,
    retry_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outbox (
    id uuid PRIMARY KEY,
    payload text NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    retry_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE handoffs (
    token_hash text PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    user_id uuid NOT NULL,
    remember boolean NOT NULL,
    credential_version integer NOT NULL,
    expires_at timestamptz NOT NULL DEFAULT now() + interval '60 seconds'
);
CREATE TABLE rate_limits (
    key text PRIMARY KEY,
    count integer NOT NULL DEFAULT 1,
    expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);
