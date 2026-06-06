package dev.audioserver.event;

/**
 * Fired when a player enters or leaves a named audio region.
 *
 * <p>Redis channel: {@code audio:events} — payload schema in {@code docs/events.md}.
 *
 * @param playerId the Minecraft player UUID
 * @param regionId the region identifier
 * @param action   {@code "enter"} or {@code "leave"}
 */
public record RegionEnterEvent(String playerId, String regionId, String action)
        implements AudioEvent {

    @Override
    public String toJson() {
        return """
                {"event":"region_enter","player_id":"%s","region_id":"%s","action":"%s"}"""
                .formatted(playerId, regionId, action);
    }
}
