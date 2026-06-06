use uuid::Uuid;

use crate::{auth::ott::OttError, RedisPool};

/// Decoded portal OTT payload.
pub struct PlayerOtt {
    pub player_uuid: Uuid,
    pub username: String,
}

/// Validate a portal OTT using atomic GETDEL.
///
/// Portal OTTs use a different key prefix (`audio:portal:token:`) from audio
/// OTTs (`audio:auth:token:`) so both can coexist for the same player.
///
/// Value format stored by the plugin: `"<player-uuid>:<username>"`.
/// Minecraft usernames are `[A-Za-z0-9_]` and contain no colons, so splitting
/// on the first colon is unambiguous.
///
/// Returns `Ok(None)` when the token is absent, expired, or malformed.
pub async fn validate(pool: &RedisPool, token: &str) -> Result<Option<PlayerOtt>, OttError> {
    let key = format!("audio:portal:token:{token}");
    let mut conn = pool.get().await?;

    let raw: Option<String> = deadpool_redis::redis::cmd("GETDEL")
        .arg(&key)
        .query_async(&mut *conn)
        .await?;

    let Some(s) = raw else {
        return Ok(None);
    };

    let Some((uuid_str, username)) = s.split_once(':') else {
        return Ok(None); // malformed — treat as absent
    };

    match Uuid::parse_str(uuid_str) {
        Ok(player_uuid) => Ok(Some(PlayerOtt {
            player_uuid,
            username: username.to_owned(),
        })),
        Err(_) => Ok(None),
    }
}
