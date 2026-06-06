use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use uuid::Uuid;

use crate::{auth::{admin_login_ott, jwt}, AppState};

// ---------------------------------------------------------------------------
// Login handler
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct LoginResponse {
    jwt: String,
}

#[derive(sqlx::FromRow)]
struct AdminUserRow {
    id: Uuid,
    password_hash: String,
}

/// `POST /api/auth/login` — unauthenticated credential login.
///
/// Verifies `username` + `password` against the `admin_users` table using
/// Argon2id.  Returns a signed admin JWT on success.
///
/// Password verification runs on a Tokio blocking thread so the async runtime
/// is not stalled by the intentionally expensive Argon2id computation.
pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> impl IntoResponse {
    let Some(db) = &state.db else {
        return (StatusCode::SERVICE_UNAVAILABLE, "database not configured").into_response();
    };

    let user = match sqlx::query_as::<_, AdminUserRow>(
        "SELECT id, password_hash FROM admin_users WHERE username = $1",
    )
    .bind(&body.username)
    .fetch_optional(db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            warn!(error = %e, "DB error during admin login");
            return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
        }
    };

    // Argon2id verification on a blocking thread.
    // NOTE: when `user` is None we skip verification and return 401 directly.
    // For this internal tool the timing difference is acceptable; add a dummy
    // hash verify call here if the portal is ever exposed to the public internet.
    let admin_id = match user {
        Some(u) => {
            let hash_str = u.password_hash.clone();
            let password  = body.password.clone();
            let id        = u.id;

            match tokio::task::spawn_blocking(move || {
                let parsed = PasswordHash::new(&hash_str).ok()?;
                Argon2::default().verify_password(password.as_bytes(), &parsed).ok()?;
                Some(id)
            })
            .await
            {
                Ok(Some(id)) => id,
                Ok(None) => {
                    return (StatusCode::UNAUTHORIZED, "invalid credentials").into_response()
                }
                Err(e) => {
                    warn!(error = %e, "spawn_blocking panicked during password verification");
                    return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
                }
            }
        }
        None => return (StatusCode::UNAUTHORIZED, "invalid credentials").into_response(),
    };

    match jwt::sign_admin(&state.config, &admin_id.to_string()) {
        Ok(token) => {
            info!(admin_id = %admin_id, "admin credential login successful");
            Json(LoginResponse { jwt: token }).into_response()
        }
        Err(e) => {
            warn!(error = %e, "JWT signing failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// In-game admin OTT login
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct AdminOttRequest {
    token: String,
}

/// `POST /api/auth/admin-ott` — unauthenticated in-game admin OTT exchange.
///
/// The plugin writes `admin:login:<token> <player-uuid>` to Redis when an
/// admin runs `/audio admin`.  This endpoint consumes the token and issues
/// a signed admin JWT.  The portal callback sets the httpOnly cookie.
///
/// `sub` in the resulting JWT is the admin's Minecraft player UUID so audit
/// trails can identify which in-game account initiated the session.
pub async fn admin_ott_login(
    State(state): State<AppState>,
    Json(body): Json<AdminOttRequest>,
) -> impl IntoResponse {
    let player_uuid = match admin_login_ott::validate(&state.redis, &body.token).await {
        Ok(Some(uuid)) => uuid,
        Ok(None) => return (StatusCode::UNAUTHORIZED, "invalid or expired token").into_response(),
        Err(e) => {
            warn!(error = %e, "Redis error during admin OTT validation");
            return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
        }
    };

    match jwt::sign_admin(&state.config, &player_uuid.to_string()) {
        Ok(token) => {
            info!(player = %player_uuid, "admin in-game OTT login successful");
            Json(LoginResponse { jwt: token }).into_response()
        }
        Err(e) => {
            warn!(error = %e, "JWT signing failed during admin OTT login");
            (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// Bootstrap helper — called once from main on startup
// ---------------------------------------------------------------------------

/// Create the first admin user if `admin_users` is empty.
///
/// Intended for first-deploy setup via `BOOTSTRAP_USERNAME` / `BOOTSTRAP_PASSWORD`
/// env vars.  Remove them from the environment after the initial boot.
pub async fn seed_bootstrap_admin(pool: &sqlx::PgPool, username: &str, password: &str) {
    let count: i64 = match sqlx::query_scalar("SELECT COUNT(*) FROM admin_users")
        .fetch_one(pool)
        .await
    {
        Ok(n) => n,
        Err(e) => {
            warn!(error = %e, "Bootstrap: failed to query admin_users count");
            return;
        }
    };

    if count > 0 {
        return; // admin users already exist, skip
    }

    let password_owned = password.to_owned();
    let hash = match tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(password_owned.as_bytes(), &salt)
            .map(|h| h.to_string())
    })
    .await
    {
        Ok(Ok(h)) => h,
        Ok(Err(e)) => {
            warn!(error = %e, "Bootstrap: Argon2id hashing failed");
            return;
        }
        Err(e) => {
            warn!(error = %e, "Bootstrap: spawn_blocking panicked");
            return;
        }
    };

    match sqlx::query("INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)")
        .bind(username)
        .bind(&hash)
        .execute(pool)
        .await
    {
        Ok(_) => info!(
            username = %username,
            "Bootstrap admin user created. Remove BOOTSTRAP_USERNAME and BOOTSTRAP_PASSWORD from env."
        ),
        Err(e) => warn!(error = %e, "Bootstrap: failed to insert admin user"),
    }
}
