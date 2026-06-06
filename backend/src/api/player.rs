use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::{
    auth::{extractor::PlayerClaims, jwt, player_ott},
    AppState,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct PlayerCallbackRequest {
    token: String,
}

#[derive(Serialize)]
struct PlayerCallbackResponse {
    jwt: String,
}

/// Row from `players LEFT JOIN user_settings`.
#[derive(sqlx::FromRow)]
struct PlayerRow {
    uuid: String,
    username: String,
    first_seen: DateTime<Utc>,
    last_seen: DateTime<Utc>,
    volume_override: f64,
    audio_enabled: bool,
}

#[derive(Serialize)]
pub struct PlayerProfileResponse {
    uuid: String,
    username: String,
    first_seen: DateTime<Utc>,
    last_seen: DateTime<Utc>,
    volume_override: f64,
    audio_enabled: bool,
    /// Sourced from Redis key `audio:player:pref:<uuid>`. Defaults to `"lite"`.
    default_client: String,
}

#[derive(Deserialize)]
pub struct PlayerSettingsUpdate {
    pub volume_override: Option<f64>,
    pub audio_enabled: Option<bool>,
    /// Must be `"lite"` or `"portal"`. Written to Redis only.
    pub default_client: Option<String>,
}

#[derive(sqlx::FromRow, Serialize)]
struct UserSettingsRow {
    player_uuid: String,
    volume_override: f64,
    audio_enabled: bool,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct PlayerSettingsResponse {
    player_uuid: String,
    volume_override: f64,
    audio_enabled: bool,
    default_client: String,
    updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// `POST /api/auth/player-callback` — unauthenticated portal OTT exchange.
///
/// Validates the portal OTT, upserts the player into the `players` table,
/// and issues a player JWT.  Fails closed — requires the database.
pub async fn player_callback(
    State(state): State<AppState>,
    Json(body): Json<PlayerCallbackRequest>,
) -> impl IntoResponse {
    let Some(db) = &state.db else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "player portal requires the database — DATABASE_URL not configured",
        )
            .into_response();
    };

    let ott = match player_ott::validate(&state.redis, &body.token).await {
        Ok(Some(o)) => o,
        Ok(None) => return (StatusCode::UNAUTHORIZED, "invalid or expired token").into_response(),
        Err(e) => {
            warn!(error = %e, "Redis error during player portal OTT validation");
            return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
        }
    };

    // Upsert players table — fail closed so the portal always has a record.
    if let Err(e) = sqlx::query(
        "INSERT INTO players (uuid, username, first_seen, last_seen)
         VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (uuid) DO UPDATE SET username = $2, last_seen = NOW()",
    )
    .bind(&ott.player_uuid.to_string())
    .bind(&ott.username)
    .execute(db)
    .await
    {
        warn!(error = %e, player = %ott.player_uuid, "Failed to upsert player on portal login");
        return (StatusCode::INTERNAL_SERVER_ERROR, "database error").into_response();
    }

    match jwt::sign(&state.config, ott.player_uuid) {
        Ok(token) => {
            info!(player = %ott.player_uuid, username = %ott.username, "player portal login");
            Json(PlayerCallbackResponse { jwt: token }).into_response()
        }
        Err(e) => {
            warn!(error = %e, "JWT signing failed during player callback");
            (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
        }
    }
}

/// `GET /api/player/me` — player profile + audio settings.
pub async fn get_me(
    PlayerClaims(claims): PlayerClaims,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let Some(db) = &state.db else {
        return (StatusCode::SERVICE_UNAVAILABLE, "database not configured").into_response();
    };

    let row = sqlx::query_as::<_, PlayerRow>(
        "SELECT p.uuid, p.username, p.first_seen, p.last_seen,
                COALESCE(s.volume_override, 1.0) AS volume_override,
                COALESCE(s.audio_enabled,   TRUE) AS audio_enabled
         FROM players p
         LEFT JOIN user_settings s ON s.player_uuid = p.uuid
         WHERE p.uuid = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(db)
    .await;

    let player = match row {
        Ok(Some(r)) => r,
        Ok(None) => PlayerRow {
            uuid:            claims.sub.clone(),
            username:        String::new(),
            first_seen:      Utc::now(),
            last_seen:       Utc::now(),
            volume_override: 1.0,
            audio_enabled:   true,
        },
        Err(e) => {
            warn!(error = %e, "DB error in GET /api/player/me");
            return (StatusCode::INTERNAL_SERVER_ERROR, "database error").into_response();
        }
    };

    let default_client = redis_get_default(&state, &claims.sub).await;

    Json(PlayerProfileResponse {
        uuid:            player.uuid,
        username:        player.username,
        first_seen:      player.first_seen,
        last_seen:       player.last_seen,
        volume_override: player.volume_override,
        audio_enabled:   player.audio_enabled,
        default_client,
    })
    .into_response()
}

/// `PUT /api/player/settings` — update volume, mute toggle, and default client.
///
/// `volume_override` and `audio_enabled` are written to PostgreSQL.
/// `default_client` is written to Redis only (`audio:player:pref:<uuid>`).
pub async fn put_player_settings(
    PlayerClaims(claims): PlayerClaims,
    State(state): State<AppState>,
    Json(body): Json<PlayerSettingsUpdate>,
) -> impl IntoResponse {
    let Some(db) = &state.db else {
        return (StatusCode::SERVICE_UNAVAILABLE, "database not configured").into_response();
    };

    // Validate default_client before touching any store
    if let Some(ref dc) = body.default_client {
        if dc != "lite" && dc != "portal" {
            return (StatusCode::BAD_REQUEST, "default_client must be \"lite\" or \"portal\"")
                .into_response();
        }
    }

    // Write volume/enabled to PostgreSQL
    let row = sqlx::query_as::<_, UserSettingsRow>(
        "INSERT INTO user_settings (player_uuid, volume_override, audio_enabled, updated_at)
         VALUES ($1, COALESCE($2, 1.0), COALESCE($3, TRUE), NOW())
         ON CONFLICT (player_uuid) DO UPDATE
           SET volume_override = COALESCE($2, user_settings.volume_override),
               audio_enabled   = COALESCE($3, user_settings.audio_enabled),
               updated_at      = NOW()
         RETURNING player_uuid, volume_override, audio_enabled, updated_at",
    )
    .bind(&claims.sub)
    .bind(body.volume_override)
    .bind(body.audio_enabled)
    .fetch_one(db)
    .await;

    let settings = match row {
        Ok(r) => r,
        Err(e) => {
            warn!(error = %e, "DB error in PUT /api/player/settings");
            return (StatusCode::INTERNAL_SERVER_ERROR, "database error").into_response();
        }
    };

    // Write default_client to Redis if provided
    if let Some(ref dc) = body.default_client {
        let key = format!("audio:player:pref:{}", claims.sub);
        if let Ok(mut conn) = state.redis.get().await {
            let _ = deadpool_redis::redis::cmd("SET")
                .arg(&key)
                .arg(dc.as_str())
                .query_async::<()>(&mut *conn)
                .await;
        }
    }

    let default_client = redis_get_default(&state, &claims.sub).await;

    Json(PlayerSettingsResponse {
        player_uuid:     settings.player_uuid,
        volume_override: settings.volume_override,
        audio_enabled:   settings.audio_enabled,
        default_client,
        updated_at:      settings.updated_at,
    })
    .into_response()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn redis_get_default(state: &AppState, player_uuid: &str) -> String {
    let key = format!("audio:player:pref:{player_uuid}");
    match state.redis.get().await {
        Ok(mut conn) => deadpool_redis::redis::cmd("GET")
            .arg(&key)
            .query_async::<Option<String>>(&mut *conn)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| "lite".to_owned()),
        Err(_) => "lite".to_owned(),
    }
}
