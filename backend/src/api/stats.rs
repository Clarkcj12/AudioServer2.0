use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use deadpool_redis::redis::AsyncCommands;
use serde::Serialize;
use tracing::warn;

use crate::{auth::extractor::AdminClaims, AppState};

/// Redis hash that maps player UUID → session JSON.
/// Written by the Velocity `PlayerEventListener`; read here for the count.
pub const SESSIONS_KEY: &str = "audio:sessions";

/// Response body for `GET /api/stats`.
#[derive(Serialize)]
pub struct DashboardStats {
    /// Count of players currently connected to the proxy (from `HLEN audio:sessions`).
    active_sessions: u64,
    /// Always `null` in Phase 2b — no per-node heartbeat tracking implemented yet.
    relay_nodes: Option<u64>,
    /// Always `null` in Phase 2b — WorldGuard regions are not mirrored to the relay.
    regions: Option<u64>,
}

/// `GET /api/stats` — dashboard aggregate counts.
///
/// Requires a valid admin JWT in `Authorization: Bearer <token>`.
pub async fn get_stats(
    AdminClaims(_claims): AdminClaims,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let mut conn = match state.redis.get().await {
        Ok(c) => c,
        Err(e) => {
            warn!(error = %e, "Redis pool error in /api/stats");
            return (StatusCode::INTERNAL_SERVER_ERROR, "redis error").into_response();
        }
    };

    let active_sessions: u64 = conn
        .hlen(SESSIONS_KEY)
        .await
        .unwrap_or(0);

    Json(DashboardStats {
        active_sessions,
        relay_nodes: None,
        regions: None,
    })
    .into_response()
}
