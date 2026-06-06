package dev.audioserver.module.worldguard;

import com.sk89q.worldedit.util.Location;
import com.sk89q.worldguard.LocalPlayer;
import com.sk89q.worldguard.protection.ApplicableRegionSet;
import com.sk89q.worldguard.protection.flags.StateFlag.State;
import com.sk89q.worldguard.session.Session;
import com.sk89q.worldguard.session.handler.FlagValueChangeHandler;
import com.sk89q.worldguard.session.handler.Handler;
import dev.audioserver.AudioServerPlugin;
import dev.audioserver.event.AudioPlayEvent;
import dev.audioserver.event.AudioStopEvent;

/**
 * WorldGuard session handler that bridges WG region transitions to AudioServer Redis events.
 *
 * <p>Extends {@link FlagValueChangeHandler}{@code <String>} keyed on {@link AudioFlags#AUDIO_SRC}.
 * WorldGuard calls the three lifecycle callbacks whenever the effective value of that flag
 * changes for the tracked player:
 *
 * <ul>
 *   <li>{@link #onInitialValue} — player logs in or teleports into a region that has the flag.</li>
 *   <li>{@link #onSetValue}     — the effective {@code audio-src} value changes (crossing
 *       between regions that carry different audio URLs).</li>
 *   <li>{@link #onAbsentValue}  — the player leaves all regions with {@code audio-src} set.</li>
 * </ul>
 *
 * <p>Volume and loop are read from the destination {@link ApplicableRegionSet} at transition
 * time, so a region can supply all three flags independently.
 */
public final class AudioSessionHandler extends FlagValueChangeHandler<String> {

    private AudioSessionHandler(Session session) {
        super(session, AudioFlags.AUDIO_SRC);
    }

    // ---------------------------------------------------------------------------
    // FlagValueChangeHandler callbacks
    // ---------------------------------------------------------------------------

    @Override
    protected void onInitialValue(LocalPlayer player, ApplicableRegionSet regions, String src) {
        if (src != null) {
            publishPlay(player.getUniqueId().toString(), src, regions);
        }
    }

    @Override
    protected boolean onSetValue(LocalPlayer player, Location from, Location to,
                                 ApplicableRegionSet toSet, String newSrc) {
        publishPlay(player.getUniqueId().toString(), newSrc, toSet);
        return true; // never cancel movement
    }

    @Override
    protected boolean onAbsentValue(LocalPlayer player, Location from, Location to,
                                    ApplicableRegionSet toSet) {
        publishStop(player.getUniqueId().toString());
        return true;
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private static void publishPlay(String playerId, String src, ApplicableRegionSet regions) {
        Integer volPct   = regions.queryValue(null, AudioFlags.AUDIO_VOLUME);
        State   loopState = regions.queryState(null, AudioFlags.AUDIO_LOOP);

        // Convert integer percent (0–100) to double (0.0–1.0); default 1.0 when absent.
        double volume = (volPct != null && volPct >= 0 && volPct <= 100)
                ? volPct / 100.0
                : 1.0;
        boolean loop = loopState == State.ALLOW;

        AudioServerPlugin.getInstance().getRedisManager()
                .publish(new AudioPlayEvent(playerId, src, volume, loop));
    }

    private static void publishStop(String playerId) {
        AudioServerPlugin.getInstance().getRedisManager()
                .publish(new AudioStopEvent(playerId));
    }

    // ---------------------------------------------------------------------------
    // Factory — required by WorldGuard's SessionManager.registerHandler()
    // ---------------------------------------------------------------------------

    /** Singleton factory registered once via {@link WorldGuardModule#onEnable}. */
    public static final Factory FACTORY = new Factory();

    public static final class Factory extends Handler.Factory<AudioSessionHandler> {
        private Factory() {
            super(AudioSessionHandler.class);
        }

        @Override
        public AudioSessionHandler create(Session session) {
            return new AudioSessionHandler(session);
        }
    }
}
