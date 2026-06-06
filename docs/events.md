---
id: events
title: Event & Message Contract
sidebar_position: 2
---

# Event & Message Contract

This file is the **single source of truth** for all JSON payloads exchanged between system components.
Both the Java plugin writer and the Rust backend reader MUST conform to these schemas exactly.

---

## Redis Key Contract

### One-Time Token (OTT)

| Field | Value |
|-------|-------|
| **Key pattern** | `audio:auth:token:<uuidv4-token>` |
| **Value** | Player Minecraft UUID (plain string, e.g. `550e8400-e29b-41d4-a716-446655440000`) |
| **TTL** | 60 seconds |
| **Written by** | Java plugin (`RedisManager.writeOttToken`) |
| **Read & deleted by** | Rust backend (`auth::ott::validate`) via `GETDEL` |

> **Note:** `GETDEL` is used (not `GET` + `DEL`) to prevent two racing WebSocket connections
> from both consuming the same token.

### Admin WebSocket Ticket

| Field | Value |
|-------|-------|
| **Key pattern** | `admin:ticket:<uuidv4-ticket>` |
| **Value** | `""` (empty string — existence is the signal) |
| **TTL** | 15 seconds |
| **Written by** | Rust relay `POST /api/admin/ticket` (requires admin JWT) |
| **Read & deleted by** | Rust relay `GET /ws/admin?ticket=<uuid>` via `GETDEL` |

> Single-use, short-TTL. Fetch a fresh ticket on every WebSocket connect or reconnect.

### Recent Events List

| Field | Value |
|-------|-------|
| **Key** | `audio:recent-events` |
| **Type** | Redis List |
| **Element** | Raw `audio:events` JSON payload (same schema as Pub/Sub messages) |
| **Cap** | 200 entries (LTRIM after every LPUSH) |
| **Written by** | Java plugin `RedisManager.publishAndRecord()` (all `publish` overloads) |
| **Read by** | Rust relay admin WS session on connect — replays for history |

### Active Sessions Hash

| Field | Value |
|-------|-------|
| **Key** | `audio:sessions` |
| **Type** | Redis Hash |
| **Field** | Player Minecraft UUID (string) |
| **Value** | Session JSON (see schema below) |
| **TTL** | None — entries are deleted explicitly on disconnect |
| **Written by** | Velocity `PlayerEventListener` (`RedisManager.sessionJoin`) |
| **Updated by** | Velocity `PlayerEventListener` on `ServerConnectedEvent` |
| **Deleted by** | Velocity `PlayerEventListener` (`RedisManager.sessionLeave`) on `DisconnectEvent` |
| **Read by** | Rust relay `GET /api/stats` (`HLEN audio:sessions`) and `GET /api/sessions` (Phase 2c) |

**Session JSON value schema:**

```json
{
  "username":  "Notch",
  "server":    "survival",
  "joined_at": 1717552800
}
```

| Field | Type | Description |
|-------|------|-------------|
| `username` | `string` | Minecraft username |
| `server` | `string` | Current backend server name (empty string between login and first server assignment) |
| `joined_at` | `number` | Unix timestamp (seconds) of initial proxy login |

> **Stale entries:** If the Velocity proxy crashes without firing `DisconnectEvent`, session
> entries will remain in the hash. In production, set a TTL via a cron/periodic heartbeat
> and remove any entry older than a configurable threshold.

---

## WorldGuard Flag Configuration

Audio regions are defined entirely inside WorldGuard — no separate region database is needed.
The plugin registers three custom flags that can be set on any existing WG region:

| Flag | Type | Description |
|------|------|-------------|
| `audio-src` | `String` | URL of the audio asset to play. **Setting this flag activates audio for the region.** |
| `audio-volume` | `Integer` | Volume percentage `0–100`. Default: `100`. |
| `audio-loop` | `State` | `allow` = loop continuously. `deny` / absent = play once. |

**Example (WorldGuard CLI):**

```
/rg flag spawn audio-src https://cdn.example.com/ambient/spawn.ogg
/rg flag spawn audio-volume 75
/rg flag spawn audio-loop allow
```

**How it works:**

1. `AudioFlags.register()` runs in `AudioServerPlugin.onLoad()` to register the three flags before WorldGuard seals its registry.
2. `WorldGuardModule` registers `AudioSessionHandler` (a `FlagValueChangeHandler<String>`) with WorldGuard's `SessionManager` on `onEnable()`.
3. When a player crosses a region boundary, WorldGuard evaluates the effective `audio-src` value for the new position and calls one of:
   - `onSetValue` → publish `AudioPlayEvent` with `src`, `volume`, `loop` resolved from the region set.
   - `onAbsentValue` → publish `AudioStopEvent` (player left all audio regions).
   - `onInitialValue` → same as `onSetValue`, fired once on login/teleport.

---

## Redis Pub/Sub — Channel: `audio:events`

All events are JSON objects published by the Java plugin and consumed by the Rust relay.

### `region_enter`

Fired when a player enters or leaves a named audio region.

```json
{
  "event":     "region_enter",
  "player_id": "550e8400-e29b-41d4-a716-446655440000",
  "region_id": "spawn-lobby",
  "action":    "enter"
}
```

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `event` | `string` | `"region_enter"` | Event discriminator |
| `player_id` | `string` (UUID) | — | Minecraft player UUID |
| `region_id` | `string` | — | Named region identifier |
| `action` | `string` | `"enter"` \| `"leave"` | Direction of crossing |

---

### `audio_play`

Instructs the relay to begin audio playback for a specific player.

```json
{
  "event":     "audio_play",
  "player_id": "550e8400-e29b-41d4-a716-446655440000",
  "src":       "https://cdn.example.com/audio/ambient.ogg",
  "volume":    0.80,
  "loop":      true
}
```

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `event` | `string` | `"audio_play"` | Event discriminator |
| `player_id` | `string` (UUID) | — | Target player |
| `src` | `string` (URL) | HTTPS preferred | Audio asset URL (OGG/MP3/WAV) |
| `volume` | `number` | `0.0 – 1.0` | Playback volume |
| `loop` | `boolean` | — | Loop continuously |

---

### `audio_stop`

Instructs the relay to stop all active audio for a player.

```json
{
  "event":     "audio_stop",
  "player_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `event` | `string` | `"audio_stop"` |
| `player_id` | `string` (UUID) | Target player |

---

### `player_connect` *(Velocity only)*

Published by `PlayerEventListener` when a player completes the proxy login handshake.
The Rust relay uses this to pre-warm any per-player state it maintains.

```json
{
  "event":     "player_connect",
  "player_id": "550e8400-e29b-41d4-a716-446655440000",
  "username":  "Notch"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `event` | `string` | `"player_connect"` |
| `player_id` | `string` (UUID) | Minecraft player UUID |
| `username` | `string` | Minecraft username |

---

### `server_switch` *(Velocity only)*

Published when a player moves from one backend server to another through the proxy.
Lets the relay update spatial audio context for the new server.

```json
{
  "event":     "server_switch",
  "player_id": "550e8400-e29b-41d4-a716-446655440000",
  "server":    "survival"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `event` | `string` | `"server_switch"` |
| `player_id` | `string` (UUID) | Minecraft player UUID |
| `server` | `string` | Target backend server name |

---

### `player_disconnect` *(Velocity only)*

Published when a player disconnects from the proxy entirely.
The Rust relay should close the associated WebSocket session on receipt.

```json
{
  "event":     "player_disconnect",
  "player_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `event` | `string` | `"player_disconnect"` |
| `player_id` | `string` (UUID) | Minecraft player UUID |

---

## WebSocket Messages — Server → Client

Sent by the Rust relay node over the authenticated WebSocket connection.

### `auth_success`

First message sent immediately after OTT validation succeeds.

```json
{
  "type":        "auth_success",
  "jwt":         "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "player_uuid": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` | `"auth_success"` |
| `jwt` | `string` | Signed HS256 JWT; store in `localStorage` |
| `player_uuid` | `string` (UUID) | Player's Minecraft UUID |

**JWT Claims:**

| Claim | Type | Description |
|-------|------|-------------|
| `sub` | `string` | Player UUID |
| `iat` | `number` | Issued-at (Unix seconds) |
| `exp` | `number` | Expiry (Unix seconds, default `iat + 86400`) |

---

### `audio_play` (relay → client)

Forwarded from the Redis Pub/Sub event to the connected web client.

```json
{
  "type":   "audio_play",
  "src":    "https://cdn.example.com/audio/ambient.ogg",
  "volume": 0.80,
  "loop":   true
}
```

---

### `audio_stop` (relay → client)

```json
{
  "type": "audio_stop"
}
```

---

## WebSocket Messages — Client → Server

### Ping / Pong

The client may send WebSocket-level `Ping` frames; the relay responds with `Pong`.
No application-level heartbeat is defined in Phase 1.
