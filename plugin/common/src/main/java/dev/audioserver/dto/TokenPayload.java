package dev.audioserver.dto;

import java.util.UUID;

/**
 * Immutable DTO carrying the data written to Redis during OTT generation.
 *
 * @param token      the UUIDv4 one-time token string
 * @param playerUuid the Minecraft player's UUID
 * @param expiresAt  Unix epoch milliseconds when the token expires
 */
public record TokenPayload(String token, UUID playerUuid, long expiresAt) {

    /** Redis key prefix — must match the key consumed by the Rust backend. See {@code docs/events.md}. */
    public static final String KEY_PREFIX = "audio:auth:token:";

    /** @return the fully qualified Redis key for this token */
    public String redisKey() {
        return KEY_PREFIX + token;
    }

    /** @return {@code true} if the token has not yet expired */
    public boolean isValid() {
        return System.currentTimeMillis() < expiresAt;
    }
}
