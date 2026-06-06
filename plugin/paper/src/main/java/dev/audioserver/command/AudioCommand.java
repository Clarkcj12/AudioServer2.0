package dev.audioserver.command;

import dev.audioserver.AudioServerPlugin;
import dev.audioserver.dto.TokenPayload;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.incendo.cloud.paper.PaperCommandManager;

import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Registers and handles the {@code /audio} command on Paper.
 *
 * <p>Subcommands:
 * <ul>
 *   <li>{@code /audio}               — open audio client or portal based on saved preference</li>
 *   <li>{@code /audio lite}          — always open the lite audio client</li>
 *   <li>{@code /audio portal}        — always open the advanced portal</li>
 *   <li>{@code /audio default lite}  — save "lite" as the default</li>
 *   <li>{@code /audio default portal}— save "portal" as the default</li>
 * </ul>
 *
 * <p>Redis writes are dispatched to Virtual Threads to keep the Bukkit thread free.
 */
public final class AudioCommand {

    private static final ExecutorService VIRTUAL_THREADS =
            Executors.newVirtualThreadPerTaskExecutor();

    private final AudioServerPlugin plugin;

    public AudioCommand(AudioServerPlugin plugin) {
        this.plugin = plugin;
    }

    public void register(PaperCommandManager<CommandSender> manager) {
        // /audio — smart default
        manager.command(
                manager.commandBuilder("audio")
                        .permission("audioserver.use")
                        .senderType(Player.class)
                        .handler(ctx -> handleDefault((Player) ctx.sender()))
                        .build()
        );

        // /audio lite
        manager.command(
                manager.commandBuilder("audio")
                        .literal("lite")
                        .permission("audioserver.use")
                        .senderType(Player.class)
                        .handler(ctx -> handleLite((Player) ctx.sender()))
                        .build()
        );

        // /audio portal
        manager.command(
                manager.commandBuilder("audio")
                        .literal("portal")
                        .permission("audioserver.use")
                        .senderType(Player.class)
                        .handler(ctx -> handlePortal((Player) ctx.sender()))
                        .build()
        );

        // /audio default lite
        manager.command(
                manager.commandBuilder("audio")
                        .literal("default")
                        .literal("lite")
                        .permission("audioserver.use")
                        .senderType(Player.class)
                        .handler(ctx -> handleSetDefault((Player) ctx.sender(), "lite"))
                        .build()
        );

        // /audio default portal
        manager.command(
                manager.commandBuilder("audio")
                        .literal("default")
                        .literal("portal")
                        .permission("audioserver.use")
                        .senderType(Player.class)
                        .handler(ctx -> handleSetDefault((Player) ctx.sender(), "portal"))
                        .build()
        );

        // /audio admin — admin portal login link (requires audioserver.admin)
        manager.command(
                manager.commandBuilder("audio")
                        .literal("admin")
                        .permission("audioserver.admin")
                        .senderType(Player.class)
                        .handler(ctx -> handleAdmin((Player) ctx.sender()))
                        .build()
        );
    }

    // ── Handlers ─────────────────────────────────────────────────────────────

    private void handleDefault(Player player) {
        VIRTUAL_THREADS.submit(() -> {
            try {
                String pref = plugin.getRedisManager().getPlayerDefault(player.getUniqueId());
                if ("portal".equals(pref)) {
                    sendPortalLink(player);
                } else {
                    sendLiteLink(player);
                }
            } catch (Exception e) {
                sendError(player, e);
            }
        });
    }

    private void handleLite(Player player) {
        VIRTUAL_THREADS.submit(() -> {
            try {
                sendLiteLink(player);
            } catch (Exception e) {
                sendError(player, e);
            }
        });
    }

    private void handlePortal(Player player) {
        VIRTUAL_THREADS.submit(() -> {
            try {
                sendPortalLink(player);
            } catch (Exception e) {
                sendError(player, e);
            }
        });
    }

    private void handleAdmin(Player player) {
        VIRTUAL_THREADS.submit(() -> {
            try {
                sendAdminLink(player);
            } catch (Exception e) {
                sendError(player, e);
            }
        });
    }

    private void handleSetDefault(Player player, String value) {
        VIRTUAL_THREADS.submit(() -> {
            try {
                plugin.getRedisManager().setPlayerDefault(player.getUniqueId(), value);
                String label = "portal".equals(value) ? "Advanced Portal" : "Lite Client";
                player.sendMessage(
                        Component.text("[AudioServer] ", NamedTextColor.AQUA)
                                .append(Component.text(
                                        "Default set to " + label + ". Use /audio to open it.",
                                        NamedTextColor.GREEN))
                );
            } catch (Exception e) {
                sendError(player, e);
            }
        });
    }

    // ── Link builders ─────────────────────────────────────────────────────────

    private void sendLiteLink(Player player) {
        String token = UUID.randomUUID().toString();
        TokenPayload payload = new TokenPayload(token, player.getUniqueId(),
                System.currentTimeMillis() + 60_000L);
        plugin.getRedisManager().writeOttToken(payload);

        String domain = plugin.getConfig().getString("domain", "https://audio.example.com");
        String url    = domain + "/listen?token=" + token;

        player.sendMessage(
                Component.text("[AudioServer] ", NamedTextColor.AQUA)
                        .append(Component.text("Click here to open the audio client.", NamedTextColor.GREEN)
                                .clickEvent(ClickEvent.openUrl(url)))
                        .append(Component.text(" | ", NamedTextColor.DARK_GRAY))
                        .append(Component.text("[Open Portal]", NamedTextColor.GRAY)
                                .clickEvent(ClickEvent.runCommand("/audio portal")))
        );
    }

    private void sendPortalLink(Player player) {
        String token    = UUID.randomUUID().toString();
        String username = player.getName();
        plugin.getRedisManager().writePortalOttToken(token, player.getUniqueId(), username);

        String portal = plugin.getConfig().getString("portal", "https://portal.example.com");
        String url    = portal + "/auth/callback?token=" + token;

        player.sendMessage(
                Component.text("[AudioServer] ", NamedTextColor.AQUA)
                        .append(Component.text("Click here to open your portal.", NamedTextColor.GREEN)
                                .clickEvent(ClickEvent.openUrl(url)))
                        .append(Component.text(" | ", NamedTextColor.DARK_GRAY))
                        .append(Component.text("[Audio Only]", NamedTextColor.GRAY)
                                .clickEvent(ClickEvent.runCommand("/audio lite")))
        );
    }

    private void sendAdminLink(Player player) {
        String token  = UUID.randomUUID().toString();
        plugin.getRedisManager().writeAdminOttToken(token, player.getUniqueId());

        String portal = plugin.getConfig().getString("portal", "https://portal.example.com");
        String url    = portal + "/auth/admin-callback?token=" + token;

        player.sendMessage(
                Component.text("[AudioServer] ", NamedTextColor.AQUA)
                        .append(Component.text("Click here to open the admin portal.", NamedTextColor.GOLD)
                                .clickEvent(ClickEvent.openUrl(url)))
                        .append(Component.text(" (expires in 5 min)", NamedTextColor.DARK_GRAY))
        );
    }

    private void sendError(Player player, Exception e) {
        plugin.getLogger().warning("Audio command error for " + player.getName() + ": " + e.getMessage());
        player.sendMessage(Component.text(
                "Could not start audio session. Please try again.", NamedTextColor.RED));
    }
}
