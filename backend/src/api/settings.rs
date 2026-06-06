use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::{auth::extractor::AdminClaims, AppState};

/// Per-player audio preferences stored in PostgreSQL.
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserSettings {
    pub player_uuid: String,
    /// Client-side volume multiplier applied on top of the region's `audio-volume` flag.
    pub volume_override: f64,
    /// Master mute toggle — `false` means the player will not hear any audio.
    pub audio_enabled: bool,
    pub updated_at: DateTime<Utc>,
}

/// Body accepted by `PUT /api/settings/:uuid`.
/// All fields are optional; omitted fields keep their current values.
#[derive(Debug, Deserialize)]
pub struct SettingsUpdate {
    pub volume_override: Option<f64>,
    pub audio_enabled: Option<bool>,
}

/// `GET /api/settings/:uuid` — retrieve a player's audio preferences.
///
/// Returns default values (volume 1.0, enabled true) if no record exists yet.
pub async fn get_settings(
    AdminClaims(_claims): AdminClaims,
    State(state): State<AppState>,
    Path(player_uuid): Path<String>,
) -> impl IntoResponse {
    let pool = match state.db.as_ref() {
        Some(p) => p,
        None => return (StatusCode::SERVICE_UNAVAILABLE, "database not configured").into_response(),
    };

    let row = sqlx::query_as::<_, UserSettings>(
        "SELECT player_uuid, volume_override, audio_enabled, updated_at \
         FROM user_settings WHERE player_uuid = $1",
    )
    .bind(&player_uuid)
    .fetch_optional(pool)
    .await;

    match row {
        Ok(Some(s)) => Json(s).into_response(),
        Ok(None) => Json(UserSettings {
            player_uuid,
            volume_override: 1.0,
            audio_enabled: true,
            updated_at: Utc::now(),
        })
        .into_response(),
        Err(e) => {
            warn!(error = %e, "DB error in GET /api/settings");
            (StatusCode::INTERNAL_SERVER_ERROR, "database error").into_response()
        }
    }
}

/// `PUT /api/settings/:uuid` — upsert a player's audio preferences.
///
/// Uses `ON CONFLICT … DO UPDATE` so the call is idempotent.
/// Omitted fields in the request body are preserved from the existing row.
pub async fn put_settings(
    AdminClaims(_claims): AdminClaims,
    State(state): State<AppState>,
    Path(player_uuid): Path<String>,
    Json(body): Json<SettingsUpdate>,
) -> impl IntoResponse {
    let pool = match state.db.as_ref() {
        Some(p) => p,
        None => return (StatusCode::SERVICE_UNAVAILABLE, "database not configured").into_response(),
    };

    let row = sqlx::query_as::<_, UserSettings>(
        "INSERT INTO user_settings (player_uuid, volume_override, audio_enabled, updated_at)
         VALUES ($1, COALESCE($2, 1.0), COALESCE($3, TRUE), NOW())
         ON CONFLICT (player_uuid) DO UPDATE
           SET volume_override = COALESCE($2, user_settings.volume_override),
               audio_enabled   = COALESCE($3, user_settings.audio_enabled),
               updated_at      = NOW()
         RETURNING player_uuid, volume_override, audio_enabled, updated_at",
    )
    .bind(&player_uuid)
    .bind(body.volume_override)
    .bind(body.audio_enabled)
    .fetch_one(pool)
    .await;

    match row {
        Ok(s) => (StatusCode::OK, Json(s)).into_response(),
        Err(e) => {
            warn!(error = %e, "DB error in PUT /api/settings");
            (StatusCode::INTERNAL_SERVER_ERROR, "database error").into_response()
        }
    }
}
