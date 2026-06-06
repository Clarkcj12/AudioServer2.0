/**
 * WebSocket message types for AudioServer 2.0.
 *
 * These definitions are the TypeScript projection of the JSON contract
 * defined in {@link ../../docs/events.md}. Any change to that file must be
 * reflected here to keep all three clients (Svelte lite, Next.js portal, Rust relay) in sync.
 */

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

/** First message sent by the relay after successful OTT validation. */
export interface AuthSuccessMessage {
  type: 'auth_success';
  /** Signed HS256 JWT — store in localStorage. */
  jwt: string;
  /** The player's Minecraft UUID. */
  player_uuid: string;
}

/** Relay forwards an audio-play instruction to the connected client. */
export interface AudioPlayMessage {
  type: 'audio_play';
  /** URL of the audio asset (OGG / MP3 / WAV). */
  src: string;
  /** Volume in the range [0.0, 1.0]. */
  volume: number;
  /** Whether the clip should loop. */
  loop: boolean;
}

/** Relay instructs the client to stop all active audio. */
export interface AudioStopMessage {
  type: 'audio_stop';
}

/** Discriminated union of all messages the relay sends to a web client. */
export type RelayMessage = AuthSuccessMessage | AudioPlayMessage | AudioStopMessage;

// ---------------------------------------------------------------------------
// Redis Pub/Sub event shapes (audio:events channel)
// Published by the Java plugin / Velocity listener; consumed by the relay.
// These appear in the admin portal's live event feed (Phase 2).
// ---------------------------------------------------------------------------

export interface RegionEnterEvent {
  event: 'region_enter';
  player_id: string;
  region_id: string;
  action: 'enter' | 'leave';
}

export interface AudioPlayEvent {
  event: 'audio_play';
  player_id: string;
  src: string;
  volume: number;
  loop: boolean;
}

export interface AudioStopEvent {
  event: 'audio_stop';
  player_id: string;
}

export interface PlayerConnectEvent {
  event: 'player_connect';
  player_id: string;
  username: string;
}

export interface ServerSwitchEvent {
  event: 'server_switch';
  player_id: string;
  server: string;
}

export interface PlayerDisconnectEvent {
  event: 'player_disconnect';
  player_id: string;
}

/** Discriminated union of all Redis Pub/Sub event shapes. */
export type RedisEvent =
  | RegionEnterEvent
  | AudioPlayEvent
  | AudioStopEvent
  | PlayerConnectEvent
  | ServerSwitchEvent
  | PlayerDisconnectEvent;
