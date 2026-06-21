-- Business Dialer cloud archive schema.
-- The permanent, append-only record of every call, plus a log of Web3 backups.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each person/account is identified by their own secret key. All call data is isolated
-- per user_id, so accounts never see each other's history.
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS label TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_api_key_idx ON users (api_key);

CREATE TABLE IF NOT EXISTS calls (
    id                BIGSERIAL PRIMARY KEY,
    user_id           UUID NOT NULL REFERENCES users(id),
    device_id         TEXT,
    client_uuid       TEXT,
    number            TEXT NOT NULL,
    normalized_number TEXT NOT NULL,
    contact_name      TEXT,
    company           TEXT,
    direction         TEXT NOT NULL,           -- INCOMING | OUTGOING | MISSED | REJECTED
    start_time        TIMESTAMPTZ NOT NULL,
    duration_sec      INTEGER NOT NULL DEFAULT 0,
    sim_slot          INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup: the same physical call must never be stored twice, even if synced repeatedly.
CREATE UNIQUE INDEX IF NOT EXISTS calls_dedup
    ON calls (user_id, normalized_number, start_time, direction, duration_sec);

CREATE INDEX IF NOT EXISTS calls_norm_idx  ON calls (user_id, normalized_number);
CREATE INDEX IF NOT EXISTS calls_start_idx ON calls (user_id, start_time DESC);

-- Per-number metadata: company/department/designation overrides + a tag (Customer,
-- Supplier, Vendor, …) + free-text notes. One row per (user, number).
CREATE TABLE IF NOT EXISTS contacts (
    user_id           UUID NOT NULL REFERENCES users(id),
    normalized_number TEXT NOT NULL,
    display_name      TEXT,
    company           TEXT,
    department        TEXT,
    designation       TEXT,
    tag               TEXT,
    notes             TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, normalized_number)
);

CREATE INDEX IF NOT EXISTS contacts_company_idx ON contacts (user_id, company);

-- Per-account speed dial (slots 1-9), so it follows the user across phones.
CREATE TABLE IF NOT EXISTS speed_dials (
    user_id     UUID NOT NULL REFERENCES users(id),
    slot        INTEGER NOT NULL,
    number      TEXT NOT NULL,
    name        TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, slot)
);

CREATE TABLE IF NOT EXISTS web3_backups (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id),
    provider    TEXT NOT NULL,                 -- ipfs-pinata | local
    cid         TEXT NOT NULL,
    gateway_url TEXT,
    call_count  INTEGER,
    byte_size   INTEGER,
    sha256      TEXT,
    encrypted   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
