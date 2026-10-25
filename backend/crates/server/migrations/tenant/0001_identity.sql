CREATE TABLE company (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE users (
    id uuid PRIMARY KEY,
    email text UNIQUE NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    password_hash text NOT NULL,
    credential_version integer NOT NULL DEFAULT 0,
    role text NOT NULL CHECK (role IN ('admin'))
);
CREATE TABLE consents (
    user_id uuid NOT NULL REFERENCES users(id),
    version text NOT NULL,
    accepted_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, version)
);
CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    csrf_hash text NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE TABLE resets (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes'
);
