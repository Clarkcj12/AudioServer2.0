package dev.audioserver.redis;

import dev.audioserver.dto.TokenPayload;
import dev.audioserver.event.AudioEvent;
import dev.audioserver.event.AudioPlayEvent;
import dev.audioserver.event.AudioStopEvent;
import dev.audioserver.event.RegionEnterEvent;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.JedisPoolConfig;

import java.time.Duration;
import java.util.logging.Logger;

/**
 * Platform-agnostic Redis manager used by both the Paper and Velocity modules.
 *
 * <p>Uses its own JUL logger so neither module needs to bridge logging frameworks.
 * All blocking Jedis calls must be dispatched from a Virtual Thread by the caller.
 */
public final class RedisManager {

    private static final Logger LOG = Logger.getLogger(RedisManager.class.getName());

    /** Redis Pub/Sub channel for in-game audio events. */
    public static final String EVENTS_CHANNEL = "audio:events";

    /** Redis LIST storing recent events for admin WS replay. Capped at 200 entries. */
    public static final String RECENT_EVENTS_KEY = "audio:recent-events";

    private static final long RECENT_EVENTS_CAP = 199L;

    /**
     * Redis hash that maps player UUID → session JSON.
     *
     * <p>Written by Velocity {@code PlayerEventListener} on login / server-switch;
     * deleted on disconnect. Read by the Rust relay's {@code GET /api/stats} and
     * {@code GET /api/sessions} endpoints. See {@code docs/events.md}.
     */
    public static final String SESSIONS_KEY = "audio:sessions";

    /** OTT key TTL — must match the Rust backend's expectation. */
    private static final int OTT_TTL_SECONDS = 60;

    /** Portal OTT key TTL — longer because players may need time to click the link. */
    private static final int PORTAL_OTT_TTL_SECONDS = 300;

    /** Redis key prefix for player default-client preference (no TTL — persistent). */
    private static final String PLAYER_PREF_PREFIX = "audio:player:pref:";

    private final JedisPool pool;

    /**
     * Create a new manager backed by a Jedis connection pool.
     *
     * @param host     Redis host
     * @param port     Redis port
     * @param password Redis password, or {@code null} / blank for no auth
     */
    public RedisManager(String host, int port, String password) {
        JedisPoolConfig cfg = buildPoolConfig();
        this.pool = (password != null && !password.isBlank())
                ? new JedisPool(cfg, host, port, 2_000, password)
                : new JedisPool(cfg, host, port);
        LOG.info("Redis pool connected to " + host + ":" + port);
    }

    /**
     * Write a one-time authentication token to Redis.
     *
     * <p>Key: {@code audio:auth:token:<token>}, value: player UUID string, TTL: 60 s.
     * The Rust backend consumes this via {@code GETDEL}.
     *
     * @param payload the token payload from the {@code /audio} command
     */
    public void writeOttToken(TokenPayload payload) {
        try (Jedis jedis = pool.getResource()) {
            jedis.setex(payload.redisKey(), OTT_TTL_SECONDS, payload.playerUuid().toString());
        }
    }

    /**
     * Write an admin portal login OTT to Redis.
     *
     * <p>Key: {@code admin:login:<token>}, value: player UUID string, TTL: 5 min.
     * The relay consumes this via {@code GETDEL} in {@code auth::admin_login_ott::validate}.
     *
     * @param token      random UUID string for the token
     * @param playerUuid the admin player's Minecraft UUID
     */
    public void writeAdminOttToken(String token, UUID playerUuid) {
        String key = "admin:login:" + token;
        try (Jedis jedis = pool.getResource()) {
            jedis.setex(key, PORTAL_OTT_TTL_SECONDS, playerUuid.toString());
        }
    }

    /**
     * Write a portal one-time token to Redis.
     *
     * <p>Key: {@code audio:portal:token:<token>}, value: {@code "<uuid>:<username>"}, TTL: 5 min.
     * The relay consumes this via {@code GETDEL} in {@code auth::player_ott::validate}.
     *
     * @param token      random UUID string for the token
     * @param playerUuid the player's Minecraft UUID
     * @param username   the player's Minecraft username
     */
    public void writePortalOttToken(String token, UUID playerUuid, String username) {
        String key   = "audio:portal:token:" + token;
        String value = playerUuid.toString() + ":" + username;
        try (Jedis jedis = pool.getResource()) {
            jedis.setex(key, PORTAL_OTT_TTL_SECONDS, value);
        }
    }

    /**
     * Get the player's saved default client preference from Redis.
     *
     * @param playerUuid the player's Minecraft UUID
     * @return {@code "portal"}, {@code "lite"}, or {@code null} if not set (treat as "lite")
     */
    public String getPlayerDefault(UUID playerUuid) {
        try (Jedis jedis = pool.getResource()) {
            return jedis.get(PLAYER_PREF_PREFIX + playerUuid);
        }
    }

    /**
     * Persistently store the player's default client preference in Redis.
     *
     * @param playerUuid the player's Minecraft UUID
     * @param value      {@code "portal"} or {@code "lite"}
     */
    public void setPlayerDefault(UUID playerUuid, String value) {
        try (Jedis jedis = pool.getResource()) {
            jedis.set(PLAYER_PREF_PREFIX + playerUuid, value);
        }
    }

    /**
     * Publish an {@link AudioEvent} to the {@value EVENTS_CHANNEL} channel.
     *
     * <p>Pattern-matching on the sealed interface guarantees exhaustive dispatch
     * and will cause a compile error if a new {@code AudioEvent} subtype is added
     * without updating this switch.
     *
     * @param event the event to publish
     */
    public void publish(AudioEvent event) {
        String json = switch (event) {
            case RegionEnterEvent e -> e.toJson();
            case AudioPlayEvent   e -> e.toJson();
            case AudioStopEvent   e -> e.toJson();
        };
        publishAndRecord(json);
    }

    /**
     * Publish a pre-serialised JSON string directly to the {@value EVENTS_CHANNEL} channel.
     *
     * <p>Use this for infrastructure events (player connect / disconnect, server switch)
     * that do not have a corresponding {@link AudioEvent} sealed subtype.
     *
     * @param json the raw JSON payload string
     */
    public void publish(String json) {
        publishAndRecord(json);
    }

    private void publishAndRecord(String json) {
        try (Jedis jedis = pool.getResource()) {
            jedis.publish(EVENTS_CHANNEL, json);
            // Prepend to recent-events list and cap at 200 entries so the admin
            // WebSocket can replay history on connect without unbounded memory growth.
            jedis.lpush(RECENT_EVENTS_KEY, json);
            jedis.ltrim(RECENT_EVENTS_KEY, 0L, RECENT_EVENTS_CAP);
        }
    }

    /**
     * Register a player in the {@value SESSIONS_KEY} hash.
     *
     * <p>Called on proxy login ({@code server} = empty string) and again on each
     * server switch ({@code server} = new backend name) to keep the entry current.
     *
     * @param playerUuid player UUID string
     * @param username   Minecraft username
     * @param server     current backend server name, or {@code ""} if not yet connected
     */
    public void sessionJoin(String playerUuid, String username, String server) {
        String json = """
                {"username":"%s","server":"%s","joined_at":%d}"""
                .formatted(username, server, System.currentTimeMillis() / 1000L);
        try (Jedis jedis = pool.getResource()) {
            jedis.hset(SESSIONS_KEY, playerUuid, json);
        }
    }

    /**
     * Remove a player from the {@value SESSIONS_KEY} hash on proxy disconnect.
     *
     * @param playerUuid player UUID string
     */
    public void sessionLeave(String playerUuid) {
        try (Jedis jedis = pool.getResource()) {
            jedis.hdel(SESSIONS_KEY, playerUuid);
        }
    }

    /** Release all pooled connections. Call from the platform plugin's shutdown hook. */
    public void close() {
        pool.close();
    }

    private static JedisPoolConfig buildPoolConfig() {
        JedisPoolConfig cfg = new JedisPoolConfig();
        cfg.setMaxTotal(16);
        cfg.setMaxIdle(8);
        cfg.setMinIdle(2);
        cfg.setTestOnBorrow(true);
        cfg.setTestOnReturn(false);
        cfg.setTestWhileIdle(true);
        cfg.setMinEvictableIdleTime(Duration.ofSeconds(60));
        cfg.setTimeBetweenEvictionRuns(Duration.ofSeconds(30));
        return cfg;
    }
}
