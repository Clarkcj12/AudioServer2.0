package dev.audioserver.module;

import dev.audioserver.AudioServerPlugin;

/**
 * Contract for a pluggable AudioServer feature module on Paper.
 *
 * <p>Implementations are registered via {@link ModuleRegistry#register(AudioModule)}
 * and receive lifecycle callbacks when the plugin enables and disables.
 *
 * @see ModuleRegistry
 */
public interface AudioModule {

    /**
     * A unique, kebab-case identifier (e.g. {@code "philips-hue"}, {@code "traincarts"}).
     *
     * @return the module ID
     */
    String getId();

    /**
     * Called when the plugin enables. Register listeners, commands, and other setup here.
     *
     * @param plugin the owning plugin instance
     */
    void onEnable(AudioServerPlugin plugin);

    /**
     * Called when the plugin disables. Release all held resources here.
     */
    void onDisable();
}
