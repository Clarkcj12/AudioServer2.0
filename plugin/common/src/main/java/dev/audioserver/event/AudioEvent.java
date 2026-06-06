package dev.audioserver.event;

/**
 * Sealed interface for all events published to the Redis {@code audio:events} channel.
 *
 * <p>The sealed hierarchy lets callers use exhaustive {@code switch} expressions,
 * making it impossible to silently miss a new event type at compile time.
 *
 * <p>Every permitted subtype must produce a payload conforming to {@code docs/events.md}.
 *
 * @see RegionEnterEvent
 * @see AudioPlayEvent
 */
public sealed interface AudioEvent permits RegionEnterEvent, AudioPlayEvent, AudioStopEvent {

    /** @return the Minecraft player UUID as a string */
    String playerId();

    /**
     * Serialise this event to a JSON string for Redis Pub/Sub publication.
     *
     * @return the JSON payload string
     */
    String toJson();
}
