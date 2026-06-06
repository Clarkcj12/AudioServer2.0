package dev.audioserver.event;

/**
 * Instructs the relay to stop all active audio for a specific player.
 *
 * <p>Redis channel: {@code audio:events} — payload schema in {@code docs/events.md}.
 * Published by {@code WorldGuardModule}'s session handler when a player leaves all
 * WG regions that carry the {@code audio-src} flag.
 *
 * @param playerId the Minecraft player UUID
 */
public record AudioStopEvent(String playerId) implements AudioEvent {

    @Override
    public String toJson() {
        return """
                {"event":"audio_stop","player_id":"%s"}""".formatted(playerId);
    }
}
