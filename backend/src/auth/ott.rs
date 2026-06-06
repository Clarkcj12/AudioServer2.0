use thiserror::Error;
use uuid::Uuid;

use crate::RedisPool;

#[derive(Debug, Error)]
pub enum OttError {
    #[error("Redis pool error: {0}")]
    Pool(#[from] deadpool_redis::PoolError),
    #[error("Redis command error: {0}")]
    Redis(#[from] deadpool_redis::redis::RedisError),
    #[error("Stored UUID is malformed: {0}")]
    MalformedUuid(#[from] uuid::Error),
}

/// Validate a one-time token against Redis and return the associated player UUID.
///
/// Uses `GETDEL` (Redis 6.2+) for atomic read-and-delete, preventing two racing
/// WebSocket connections from both consuming the same token.
///
/// Returns `Ok(None)` when the token is absent or expired; the caller should
/// respond with HTTP 401 before performing the WebSocket upgrade.
pub async fn validate(pool: &RedisPool, token: &str) -> Result<Option<Uuid>, OttError> {
    let key = format!("audio:auth:token:{token}");
    let mut conn = pool.get().await?;

    // Atomic read + delete — no separate DEL needed, eliminates the race condition
    let raw: Option<String> = deadpool_redis::redis::cmd("GETDEL")
        .arg(&key)
        .query_async(&mut *conn)
        .await?;

    match raw {
        None => Ok(None),
        Some(s) => Ok(Some(Uuid::parse_str(&s)?)),
    }
}
