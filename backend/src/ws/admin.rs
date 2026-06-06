use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
};
use futures_util::StreamExt;
use std::collections::HashMap;
use tracing::{info, warn};

use crate::{auth::admin_ticket, AppState};

const AUDIO_EVENTS_CHANNEL: &str = "audio:events";
const RECENT_EVENTS_KEY: &str = "audio:recent-events";

/// Axum handler for `GET /ws/admin?ticket=<ott>`.
///
/// Admin WebSocket — streams every `audio:events` message to the connected
/// portal client without any player-id filter.  Auth uses a short-lived ticket
/// (not the httpOnly cookie — the browser WS API cannot send cookies as headers).
pub async fn admin_ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let ticket = match params.get("ticket").cloned() {
        Some(t) if !t.is_empty() => t,
        _ => return (StatusCode::BAD_REQUEST, "missing `ticket` query parameter").into_response(),
    };

    let valid = match admin_ticket::validate(&state.redis, &ticket).await {
        Ok(v) => v,
        Err(e) => {
            warn!(error = %e, "Redis error during admin ticket validation");
            return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
        }
    };

    if !valid {
        warn!(ticket = %ticket, "rejected invalid or expired admin ticket");
        return (StatusCode::UNAUTHORIZED, "invalid or expired ticket").into_response();
    }

    info!("admin ticket validated — upgrading to admin WebSocket");
    ws.on_upgrade(move |socket| admin_ws_session(socket, state))
        .into_response()
}

async fn admin_ws_session(mut socket: WebSocket, state: AppState) {
    // ── 1. Replay recent events (LPUSH = newest-first; reverse for chronological order) ──
    if let Ok(mut conn) = state.redis.get().await {
        let result: Result<Vec<String>, _> = deadpool_redis::redis::cmd("LRANGE")
            .arg(RECENT_EVENTS_KEY)
            .arg(0i64)
            .arg(-1i64)
            .query_async(&mut *conn)
            .await;

        if let Ok(mut history) = result {
            history.reverse(); // oldest first
            for event_json in history {
                if socket.send(Message::Text(event_json.into())).await.is_err() {
                    return;
                }
            }
        }
    }

    // Sentinel — client can insert a "--- live ---" separator after this
    if socket
        .send(Message::Text(
            r#"{"type":"__history_end__"}"#.to_string().into(),
        ))
        .await
        .is_err()
    {
        return;
    }

    // ── 2. Open dedicated Pub/Sub connection ───────────────────────────────
    let mut pubsub = match state.redis_client.get_async_pubsub().await {
        Ok(ps) => ps,
        Err(e) => {
            warn!(error = %e, "admin WS: failed to open Pub/Sub connection");
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };

    if let Err(e) = pubsub.subscribe(AUDIO_EVENTS_CHANNEL).await {
        warn!(error = %e, "admin WS: failed to subscribe to audio:events");
        let _ = socket.send(Message::Close(None)).await;
        return;
    }

    info!("admin session established, subscribed to {AUDIO_EVENTS_CHANNEL}");

    // ── 3. Select loop — forward every event without player-id filtering ───
    let msg_stream = pubsub.into_on_message();
    tokio::pin!(msg_stream);

    loop {
        tokio::select! {
            ws_result = socket.recv() => {
                match ws_result {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    Some(Err(e)) => {
                        warn!(error = %e, "admin WS receive error");
                        break;
                    }
                    _ => {}
                }
            }

            redis_result = msg_stream.next() => {
                let Some(msg) = redis_result else {
                    warn!("admin WS: Redis Pub/Sub stream closed unexpectedly");
                    break;
                };

                let Ok(payload) = msg.get_payload::<String>() else {
                    continue;
                };

                if socket.send(Message::Text(payload.into())).await.is_err() {
                    break;
                }
            }
        }
    }

    info!("admin WS session closed");
}
