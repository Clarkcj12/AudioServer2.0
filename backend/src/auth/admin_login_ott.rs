use uuid::Uuid;

use crate::{auth::ott::OttError, RedisPool};

/// Validate an admin portal login OTT via atomic GETDEL.
///
/// Key: `admin:login:<token>`, value: Minecraft player UUID string.
/// Written by the plugin's `/audio admin` command (TTL 5 min).
///
/// Returns `Ok(Some(uuid))` when valid, `Ok(None)` when absent/expired/malformed.
pub async fn validate(pool: &RedisPool, token: &str) -> Result<Option<Uuid>, OttError> {
    let key = format!("admin:login:{token}");
    let mut conn = pool.get().await?;

    let raw: Option<String> = deadpool_redis::redis::cmd("GETDEL")
        .arg(&key)
        .query_async(&mut *conn)
        .await?;

    match raw {
        None => Ok(None),
        Some(s) => match Uuid::parse_str(s.trim()) {
            Ok(uuid) => Ok(Some(uuid)),
            Err(_)   => Ok(None), // malformed value
        },
    }
}
