package dev.audioserver.velocity.listener;

import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.connection.PostLoginEvent;
import com.velocitypowered.api.event.player.ServerConnectedEvent;
import dev.audioserver.velocity.AudioServerVelocityPlugin;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Maintains {@code audio:sessions} (a Redis hash) and publishes player lifecycle
 * events to {@code audio:events} so that:
 *
 * <ul>
 *   <li>The Rust relay's {@code GET /api/stats} can return a live session count
 *       from {@code HLEN audio:sessions}.</li>
 *   <li>The relay's per-player WS loop receives {@code player_disconnect} and
 *       can close zombie connections.</li>
 * </ul>
 *
 * <p>All Redis operations are dispatched to Virtual Threads — Velocity's
 * netty event loop threads are never blocked.
 */
public final class PlayerEventListener {

    private static final ExecutorService VIRTUAL_THREADS =
            Executors.newVirtualThreadPerTaskExecutor();

    private final AudioServerVelocityPlugin plugin;

    public PlayerEventListener(AudioServerVelocityPlugin plugin) {
        this.plugin = plugin;
    }

    /**
     * Player connected to the proxy. Registers the session in {@code audio:sessions}
     * with an empty {@code server} field (not yet assigned to a backend).
     *
     * <p>Published to {@code audio:events}:
     * <pre>{@code
     * {"event":"player_connect","player_id":"<uuid>","username":"<name>"}
     * }</pre>
     */
    @Subscribe
    public void onPostLogin(PostLoginEvent event) {
        String playerId = event.getPlayer().getUniqueId().toString();
        String username = event.getPlayer().getUsername();
        String json = """
                {"event":"player_connect","player_id":"%s","username":"%s"}"""
                .formatted(playerId, username);

        VIRTUAL_THREADS.submit(() -> {
            plugin.getRedisManager().sessionJoin(playerId, username, "");
            publish(json);
        });
    }

    /**
     * Player switched backend servers. Updates the session entry in {@code audio:sessions}
     * so that {@code GET /api/sessions} always shows the current server.
     *
     * <p>Published to {@code audio:events}:
     * <pre>{@code
     * {"event":"server_switch","player_id":"<uuid>","server":"<server-name>"}
     * }</pre>
     */
    @Subscribe
    public void onServerConnected(ServerConnectedEvent event) {
        String playerId = event.getPlayer().getUniqueId().toString();
        String username = event.getPlayer().getUsername();
        String server   = event.getServer().getServerInfo().getName();
        String json = """
                {"event":"server_switch","player_id":"%s","server":"%s"}"""
                .formatted(playerId, server);

        VIRTUAL_THREADS.submit(() -> {
            plugin.getRedisManager().sessionJoin(playerId, username, server);
            publish(json);
        });
    }

    /**
     * Player disconnected from the proxy. Removes the session from {@code audio:sessions}.
     *
     * <p>Published to {@code audio:events}:
     * <pre>{@code
     * {"event":"player_disconnect","player_id":"<uuid>"}
     * }</pre>
     */
    @Subscribe
    public void onDisconnect(DisconnectEvent event) {
        String playerId = event.getPlayer().getUniqueId().toString();
        String json = """
                {"event":"player_disconnect","player_id":"%s"}"""
                .formatted(playerId);

        VIRTUAL_THREADS.submit(() -> {
            plugin.getRedisManager().sessionLeave(playerId);
            publish(json);
        });
    }

    private void publish(String json) {
        try {
            plugin.getRedisManager().publish(json);
        } catch (Exception e) {
            // Never throw on a background thread — the player lifecycle must continue
        }
    }
}
