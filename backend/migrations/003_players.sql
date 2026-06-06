-- Player portal accounts. Created on first portal login via OTT.
-- Distinct from admin_users — these are regular Minecraft players.

CREATE TABLE IF NOT EXISTS players (
    uuid        TEXT        NOT NULL PRIMARY KEY,  -- Minecraft player UUID (string form)
    username    TEXT        NOT NULL,
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NOTE: default_client preference ("lite" | "portal") is stored in Redis only:
--   Key: audio:player:pref:<uuid>   Value: "portal" | "lite"  (no TTL)
-- The plugin reads Redis directly; Redis-only avoids a split-brain with the DB.
-- See api/player.rs and RedisManager.java for write paths.
