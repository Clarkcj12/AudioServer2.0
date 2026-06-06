-- Portal admin accounts with Argon2id password hashes.
-- These are distinct from Minecraft player accounts (user_settings table).
-- Primary login is the in-game OTT flow; this table is the secondary tier.

CREATE TABLE IF NOT EXISTS admin_users (
    id            UUID             NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    username      TEXT             NOT NULL UNIQUE,
    -- Argon2id PHC string, e.g. $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
    password_hash TEXT             NOT NULL,
    role          TEXT             NOT NULL DEFAULT 'admin',
    created_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);
