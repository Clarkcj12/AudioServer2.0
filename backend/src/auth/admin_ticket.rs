use uuid::Uuid;

use crate::{auth::ott::OttError, RedisPool};

const TTL_SECONDS: usize = 15;

/// Issue a short-lived admin WebSocket ticket.
///
/// Stores `SET admin:ticket:<uuid> "" EX 15` in Redis.
/// The caller returns the UUID to the browser; the browser passes it as
/// `?ticket=<uuid>` when opening the admin WebSocket.
pub async fn issue(pool: &RedisPool) -> Result<Uuid, OttError> {
    let ticket = Uuid::new_v4();
    let key = format!("admin:ticket:{ticket}");
    let mut conn = pool.get().await?;
    deadpool_redis::redis::cmd("SET")
        .arg(&key)
        .arg("")
        .arg("EX")
        .arg(TTL_SECONDS)
        .query_async::<()>(&mut *conn)
        .await?;
    Ok(ticket)
}

/// Validate an admin ticket via atomic GETDEL.
///
/// Returns `true` if the ticket existed (and has now been consumed),
/// `false` if absent or expired.
pub async fn validate(pool: &RedisPool, ticket: &str) -> Result<bool, OttError> {
    let key = format!("admin:ticket:{ticket}");
    let mut conn = pool.get().await?;
    let raw: Option<String> = deadpool_redis::redis::cmd("GETDEL")
        .arg(&key)
        .query_async(&mut *conn)
        .await?;
    Ok(raw.is_some())
}
