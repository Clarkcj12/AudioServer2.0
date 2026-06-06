package dev.audioserver.velocity;

import com.google.inject.Inject;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.plugin.PluginContainer;
import com.velocitypowered.api.proxy.ProxyServer;
import dev.audioserver.redis.RedisManager;
import dev.audioserver.velocity.command.VelocityAudioCommand;
import dev.audioserver.velocity.listener.PlayerEventListener;
import org.incendo.cloud.execution.ExecutionCoordinator;
import org.incendo.cloud.velocity.VelocityCommandManager;
import org.slf4j.Logger;
import com.velocitypowered.api.command.CommandSource;

/**
 * Velocity proxy-side entry point for AudioServer 2.0.
 *
 * <p>Responsibilities at the proxy layer:
 * <ul>
 *   <li>Register the {@code /audio} command so players can open a client from any backend server.</li>
 *   <li>Listen for {@link com.velocitypowered.api.event.connection.PostLoginEvent} and
 *       {@link com.velocitypowered.api.event.player.ServerConnectedEvent} to publish
 *       player-state events to Redis, allowing the Rust relay to manage sessions.</li>
 *   <li>Maintain the shared {@link RedisManager} connection pool (from the {@code :common} module).</li>
 * </ul>
 *
 * <p>Configuration is read from environment variables so that the proxy and the Rust
 * relay nodes can share the same deployment config without a second config file format:
 * <ul>
 *   <li>{@code REDIS_HOST} (default: {@code 127.0.0.1})</li>
 *   <li>{@code REDIS_PORT} (default: {@code 6379})</li>
 *   <li>{@code REDIS_PASSWORD} (optional)</li>
 *   <li>{@code AUDIO_DOMAIN} (default: {@code https://audio.example.com})</li>
 * </ul>
 */
@Plugin(
        id          = "audioserver",
        name        = "AudioServer",
        version     = "1.0.0-SNAPSHOT",
        description = "Spatial audio and voice chat powered by AudioServer 2.0",
        authors     = {"AudioServer Contributors"}
)
public final class AudioServerVelocityPlugin {

    private final ProxyServer proxy;
    private final Logger logger;
    private final PluginContainer container;

    private RedisManager redisManager;
    private VelocityCommandManager<CommandSource> commandManager;

    /** The domain used to build clickable audio-client OTT links sent to players. */
    private String domain;

    /** The domain of the advanced player portal (for /audio portal links). */
    private String portalDomain;

    @Inject
    public AudioServerVelocityPlugin(ProxyServer proxy, Logger logger, PluginContainer container) {
        this.proxy     = proxy;
        this.logger    = logger;
        this.container = container;
    }

    @Subscribe
    public void onProxyInitialize(ProxyInitializeEvent event) {
        String host    = System.getenv().getOrDefault("REDIS_HOST", "127.0.0.1");
        int    port    = Integer.parseInt(System.getenv().getOrDefault("REDIS_PORT", "6379"));
        String pwd     = System.getenv("REDIS_PASSWORD");
        domain         = System.getenv().getOrDefault("AUDIO_DOMAIN",  "https://audio.example.com");
        portalDomain   = System.getenv().getOrDefault("PORTAL_DOMAIN", "https://portal.example.com");

        redisManager = new RedisManager(host, port, pwd);

        // Incendo Cloud v2 — Velocity command manager.
        // Cloud 2.0.0-beta.10 uses a positional constructor; if you upgrade to a
        // later 2.x release check whether VelocityCommandManager gained a builder().
        commandManager = new VelocityCommandManager<>(
                container,
                proxy,
                ExecutionCoordinator.asyncCoordinator(),
                source -> source   // CommandSource identity mapper
        );

        new VelocityAudioCommand(this).register(commandManager);
        proxy.getEventManager().register(this, new PlayerEventListener(this));

        logger.info("AudioServer 2.0 (Velocity) enabled. Domain: {}", domain);
    }

    @Subscribe
    public void onProxyShutdown(ProxyShutdownEvent event) {
        if (redisManager != null) redisManager.close();
        logger.info("AudioServer 2.0 (Velocity) disabled.");
    }

    /** @return the Velocity {@link ProxyServer} */
    public ProxyServer getProxy() {
        return proxy;
    }

    /** @return the shared Redis manager from the {@code :common} module */
    public RedisManager getRedisManager() {
        return redisManager;
    }

    /** @return the base domain for clickable audio links, e.g. {@code https://audio.example.com} */
    public String getDomain() {
        return domain;
    }

    /** @return the portal domain for clickable portal links, e.g. {@code https://portal.example.com} */
    public String getPortalDomain() {
        return portalDomain;
    }
}
