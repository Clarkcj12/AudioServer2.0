package dev.audioserver.module;

import dev.audioserver.AudioServerPlugin;

import java.util.LinkedHashMap;

/**
 * Owns the lifecycle of all registered {@link AudioModule}s.
 *
 * <p>Modules are enabled in insertion order and disabled in reverse order.
 */
public final class ModuleRegistry {

    private final LinkedHashMap<String, AudioModule> modules = new LinkedHashMap<>();

    /**
     * Register a module before {@link #enableAll(AudioServerPlugin)} is called.
     *
     * @param module the module to register
     * @throws IllegalArgumentException if a module with the same ID is already registered
     */
    public void register(AudioModule module) {
        if (modules.containsKey(module.getId())) {
            throw new IllegalArgumentException("Module already registered: " + module.getId());
        }
        modules.put(module.getId(), module);
    }

    /** Enable all registered modules in insertion order. */
    public void enableAll(AudioServerPlugin plugin) {
        for (AudioModule m : modules.values()) {
            try {
                m.onEnable(plugin);
                plugin.getLogger().info("Enabled module: " + m.getId());
            } catch (Exception e) {
                plugin.getLogger().severe("Failed to enable module '" + m.getId() + "': " + e.getMessage());
            }
        }
    }

    /** Disable all registered modules in reverse insertion order. */
    public void disableAll() {
        var list = modules.values().stream().toList();
        for (int i = list.size() - 1; i >= 0; i--) {
            try {
                list.get(i).onDisable();
            } catch (Exception e) {
                AudioServerPlugin.getInstance().getLogger()
                        .severe("Error disabling module '" + list.get(i).getId() + "': " + e.getMessage());
            }
        }
    }

    /** @return the registered module for the given ID, or {@code null} */
    public AudioModule get(String id) {
        return modules.get(id);
    }
}
