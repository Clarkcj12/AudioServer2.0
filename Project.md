---
id: project
title: AudioServer 2.0 — Project Status & Roadmap
sidebar_position: 0
---

# AudioServer 2.0 — Project Status & Roadmap

Living development document. Update this file as decisions are made and phases complete.
Architecture diagrams and quick-start live in [`README.md`](./README.md).
JSON payload contracts live in [`docs/events.md`](./docs/events.md).

---

## Current Status — Phase 3a Complete

The full audio delivery loop is implemented. Server admins have a live event
stream showing all in-game audio activity in real time, with history replay on
connect.

| Component | Status | Notes |
|-----------|--------|-------|
| Rust relay — OTT→JWT auth flow | ✅ Done | `cargo check` clean |
| Rust relay — WS session loop + Pub/Sub | ✅ Done | `tokio::select!`, 8 unit tests, `player_disconnect` closes WS |
| Java plugin — Paper entry point | ✅ Done | `onLoad` + `onEnable` lifecycle correct |
| Java plugin — `/audio` command | ✅ Done | Virtual thread dispatch, OTT write |
| Java plugin — WorldGuard module | ✅ Done | `FlagValueChangeHandler` on `audio-src` flag |
| Java plugin — Velocity entry point | ✅ Done | `@Plugin` + Cloud v2 + `PlayerEventListener` |
| Java plugin — sealed `AudioEvent` hierarchy | ✅ Done | `RegionEnter`, `AudioPlay`, `AudioStop` |
| Svelte lite client — OTT→WS→JWT | ✅ Done | Stores JWT in `localStorage` |
| Svelte lite client — howler.js playback | ✅ Done | Gesture-first; `npm run build` verified |
| Next.js Pro Portal — shell + auth | ✅ Done | `npm run build` verified |
| Next.js Pro Portal — admin auth (proper) | ⚠️ Placeholder | `ADMIN_SECRET` env var; replace with OAuth |
| Rust relay — `GET /api/sessions` | ✅ Done | `HGETALL audio:sessions`, 4 unit tests |
| Rust relay — REST API + JWT middleware | ✅ Done | `/api/stats`, `/api/sessions`, `GET/PUT /api/settings/:uuid`, `AdminClaims` extractor |
| PostgreSQL — user settings | ✅ Done | `sqlx` runtime API, `Option<PgPool>` — not DB-runtime-verified |
| Velocity — `audio:sessions` hash | ✅ Done | HSET on login/switch, HDEL on disconnect |
| Portal — same-origin relay proxy | ✅ Done | `app/api/relay/[...path]` reads httpOnly cookie, adds Bearer header |
| Portal — Sessions page | ✅ Done | `/sessions` — live table from `GET /api/sessions` (server component) |
| Portal — Regions page | ✅ Done | `/regions` — WG flag reference + honest read-pending-producer notice |
| Portal — Player Settings page | ✅ Done | `/settings` — UUID lookup + GET/PUT form (client component via proxy) |
| Portal — Activity page | ✅ Done | `/events` — live admin WS feed with history replay |
| Portal — Dashboard (live stats) | ✅ Done | Active session count from `GET /api/stats`; relay_nodes/regions honest null |
| Relay — `POST /api/admin/ticket` | ✅ Done | Short-lived (15 s) WS ticket; requires admin JWT |
| Relay — `GET /ws/admin` | ✅ Done | Admin WebSocket; ticket auth; replays `audio:recent-events`, then streams live |
| Portal — `GET /api/admin-ticket` | ✅ Done | Server-side ticket fetch; httpOnly cookie → Bearer → ticket returned to browser |
| Plugin — `audio:recent-events` | ✅ Done | LPUSH + LTRIM(200) on every `publish()` call |
| Relay — `POST /api/auth/login` | ✅ Done | Argon2id credential login; `admin_users` table; blocking thread verify |
| Relay — `migrations/002_admin_users.sql` | ✅ Done | `id UUID`, `username TEXT UNIQUE`, `password_hash TEXT` (Argon2id PHC), `role` |
| Relay — bootstrap seed | ✅ Done | `BOOTSTRAP_USERNAME` + `BOOTSTRAP_PASSWORD` env vars — seeds first admin on startup |
| Portal — login page redesign | ✅ Done | Two-tab: credentials (primary) / ADMIN_SECRET emergency access |
| Relay — `POST /api/auth/player-callback` | ✅ Done | Portal OTT exchange; upserts `players` table; fails closed without DB |
| Relay — `GET /api/player/me` | ✅ Done | Player profile + settings join; `default_client` from Redis |
| Relay — `PUT /api/player/settings` | ✅ Done | Volume/mute to PostgreSQL; `default_client` to Redis only |
| Relay — `PlayerClaims` extractor | ✅ Done | Rejects admin tokens; validates UUID sub |
| Relay — `migrations/003_players.sql` | ✅ Done | uuid, username, first_seen, last_seen |
| Plugin — portal OTT + player pref Redis | ✅ Done | `writePortalOttToken`, `getPlayerDefault`, `setPlayerDefault` |
| Plugin — `/audio` smart default | ✅ Done | Checks `audio:player:pref:<uuid>` in Redis; sends lite or portal link |
| Plugin — `/audio portal`, `/audio lite` | ✅ Done | Force portal or lite client link regardless of saved preference |
| Plugin — `/audio default portal/lite` | ✅ Done | Writes preference to Redis; confirmed in chat |
| Portal — `/auth/callback` | ✅ Done | OTT → player JWT → cookie → redirect to /preferences |
| Portal — `/preferences` | ✅ Done | Volume, mute, default_client; player proxy route |
| Portal — `/auth/player-login` | ✅ Done | Instructions page for unauthenticated player routes |
| Portal — `/auth/error` | ✅ Done | Reason-mapped error page for failed OTT login |
| Portal — proxy player routes | ✅ Done | `as_player_token` cookie guards `/preferences` |

---

## Architecture Decisions (locked)

These are intentional constraints. Don't work around them.

### 1. Relay nodes are stateless
All per-session state lives in Redis. A JWT signed by relay node A must validate
on relay node B. This requires all nodes to share the same `JWT_SECRET` env var.
Per-process random keys break cross-node validation silently.

### 2. GETDEL for OTT validation
The Rust relay uses `GETDEL` (one round-trip, Redis 6.2+) rather than GET+DEL.
This makes token consumption atomic — two racing WebSocket connections cannot
both consume the same token.

### 3. WorldGuard owns region geometry
Regions are not stored in a separate database. WorldGuard is the source of truth
for spatial boundaries. AudioServer adds three custom flags (`audio-src`,
`audio-volume`, `audio-loop`) to existing WG regions. The `FlagValueChangeHandler`
in `AudioSessionHandler.java` drives all audio events — no `PlayerMoveEvent`
polling needed.

### 4. Sealed `AudioEvent` hierarchy
Adding a new event type requires adding it to `AudioEvent permits ...`, creating
the record, adding a case to `RedisManager.publish()`, and updating `docs/events.md`.
The compiler enforces this — no event type can be silently missed.

### 5. Module registry pattern
New integrations (TrainCarts, Hue, WorldGuard) implement `AudioModule` and register
via `ModuleRegistry`. They never touch core plugin logic. WorldGuard registers
automatically on `onEnable` when WG is detected; third-party add-ons register
from their own `onEnable`.

### 6. `audio:events` Pub/Sub channel — scaling note
Currently a single broadcast channel. All relay nodes will subscribe and filter
by `player_id` for their connected players (Phase 2a implementation). At very
large scale (1000+ concurrent), switch to per-player channels
`audio:player:<uuid>` so each relay only processes messages for its own sessions.
The plugin side only needs to change the publish target; relay side subscribes on
WS connect and unsubscribes on close.

---

## Roadmap

### Phase 2a — Core Audio Delivery (do this next)

This completes the full end-to-end loop. Nothing plays sound until both items are done.

**1. Redis Pub/Sub → WebSocket forwarding (`backend/src/ws/handler.rs`)**

The WS session loop in `ws_session()` currently only handles ping/pong.
It needs to:
- After delivering the JWT, subscribe to `audio:events` on Redis using a
  `deadpool-redis` async pubsub connection.
- For each message, deserialize the JSON, check `player_id` matches this session's UUID.
- Deserialize into the correct `RelayMessage` shape (see `portal/lib/ws-types.ts` for the
  TypeScript reference types) and forward as a `Message::Text` to the WebSocket.
- On WS close, drop the subscription.

Architecture sketch:
```rust
// In ws_session(), after sending the JWT:
let mut pubsub = redis_client.get_async_pubsub().await?;
pubsub.subscribe("audio:events").await?;
let mut pubsub_stream = pubsub.into_on_message();

loop {
    tokio::select! {
        Some(Ok(ws_msg)) = socket.recv() => { /* ping/pong, close */ }
        Some(redis_msg) = pubsub_stream.next() => {
            let payload: String = redis_msg.get_payload()?;
            // filter by player_id, forward if match
            let _ = socket.send(Message::Text(forwarded.into())).await;
        }
    }
}
```

**2. howler.js wiring (`client-lite/src/routes/+page.svelte`)**

After receiving `auth_success`, the Svelte client needs to listen for subsequent
WS messages and drive howler:
- `audio_play` → `new Howl({ src, volume, loop }).play()`
- `audio_stop` → stop all active Howls

The `audio_jwt` is already in `localStorage` for any future authenticated API calls.

---

### Phase 2b — Persistence & REST API

Required before any portal feature pages can show live data.

- **PostgreSQL + sqlx** (preferred over diesel for async): user settings schema
  (`player_uuid`, `volume_override`, `audio_enabled`, `updated_at`).
- **REST endpoints on Rust relay**: `GET /api/sessions`, `GET /api/regions`,
  `GET /api/stats`. These are already typed as stubs in `portal/lib/api.ts`.
- **JWT middleware** for protected REST routes (the `jwt::verify` helper in
  `backend/src/auth/jwt.rs` is already written, just not wired to any route).

---

### Phase 2c — Portal Feature Pages

Unblock after Phase 2b REST endpoints exist.

- **`/sessions`** — live player list polled from `GET /api/sessions`.
- **`/regions`** — read WG region audio flags (relayed via Redis or REST).
- **Event log** — admin WebSocket feed (separate from the player WS endpoint;
  relay streams `audio:events` messages to authenticated portal connections).
- **Admin auth replacement** — swap `ADMIN_SECRET` placeholder in
  `portal/lib/auth.ts` for Auth.js, Clerk, or WorkOS.

---

### Phase 3 — Advanced Modules

Long-term; implement as isolated `AudioModule` registrations.

| Module | Notes |
|--------|-------|
| **3D spatial audio** | Plugin pushes player XYZ coords to Redis; relay calculates pan/volume falloff; client uses Web Audio API panner node instead of howler directly. |
| **Philips Hue DTLS** | Hue bridge uses DTLS (CoAP over UDP). Implement as a Rust `AudioModule`-equivalent service that subscribes to `audio:events` and drives Hue Entertainment groups. |
| **TrainCarts module** | Listen to TrainCarts `VehicleEnterEvent` / `VehicleExitEvent`; emit `region_enter` / `region_leave` analogues with train-specific region IDs. |
| **WebRTC voice chat** | Significant scope increase. Requires a TURN/STUN server and a signalling layer on top of the existing WS connection. Treat as a separate planning session. |

---

## Known Issues / Constraints

| Issue | Severity | Workaround / Fix |
|-------|----------|-----------------|
| WorldGuard `FAILED` in Gradle dep tree | Low | Stale Gradle module cache from an earlier failed resolution attempt. Run `./gradlew :paper:compileJava --refresh-dependencies` on first build or clean the `~/.gradle/caches/modules-*/com.sk89q.worldguard/` entry. The `transitive = false` flag means only the WG JAR is needed; the transitive tree error doesn't block compilation. |
| `jwt::verify` exists but is unwired for player WS | Resolved | Wired as `AdminClaims` extractor for all admin REST routes. Player JWT is issued on OTT validation. |
| Portal admin auth is a placeholder | Medium | `ADMIN_SECRET` env-var check in `app/actions/auth.ts`. Fine for internal/local use; replace before any public deployment. |
| Svelte `client-lite` needs `npm install` | Low | Not build-verified (no `npm run build` run). Run in `client-lite/` before deploying. |
| Velocity `VelocityCommandManager` constructor | Low | Cloud 2.0.0-beta.10 constructor signature used; verify if upgrading to a stable Cloud 2.x release — the builder API may have changed. |

---

## Build Reference

```bash
# Rust relay
cd backend && cp .env.example .env   # fill JWT_SECRET, REDIS_URL
cargo run

# Java plugin (Paper)
cd plugin && ./gradlew :paper:shadowJar --refresh-dependencies
# → plugin/paper/build/libs/AudioServerPlugin-1.0.0-SNAPSHOT.jar

# Java plugin (Velocity)
cd plugin && ./gradlew :velocity:shadowJar
# → plugin/velocity/build/libs/...

# Svelte lite client
cd client-lite && npm install && npm run build
# → client-lite/build/  (served by Rust relay ServeDir)

# Next.js Pro Portal
cd portal && cp .env.local.example .env.local   # fill JWT_SECRET, ADMIN_SECRET, NEXT_PUBLIC_BACKEND_URL
npm run dev   # port 3000 — use --port 3001 alongside the relay
npm run build && npm start
```

## Key File Locations

| What you're looking for | File |
|------------------------|------|
| Redis event payload schemas | `docs/events.md` |
| WS session loop (where Pub/Sub forwarding goes) | `backend/src/ws/handler.rs` |
| JWT sign / verify | `backend/src/auth/jwt.rs` |
| WorldGuard flag definitions | `plugin/paper/.../worldguard/AudioFlags.java` |
| WorldGuard session handler | `plugin/paper/.../worldguard/AudioSessionHandler.java` |
| Module registration point | `plugin/paper/.../AudioServerPlugin.java` `onEnable()` |
| Typed API stubs (portal) | `portal/lib/api.ts` |
| TypeScript WS message types | `portal/lib/ws-types.ts` |
| Admin auth placeholder | `portal/lib/auth.ts` + `portal/app/actions/auth.ts` |
