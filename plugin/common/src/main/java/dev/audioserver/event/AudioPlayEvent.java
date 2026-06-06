package dev.audioserver.event;

/**
 * Fired when the server triggers audio playback for a specific player.
 *
 * <p>Redis channel: {@code audio:events} — payload schema in {@code docs/events.md}.
 *
 * @param playerId the Minecraft player UUID
 * @param src      URL of the audio asset to play
 * @param volume   playback volume in the range {@code [0.0, 1.0]}
 * @param loop     whether the clip should loop continuously
 */
public record AudioPlayEvent(String playerId, String src, double volume, boolean loop)
        implements AudioEvent {

    @Override
    public String toJson() {
        return """
                {"event":"audio_play","player_id":"%s","src":"%s","volume":%.2f,"loop":%b}"""
                .formatted(playerId, src, volume, loop);
    }
}
