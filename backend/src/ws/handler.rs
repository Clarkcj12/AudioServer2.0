use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
};
use futures_util::StreamExt;
use serde_json::json;
use std::collections::HashMap;
use tracing::{info, warn};

use crate::{
    auth::{jwt, ott},
    AppState,
};

/// Redis channel that the Java plugin publishes all in-game audio events to.
/// See `docs/events.md` for the full payload contract.
///
/// Scaling note: all relay nodes subscribe to this single channel and filter by
/// `player_id`.  For large deployments, migrate to per-player channels
/// `audio:player:<uuid>` so each node only processes messages for its own sessions.
const AUDIO_EVENTS_CHANNEL: &str = "audio:events";

// ---------------------------------------------------------------------------
// Upgrade handler
// ---------------------------------------------------------------------------

/// Axum handler for `GET /ws?token=<ott>`.
///
/// Auth is validated before the WebSocket upgrade so that rejected requests
/// receive a plain HTTP status code (401/400) instead of a WS close frame.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let token = match params.get("token").cloned() {
        Some(t) if !t.is_empty() => t,
        _ => return (StatusCode::BAD_REQUEST, "missing `token` query parameter").into_response(),
    };

    let player_uuid = match ott::validate(&state.redis, &token).await {
        Ok(Some(uuid)) => uuid,
        Ok(None) => {
            warn!(token = %token, "rejected expired or unknown OTT");
            return (StatusCode::UNAUTHORIZED, "invalid or expired token").into_response();
        }
        Err(e) => {
            warn!(error = %e, "Redis error during OTT validation");
            return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
        }
    };

    let signed_jwt = match jwt::sign(&state.config, player_uuid) {
        Ok(j) => j,
        Err(e) => {
            warn!(error = %e, "JWT signing failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
        }
    };

    info!(player = %player_uuid, "OTT validated — upgrading to WebSocket");

    ws.on_upgrade(move |socket| ws_session(socket, player_uuid.to_string(), signed_jwt, state))
        .into_response()
}

// ---------------------------------------------------------------------------
// Session loop
// ---------------------------------------------------------------------------

/// Long-lived WebSocket session for an authenticated player.
///
/// Runs a `tokio::select!` loop over two sources:
/// - Inbound WebSocket frames from the browser (ping/pong, close).
/// - Inbound Redis Pub/Sub messages from `audio:events`, forwarded to the
///   browser after filtering and translating the payload shape.
async fn ws_session(
    mut socket: WebSocket,
    player_uuid: String,
    signed_jwt: String,
    state: AppState,
) {
    // ── 1. Deliver the JWT ──────────────────────────────────────────────────
    let auth_msg = json!({
        "type":        "auth_success",
        "jwt":         signed_jwt,
        "player_uuid": player_uuid,
    })
    .to_string();

    if socket.send(Message::Text(auth_msg.into())).await.is_err() {
        return; // client already disconnected
    }

    // ── 2. Open a dedicated Pub/Sub connection ──────────────────────────────
    // Pub/Sub connections are stateful — a subscribed connection cannot be used
    // for regular commands and cannot be returned to the pool.  We create one
    // directly from the bare client instead.
    let mut pubsub = match state.redis_client.get_async_pubsub().await {
        Ok(ps) => ps,
        Err(e) => {
            warn!(player = %player_uuid, error = %e, "failed to open Pub/Sub connection");
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };

    if let Err(e) = pubsub.subscribe(AUDIO_EVENTS_CHANNEL).await {
        warn!(player = %player_uuid, error = %e, "failed to subscribe to audio:events");
        let _ = socket.send(Message::Close(None)).await;
        return;
    }

    info!(player = %player_uuid, "session established, subscribed to {AUDIO_EVENTS_CHANNEL}");

    // ── 3. Select loop ──────────────────────────────────────────────────────
    let msg_stream = pubsub.into_on_message();
    // `into_on_message()` returns a type that may not be Unpin; pin it on the
    // stack so `select!` can poll it without requiring a heap allocation.
    tokio::pin!(msg_stream);

    loop {
        tokio::select! {
            // ── Inbound WebSocket frame ──────────────────────────────────────
            ws_result = socket.recv() => {
                match ws_result {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    Some(Err(e)) => {
                        warn!(player = %player_uuid, error = %e, "WS receive error");
                        break;
                    }
                    _ => {} // Text/Binary frames from client — not expected in Phase 1
                }
            }

            // ── Inbound Redis Pub/Sub message ────────────────────────────────
            redis_result = msg_stream.next() => {
                let Some(msg) = redis_result else {
                    warn!(player = %player_uuid, "Redis Pub/Sub stream closed unexpectedly");
                    break;
                };

                let Ok(payload) = msg.get_payload::<String>() else {
                    continue; // malformed message — skip silently
                };

                match translate_event(&payload, &player_uuid) {
                    Some(SessionAction::Forward(json)) => {
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    Some(SessionAction::Close) => {
                        info!(player = %player_uuid, "proxy disconnect received — closing WS");
                        let _ = socket.send(Message::Close(None)).await;
                        break;
                    }
                    None => {} // wrong player or infrastructure event — drop
                }
            }
        }
    }

    // Dropping `msg_stream` here unsubscribes from Redis and closes the
    // underlying TCP connection automatically.
    info!(player = %player_uuid, "session closed");
}

// ---------------------------------------------------------------------------
// Event translation
// ---------------------------------------------------------------------------

/// Outcome of processing one Redis Pub/Sub message for a given WS session.
#[derive(Debug)]
enum SessionAction {
    /// Forward this JSON string to the WebSocket client.
    Forward(String),
    /// The player has disconnected from the proxy; close the WebSocket.
    Close,
}

/// Decide what to do with one `audio:events` Redis message for a specific player.
///
/// Returns `None` if the message should be silently dropped (different player,
/// infrastructure event that clients don't need, or malformed JSON).
///
/// Translation applied to forwarded messages (per `docs/events.md`):
/// - `"event"` field → renamed to `"type"` (WebSocket messages use `type`, Redis uses `event`)
/// - `"player_id"` field → removed (the client owns this connection; no need to echo it back)
/// - All other fields are preserved as-is.
fn translate_event(payload: &str, player_uuid: &str) -> Option<SessionAction> {
    let mut v: serde_json::Value = serde_json::from_str(payload).ok()?;
    let obj = v.as_object_mut()?;

    // Drop messages addressed to a different player
    let pid = obj.get("player_id")?.as_str()?.to_owned();
    if pid != player_uuid {
        return None;
    }

    let event_type = obj.get("event")?.as_str()?.to_owned();

    match event_type.as_str() {
        "player_disconnect" => Some(SessionAction::Close),

        "audio_play" | "audio_stop" => {
            obj.remove("event");
            obj.remove("player_id");
            obj.insert("type".to_owned(), serde_json::Value::String(event_type));
            Some(SessionAction::Forward(v.to_string()))
        }

        // region_enter, player_connect, server_switch — consumed by the relay
        // in Phase 2b session management; do not forward to browser clients.
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_play_for_this_player_forwards_with_correct_shape() {
        let payload = r#"{"event":"audio_play","player_id":"abc-123","src":"https://cdn.example.com/a.ogg","volume":0.8,"loop":true}"#;
        match translate_event(payload, "abc-123") {
            Some(SessionAction::Forward(json)) => {
                let v: serde_json::Value = serde_json::from_str(&json).unwrap();
                assert_eq!(v["type"], "audio_play", "event must be renamed to type");
                assert_eq!(v["src"], "https://cdn.example.com/a.ogg");
                assert_eq!(v["volume"], 0.8);
                assert_eq!(v["loop"], true);
                assert!(v.get("player_id").is_none(), "player_id must be stripped");
                assert!(v.get("event").is_none(), "event field must be removed");
            }
            other => panic!("expected Forward, got {other:?}"),
        }
    }

    #[test]
    fn audio_play_for_different_player_is_dropped() {
        let payload = r#"{"event":"audio_play","player_id":"other-uuid","src":"a.ogg","volume":1.0,"loop":false}"#;
        assert!(translate_event(payload, "my-uuid").is_none());
    }

    #[test]
    fn audio_stop_translates_correctly() {
        let payload = r#"{"event":"audio_stop","player_id":"abc-123"}"#;
        match translate_event(payload, "abc-123") {
            Some(SessionAction::Forward(json)) => {
                let v: serde_json::Value = serde_json::from_str(&json).unwrap();
                assert_eq!(v["type"], "audio_stop");
                assert!(v.get("player_id").is_none());
                assert!(v.get("event").is_none());
            }
            other => panic!("expected Forward, got {other:?}"),
        }
    }

    #[test]
    fn player_disconnect_triggers_session_close() {
        let payload = r#"{"event":"player_disconnect","player_id":"abc-123"}"#;
        assert!(matches!(
            translate_event(payload, "abc-123"),
            Some(SessionAction::Close)
        ));
    }

    #[test]
    fn infrastructure_event_player_connect_is_dropped() {
        let payload = r#"{"event":"player_connect","player_id":"abc-123","username":"Notch"}"#;
        assert!(translate_event(payload, "abc-123").is_none());
    }

    #[test]
    fn infrastructure_event_server_switch_is_dropped() {
        let payload = r#"{"event":"server_switch","player_id":"abc-123","server":"survival"}"#;
        assert!(translate_event(payload, "abc-123").is_none());
    }

    #[test]
    fn malformed_json_is_dropped() {
        assert!(translate_event("not json", "abc-123").is_none());
    }

    #[test]
    fn missing_player_id_field_is_dropped() {
        let payload = r#"{"event":"audio_play","src":"a.ogg"}"#;
        assert!(translate_event(payload, "abc-123").is_none());
    }
}
