use jsonwebtoken::{encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use uuid::Uuid;

use crate::Config;

#[derive(Debug, Error)]
pub enum JwtError {
    #[error("JWT error: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),
}

/// JWT claims used throughout the system.
///
/// Player tokens: `sub` = Minecraft UUID, `role` = `None`.
/// Admin tokens (from the Pro Portal): `sub` = `"portal-admin"`, `role` = `Some("admin")`.
/// Both are signed with the same `JWT_SECRET`.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// Subject: Minecraft player UUID (player tokens) or `"portal-admin"` (admin tokens).
    pub sub: String,
    /// Expiry — Unix timestamp (seconds).
    pub exp: u64,
    /// Issued-at — Unix timestamp (seconds).
    pub iat: u64,
    /// Present only on admin tokens issued by the Pro Portal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

/// Sign a new player JWT.
///
/// The `Config::jwt_secret` MUST be identical across all relay nodes in the
/// cluster; tokens signed on node A must validate on node B.
pub fn sign(config: &Config, player_uuid: Uuid) -> Result<String, JwtError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_secs();

    let claims = Claims {
        sub: player_uuid.to_string(),
        exp: now + config.jwt_expiry_seconds,
        iat: now,
        role: None,
    };

    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )?)
}

/// Sign a new admin JWT for a portal admin user.
///
/// `admin_id` is the UUID from the `admin_users` table, used as `sub` so
/// per-user audit logging is possible later.
pub fn sign_admin(config: &Config, admin_id: &str) -> Result<String, JwtError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_secs();

    let claims = Claims {
        sub: admin_id.to_owned(),
        exp: now + config.jwt_expiry_seconds,
        iat: now,
        role: Some("admin".to_owned()),
    };

    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )?)
}

/// Verify and decode a JWT.
///
/// Called by the [`crate::auth::extractor`] for every protected `/api/*` request.
pub fn verify(config: &Config, token: &str) -> Result<Claims, JwtError> {
    let data = jsonwebtoken::decode::<Claims>(
        token,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(data.claims)
}
