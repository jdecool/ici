CREATE TABLE locations (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    code text NOT NULL CHECK (code ~ '^[A-Z]{2,3}$'),
    city text NOT NULL DEFAULT '',
    address text NOT NULL DEFAULT ''
);
CREATE TABLE teams (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX teams_name_unique ON teams (lower(name));
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','collaborator'));
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','inactive'));
ALTER TABLE users ADD COLUMN team_id uuid REFERENCES teams(id) ON DELETE RESTRICT;
ALTER TABLE users ADD COLUMN location_id uuid REFERENCES locations(id) ON DELETE RESTRICT;
CREATE TABLE invitations (
    user_id uuid PRIMARY KEY REFERENCES users(id),
    token_hash text UNIQUE NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE TABLE email_changes (
    user_id uuid PRIMARY KEY REFERENCES users(id),
    email text UNIQUE NOT NULL,
    token_hash text UNIQUE NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE TABLE outbox (
    id uuid PRIMARY KEY,
    payload text NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    retry_at timestamptz NOT NULL DEFAULT now()
);
