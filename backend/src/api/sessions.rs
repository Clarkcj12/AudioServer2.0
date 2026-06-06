use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use deadpool_redis::redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::warn;

use crate::{auth::extractor::AdminClaims, AppState};

/// Response body for `GET /api/sessions` — matches `PlayerSession` in `portal/lib/api.ts`.
#[derive(Debug, Serialize)]
pub struct PlayerSession {
    pub player_uuid: String,
    pub username: String,
    /// Backend server name, or empty string if not yet assigned.
    pub server: String,
    /// Unix timestamp (seconds) of initial proxy login. See `docs/events.md`.
    pub joined_at: i64,
}

/// Shape stored as a hash value in `audio:sessions`.
/// Hash field = player UUID; value = this JSON.
#[derive(Deserialize)]
struct StoredSession {
    username: String,
    server: String,
    joined_at: i64,
}

/// Parse one `audio:sessions` hash entry into a [`PlayerSession`].
///
/// Returns `None` on malformed JSON or missing fields so the caller can skip
/// without aborting the whole response.
fn parse_entry(player_uuid: String, json: &str) -> Option<PlayerSession> {
    let s: StoredSession = serde_json::from_str(json).ok()?;
    Some(PlayerSession {
        player_uuid,
        username: s.username,
        server: s.server,
        joined_at: s.joined_at,
    })
}

/// `GET /api/sessions` — list all players currently connected to the Velocity proxy.
///
/// Data source: the `audio:sessions` Redis hash written by `PlayerEventListener`.
/// Requires a valid admin JWT in `Authorization: Bearer <token>`.
pub async fn get_sessions(
    AdminClaims(_claims): AdminClaims,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let mut conn = match state.redis.get().await {
        Ok(c) => c,
        Err(e) => {
            warn!(error = %e, "Redis pool error in /api/sessions");
            return (StatusCode::INTERNAL_SERVER_ERROR, "redis error").into_response();
        }
    };

    let raw: HashMap<String, String> = match conn.hgetall("audio:sessions").await {
        Ok(m) => m,
        Err(e) => {
            warn!(error = %e, "HGETALL failed in /api/sessions");
            return (StatusCode::INTERNAL_SERVER_ERROR, "redis error").into_response();
        }
    };

    let sessions: Vec<PlayerSession> = raw
        .into_iter()
        .filter_map(|(uuid, json)| parse_entry(uuid, &json))
        .collect();

    Json(sessions).into_response()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_entry_returns_session() {
        let json = r#"{"username":"Notch","server":"survival","joined_at":1717552800}"#;
        let s = parse_entry("abc-123".into(), json).unwrap();
        assert_eq!(s.player_uuid, "abc-123");
        assert_eq!(s.username, "Notch");
        assert_eq!(s.server, "survival");
        assert_eq!(s.joined_at, 1717552800);
    }

    #[test]
    fn parse_malformed_json_returns_none() {
        assert!(parse_entry("abc-123".into(), "not json").is_none());
    }

    #[test]
    fn parse_missing_field_returns_none() {
        // `joined_at` is absent
        let json = r#"{"username":"Notch","server":"survival"}"#;
        assert!(parse_entry("abc-123".into(), json).is_none());
    }

    #[test]
    fn parse_empty_server_is_valid() {
        // Empty server = logged in but not yet assigned to a backend
        let json = r#"{"username":"Steve","server":"","joined_at":1717552900}"#;
        let s = parse_entry("xyz".into(), json).unwrap();
        assert_eq!(s.server, "");
    }
}
