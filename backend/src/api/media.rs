use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use uuid::Uuid;

use crate::{auth::extractor::AdminClaims, AppState};

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/// A row from the `audio_media` table, with a presigned GET URL appended.
/// Returned by list and confirm endpoints.
#[derive(sqlx::FromRow, Serialize)]
pub struct AudioMediaItem {
    pub id: String,
    pub object_key: String,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: Option<i64>,
    pub duration_seconds: Option<f32>,
    pub uploaded_by: String,
    pub created_at: DateTime<Utc>,
    /// Presigned GET URL (1-hour TTL). Generated at query time — not stored in DB.
    #[sqlx(skip)]
    pub url: String,
}

/// Stored in Redis at `audio:media:pending:<object_key>` until confirm.
#[derive(Serialize, Deserialize)]
struct PendingUpload {
    filename: String,
    content_type: String,
    uploaded_by: String,
}

// ---------------------------------------------------------------------------
// POST /api/admin/media/upload-url — issue a presigned PUT URL
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct UploadUrlRequest {
    filename: String,
    content_type: String,
}

#[derive(Serialize)]
struct UploadUrlResponse {
    /// Presigned PUT URL — browser PUTs the file bytes here directly.
    upload_url: String,
    /// Server-generated key to pass back in the confirm step.
    object_key: String,
}

pub async fn request_upload_url(
    AdminClaims(claims): AdminClaims,
    State(state): State<AppState>,
    Json(body): Json<UploadUrlRequest>,
) -> impl IntoResponse {
    if !body.content_type.starts_with("audio/") {
        return (StatusCode::BAD_REQUEST, "content_type must be audio/*").into_response();
    }

    let Some(storage) = &state.storage else {
        return (StatusCode::SERVICE_UNAVAILABLE, "storage not configured — set S3_* env vars").into_response();
    };

    let safe_name = sanitize_filename(&body.filename);
    let id = Uuid::new_v4();
    let object_key = format!("media/{}/{}", id, safe_name);

    let upload_url = storage.presign_put(&object_key);

    // Store pending metadata in Redis (SETEX 1 h).  GETDEL on confirm makes
    // this single-use so double-confirms can't create duplicate DB rows.
    let pending = PendingUpload {
        filename: body.filename.clone(),
        content_type: body.content_type.clone(),
        uploaded_by: claims.sub.clone(),
    };
    let pending_key = format!("audio:media:pending:{}", object_key);
    match serde_json::to_string(&pending) {
        Ok(value) => {
            if let Ok(mut conn) = state.redis.get().await {
                let _ = deadpool_redis::redis::cmd("SETEX")
                    .arg(&pending_key)
                    .arg(3600i64)
                    .arg(&value)
                    .query_async::<()>(&mut *conn)
                    .await;
            }
        }
        Err(e) => {
            warn!(error = %e, "Failed to serialise pending upload metadata");
            return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
        }
    }

    info!(admin = %claims.sub, key = %object_key, "upload URL issued");
    Json(UploadUrlResponse { upload_url, object_key }).into_response()
}

// ---------------------------------------------------------------------------
// POST /api/admin/media/confirm — confirm upload, insert DB row
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ConfirmUploadRequest {
    object_key: String,
    /// Optional — client-reported via File.size; used for display only.
    size_bytes: Option<i64>,
    /// Optional — client-reported (e.g. from Web Audio API decode).
    duration_seconds: Option<f32>,
}

pub async fn confirm_upload(
    AdminClaims(_claims): AdminClaims,
    State(state): State<AppState>,
    Json(body): Json<ConfirmUploadRequest>,
) -> impl IntoResponse {
    let Some(db) = &state.db else {
        return (StatusCode::SERVICE_UNAVAILABLE, "database not configured").into_response();
    };
    let Some(storage) = &state.storage else {
        return (StatusCode::SERVICE_UNAVAILABLE, "storage not configured").into_response();
    };

    // Atomic fetch-and-delete: ensures the key was server-issued and prevents
    // double-confirm races.
    let pending_key = format!("audio:media:pending:{}", body.object_key);
    let pending_json: Option<String> = match state.redis.get().await {
        Ok(mut conn) => deadpool_redis::redis::cmd("GETDEL")
            .arg(&pending_key)
            .query_async::<Option<String>>(&mut *conn)
            .await
            .ok()
            .flatten(),
        Err(e) => {
            warn!(error = %e, "Redis error during upload confirm");
            return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
        }
    };

    let Some(json) = pending_json else {
        return (StatusCode::BAD_REQUEST, "unknown or expired upload key").into_response();
    };

    let pending: PendingUpload = match serde_json::from_str(&json) {
        Ok(p) => p,
        Err(e) => {
            warn!(error = %e, "Failed to deserialise pending upload");
            return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
        }
    };

    let media_id = Uuid::new_v4().to_string();

    let row = sqlx::query_as::<_, AudioMediaItem>(
        "INSERT INTO audio_media (id, object_key, filename, content_type, size_bytes, duration_seconds, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, object_key, filename, content_type, size_bytes, duration_seconds, uploaded_by, created_at",
    )
    .bind(&media_id)
    .bind(&body.object_key)
    .bind(&pending.filename)
    .bind(&pending.content_type)
    .bind(body.size_bytes)
    .bind(body.duration_seconds)
    .bind(&pending.uploaded_by)
    .fetch_one(db)
    .await;

    match row {
        Ok(mut item) => {
            item.url = storage.presign_get(&item.object_key);
            info!(admin = %pending.uploaded_by, id = %media_id, file = %pending.filename, "media confirmed");
            Json(item).into_response()
        }
        Err(e) => {
            warn!(error = %e, "DB error inserting audio_media");
            (StatusCode::INTERNAL_SERVER_ERROR, "database error").into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// GET /api/admin/media — list all media
// ---------------------------------------------------------------------------

pub async fn list_media(
    AdminClaims(_): AdminClaims,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let Some(db) = &state.db else {
        return (StatusCode::SERVICE_UNAVAILABLE, "database not configured").into_response();
    };
    let Some(storage) = &state.storage else {
        return (StatusCode::SERVICE_UNAVAILABLE, "storage not configured").into_response();
    };

    let rows = sqlx::query_as::<_, AudioMediaItem>(
        "SELECT id, object_key, filename, content_type, size_bytes, duration_seconds, uploaded_by, created_at
         FROM audio_media
         ORDER BY created_at DESC",
    )
    .fetch_all(db)
    .await;

    match rows {
        Ok(mut items) => {
            for item in &mut items {
                item.url = storage.presign_get(&item.object_key);
            }
            Json(items).into_response()
        }
        Err(e) => {
            warn!(error = %e, "DB error listing audio_media");
            (StatusCode::INTERNAL_SERVER_ERROR, "database error").into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/media/:id — remove from DB and S3
// ---------------------------------------------------------------------------

pub async fn delete_media(
    AdminClaims(claims): AdminClaims,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(db) = &state.db else {
        return (StatusCode::SERVICE_UNAVAILABLE, "database not configured").into_response();
    };
    let Some(storage) = &state.storage else {
        return (StatusCode::SERVICE_UNAVAILABLE, "storage not configured").into_response();
    };

    // Fetch the row so we have the object_key for S3 deletion.
    let row = sqlx::query_as::<_, AudioMediaItem>(
        "SELECT id, object_key, filename, content_type, size_bytes, duration_seconds, uploaded_by, created_at
         FROM audio_media WHERE id = $1",
    )
    .bind(&id)
    .fetch_optional(db)
    .await;

    let item = match row {
        Ok(Some(r)) => r,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            warn!(error = %e, "DB error looking up media for delete");
            return (StatusCode::INTERNAL_SERVER_ERROR, "database error").into_response();
        }
    };

    // Delete from S3 first; if it fails we haven't touched the DB yet.
    if let Err(e) = storage.delete_object(&item.object_key).await {
        warn!(error = %e, key = %item.object_key, "S3 delete failed");
        return (StatusCode::INTERNAL_SERVER_ERROR, "failed to delete from storage").into_response();
    }

    if let Err(e) = sqlx::query("DELETE FROM audio_media WHERE id = $1")
        .bind(&id)
        .execute(db)
        .await
    {
        warn!(error = %e, "DB error deleting audio_media row");
        return (StatusCode::INTERNAL_SERVER_ERROR, "database error").into_response();
    }

    info!(admin = %claims.sub, id = %id, file = %item.filename, "media deleted");
    StatusCode::NO_CONTENT.into_response()
}

// ---------------------------------------------------------------------------
// GET /media/:id — public permalink, 302 → fresh presigned GET URL
// ---------------------------------------------------------------------------

pub async fn media_permalink(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(db) = &state.db else {
        return (StatusCode::SERVICE_UNAVAILABLE, "database not configured").into_response();
    };
    let Some(storage) = &state.storage else {
        return (StatusCode::SERVICE_UNAVAILABLE, "storage not configured").into_response();
    };

    let row = sqlx::query_scalar::<_, String>("SELECT object_key FROM audio_media WHERE id = $1")
        .bind(&id)
        .fetch_optional(db)
        .await;

    match row {
        Ok(Some(object_key)) => {
            let presigned = storage.presign_get(&object_key);
            (StatusCode::FOUND, [("Location", presigned)]).into_response()
        }
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            warn!(error = %e, "DB error in media permalink");
            (StatusCode::INTERNAL_SERVER_ERROR, "database error").into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Strip path separators and control chars; replace everything non-safe with `_`.
/// Preserves the file extension and keeps the name under 200 chars.
fn sanitize_filename(name: &str) -> String {
    let base = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
        .collect::<String>();

    // Trim leading dots/dashes and cap length
    let base = base.trim_start_matches(['.', '-', '_']);
    let base = if base.len() > 200 { &base[..200] } else { base };
    if base.is_empty() { "file".to_owned() } else { base.to_owned() }
}
