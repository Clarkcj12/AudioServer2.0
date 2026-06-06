package dev.audioserver.module.worldguard;

import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.protection.flags.IntegerFlag;
import com.sk89q.worldguard.protection.flags.StateFlag;
import com.sk89q.worldguard.protection.flags.StringFlag;
import com.sk89q.worldguard.protection.flags.registry.FlagConflictException;
import com.sk89q.worldguard.protection.flags.registry.FlagRegistry;

/**
 * Custom WorldGuard flags that activate AudioServer on a per-region basis.
 *
 * <p><b>Usage (WorldGuard CLI):</b>
 * <pre>
 * /rg flag &lt;region&gt; audio-src https://cdn.example.com/ambient.ogg
 * /rg flag &lt;region&gt; audio-volume 80
 * /rg flag &lt;region&gt; audio-loop allow
 * </pre>
 *
 * <p>These flags <b>must be registered in {@code onLoad()}</b>, before WorldGuard
 * finalises its flag registry. Attempting to register them in {@code onEnable()} will
 * throw {@link FlagConflictException} or silently fail.
 *
 * <p>Pairs with {@link AudioSessionHandler}, which reacts to value changes via
 * WorldGuard's {@code FlagValueChangeHandler} mechanism.
 */
public final class AudioFlags {

    /**
     * URL of the audio asset to play inside this region.
     * Setting this flag to a non-null value is sufficient to activate audio playback;
     * the volume and loop flags will use their defaults when absent.
     */
    public static final StringFlag  AUDIO_SRC    = new StringFlag("audio-src");

    /**
     * Playback volume as an integer percentage: {@code 0–100}.
     * Defaults to {@code 100} (full volume) when not set on a region.
     */
    public static final IntegerFlag AUDIO_VOLUME = new IntegerFlag("audio-volume");

    /**
     * Whether the audio clip should loop continuously.
     * {@code ALLOW} = loop, {@code DENY} / absent = play once.
     */
    public static final StateFlag   AUDIO_LOOP   = new StateFlag("audio-loop", false);

    private AudioFlags() {}

    /**
     * Register all AudioServer flags with WorldGuard's {@link FlagRegistry}.
     *
     * <p>Must be called from {@code AudioServerPlugin.onLoad()}, before any other
     * WorldGuard or AudioServer initialisation runs.
     */
    public static void register() {
        FlagRegistry registry = WorldGuard.getInstance().getFlagRegistry();
        safeRegister(registry, AUDIO_SRC);
        safeRegister(registry, AUDIO_VOLUME);
        safeRegister(registry, AUDIO_LOOP);
    }

    private static void safeRegister(FlagRegistry registry,
                                     com.sk89q.worldguard.protection.flags.Flag<?> flag) {
        try {
            registry.register(flag);
        } catch (FlagConflictException ignored) {
            // Already registered by another plugin loading the same flag name — safe to ignore.
        }
    }
}
