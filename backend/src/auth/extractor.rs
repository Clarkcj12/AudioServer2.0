use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
};

use super::{jwt, jwt::Claims};
use crate::AppState;

/// Axum extractor that validates any JWT signed with the shared `JWT_SECRET`
/// and additionally asserts `role == "admin"`.
///
/// Apply to handler parameters on all `/api/*` routes so the portal's admin
/// token is accepted and player tokens are rejected.
///
/// ```no_run
/// async fn my_handler(
///     AdminClaims(claims): AdminClaims,
///     State(state): State<AppState>,
/// ) -> impl IntoResponse { ... }
/// ```
pub struct AdminClaims(pub Claims);

impl FromRequestParts<AppState> for AdminClaims {
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(parts)?;

        let claims = jwt::verify(&state.config, token)
            .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid or expired token"))?;

        if claims.role.as_deref() != Some("admin") {
            return Err((StatusCode::FORBIDDEN, "admin role required"));
        }

        Ok(AdminClaims(claims))
    }
}

/// Axum extractor for player JWTs.
///
/// Player tokens have no `role` claim and a `sub` equal to a Minecraft player UUID.
/// Admin tokens are explicitly rejected — use [`AdminClaims`] for admin routes.
pub struct PlayerClaims(pub Claims);

impl FromRequestParts<AppState> for PlayerClaims {
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(parts)?;

        let claims = jwt::verify(&state.config, token)
            .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid or expired token"))?;

        // Admin tokens (role = "admin") must not access player endpoints
        if claims.role.is_some() {
            return Err((StatusCode::FORBIDDEN, "player token required"));
        }

        // Sub must be a valid UUID
        if uuid::Uuid::parse_str(&claims.sub).is_err() {
            return Err((StatusCode::UNAUTHORIZED, "invalid player token"));
        }

        Ok(PlayerClaims(claims))
    }
}

/// Extract the raw token string from an `Authorization: Bearer <token>` header.
fn bearer_token(parts: &Parts) -> Result<&str, (StatusCode, &'static str)> {
    parts
        .headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .filter(|s| !s.is_empty())
        .ok_or((StatusCode::UNAUTHORIZED, "missing or malformed Authorization header"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Config;
    use std::sync::Arc;

    fn make_config(secret: &str) -> Arc<Config> {
        Arc::new(Config {
            redis_url: String::new(),
            jwt_secret: secret.to_string(),
            jwt_expiry_seconds: 3600,
            bind_addr: String::new(),
            static_dir: String::new(),
            database_url: None,
            bootstrap_username: None,
            bootstrap_password: None,
        })
    }

    #[test]
    fn bearer_token_extracted_correctly() {
        let parts = axum::http::Request::builder()
            .header("Authorization", "Bearer my.test.token")
            .body(())
            .unwrap()
            .into_parts()
            .0;
        assert_eq!(bearer_token(&parts).unwrap(), "my.test.token");
    }

    #[test]
    fn missing_header_returns_401() {
        let parts = axum::http::Request::builder()
            .body(())
            .unwrap()
            .into_parts()
            .0;
        let err = bearer_token(&parts).unwrap_err();
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn admin_jwt_verify_and_role_check() {
        let config = make_config("test-secret");
        // Sign an admin-style token (jose would produce this structure)
        use jsonwebtoken::{encode, EncodingKey, Header};
let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        #[derive(serde::Serialize)]
        struct AdminPayload { sub: &'static str, role: &'static str, exp: u64, iat: u64 }
        let token = encode(
            &Header::default(),
            &AdminPayload { sub: "portal-admin", role: "admin", exp: now + 3600, iat: now },
            &EncodingKey::from_secret(b"test-secret"),
        ).unwrap();

        let claims = jwt::verify(&config, &token).unwrap();
        assert_eq!(claims.role.as_deref(), Some("admin"));
    }

    #[test]
    fn player_jwt_has_no_role() {
        let config = make_config("test-secret");
        let uuid = uuid::Uuid::new_v4();
        let token = jwt::sign(&config, uuid).unwrap();
        let claims = jwt::verify(&config, &token).unwrap();
        assert!(claims.role.is_none());
    }
}
