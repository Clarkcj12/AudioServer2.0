package dev.audioserver;

import dev.audioserver.command.AudioCommand;
import dev.audioserver.module.ModuleRegistry;
import dev.audioserver.module.worldguard.AudioFlags;
import dev.audioserver.module.worldguard.WorldGuardModule;
import dev.audioserver.redis.RedisManager;
import org.bukkit.Bukkit;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.java.JavaPlugin;
import org.incendo.cloud.execution.ExecutionCoordinator;
import org.incendo.cloud.paper.PaperCommandManager;

/**
 * Entry point for the AudioServer Paper plugin.
 *
 * <p>Lifecycle:
 * <ol>
 *   <li>{@link #onLoad()} — registers WorldGuard flags (must run before WG finalises its registry).</li>
 *   <li>{@link #onEnable()} — starts Redis pool, Cloud commands, and all registered modules.</li>
 *   <li>{@link #onDisable()} — gracefully shuts down modules and the Redis pool.</li>
 * </ol>
 *
 * <p>The WorldGuard module is registered automatically when WorldGuard is present.
 * Third-party add-ons should register their own modules during their {@code onEnable()}:
 * <pre>{@code
 * AudioServerPlugin.getInstance().getModuleRegistry().register(new MyModule());
 * }</pre>
 */
public final class AudioServerPlugin extends JavaPlugin {

    private static AudioServerPlugin instance;

    private RedisManager redisManager;
    private ModuleRegistry moduleRegistry;
    private PaperCommandManager<CommandSender> commandManager;

    // ---------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------

    /**
     * Register WorldGuard flags before the WG flag registry is sealed.
     * This must happen here — attempting to register flags in {@code onEnable()} is too late.
     */
    @Override
    public void onLoad() {
        if (Bukkit.getPluginManager().getPlugin("WorldGuard") != null) {
            try {
                AudioFlags.register();
                getLogger().info("AudioServer audio flags registered with WorldGuard.");
            } catch (Exception e) {
                getLogger().warning("Failed to register WorldGuard flags: " + e.getMessage());
            }
        }
    }

    @Override
    public void onEnable() {
        instance = this;
        saveDefaultConfig();

        redisManager = new RedisManager(
                getConfig().getString("redis.host", "127.0.0.1"),
                getConfig().getInt("redis.port", 6379),
                getConfig().getString("redis.password", null)
        );

        commandManager = PaperCommandManager.builder()
                .executionCoordinator(ExecutionCoordinator.asyncCoordinator())
                .buildOnEnable(this);

        moduleRegistry = new ModuleRegistry();

        // Auto-register the WorldGuard module when WG is on the server.
        // The flags were already registered in onLoad() above.
        if (Bukkit.getPluginManager().isPluginEnabled("WorldGuard")) {
            moduleRegistry.register(new WorldGuardModule());
        }

        moduleRegistry.enableAll(this);
        new AudioCommand(this).register(commandManager);

        getLogger().info("AudioServer 2.0 (Paper) enabled.");
    }

    @Override
    public void onDisable() {
        if (moduleRegistry != null) moduleRegistry.disableAll();
        if (redisManager != null) redisManager.close();
        getLogger().info("AudioServer 2.0 (Paper) disabled.");
    }

    // ---------------------------------------------------------------------------
    // Accessors
    // ---------------------------------------------------------------------------

    /** @return the singleton plugin instance */
    public static AudioServerPlugin getInstance() { return instance; }

    /** @return the Redis connection pool manager */
    public RedisManager getRedisManager() { return redisManager; }

    /** @return the module registry for third-party integrations */
    public ModuleRegistry getModuleRegistry() { return moduleRegistry; }

    /** @return the shared Incendo Cloud command manager */
    public PaperCommandManager<CommandSender> getCommandManager() { return commandManager; }
}
