package dev.audioserver.module.worldguard;

import com.sk89q.worldguard.WorldGuard;
import dev.audioserver.AudioServerPlugin;
import dev.audioserver.module.AudioModule;

/**
 * AudioServer module that integrates with WorldGuard region flags.
 *
 * <p>When enabled, this module registers {@link AudioSessionHandler} with WorldGuard's
 * {@code SessionManager}. From that point on, every player movement that crosses a
 * WorldGuard region boundary triggers a flag-value evaluation:
 *
 * <ul>
 *   <li>Region has {@code audio-src} → {@code AudioPlayEvent} published to Redis.</li>
 *   <li>Player leaves all {@code audio-src} regions → {@code AudioStopEvent} published.</li>
 * </ul>
 *
 * <p><b>Flag registration</b> ({@link AudioFlags#register()}) must happen in
 * {@code AudioServerPlugin.onLoad()}, not here, because WorldGuard finalises its flag
 * registry before {@code onEnable()} runs.
 *
 * <p>This module is registered automatically when WorldGuard is detected on the server.
 * No manual configuration is required beyond adding the WG flags to your regions.
 */
public final class WorldGuardModule implements AudioModule {

    @Override
    public String getId() {
        return "worldguard";
    }

    @Override
    public void onEnable(AudioServerPlugin plugin) {
        WorldGuard.getInstance()
                .getPlatform()
                .getSessionManager()
                .registerHandler(AudioSessionHandler.FACTORY, null);

        plugin.getLogger().info("WorldGuard audio region integration active. " +
                "Set 'audio-src' flag on any WG region to enable spatial audio.");
    }

    @Override
    public void onDisable() {
        // WorldGuard cleans up session handler registrations automatically
        // when the parent plugin shuts down.
    }
}
