/**
 * WebSocket message types for the AudioServer 2.0 lite client.
 *
 * TypeScript projection of the relay → client contract defined in
 * {@link ../../../../docs/events.md}. Keep in sync with that file and with
 * {@link ../../../../portal/lib/ws-types.ts}.
 */

/** First message: JWT delivered after OTT validation succeeds. */
export interface AuthSuccessMessage {
    type: 'auth_success';
    /** Signed HS256 JWT — store in localStorage for future API calls. */
    jwt: string;
    /** The player's Minecraft UUID. */
    player_uuid: string;
}

/** Relay instructs the client to begin audio playback. */
export interface AudioPlayMessage {
    type: 'audio_play';
    /** URL of the audio asset (OGG / MP3 / WAV). */
    src: string;
    /** Volume in the range [0.0, 1.0]. */
    volume: number;
    /** Whether the clip should loop continuously. */
    loop: boolean;
}

/** Relay instructs the client to stop all active audio. */
export interface AudioStopMessage {
    type: 'audio_stop';
}

/** Discriminated union of all messages the relay sends to this client. */
export type RelayMessage = AuthSuccessMessage | AudioPlayMessage | AudioStopMessage;
