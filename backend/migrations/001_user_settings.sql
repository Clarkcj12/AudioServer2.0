-- User-level audio preferences stored per Minecraft player UUID.
-- The relay reads these to apply per-player overrides to audio_play events.

CREATE TABLE IF NOT EXISTS user_settings (
    player_uuid     TEXT             NOT NULL PRIMARY KEY,
    -- Client-side volume multiplier: 0.0 (mute) to 1.0 (full).
    -- Applied on top of the region's audio-volume flag value.
    volume_override DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    -- Master mute toggle for the player.
    audio_enabled   BOOLEAN          NOT NULL DEFAULT TRUE,
    updated_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);
