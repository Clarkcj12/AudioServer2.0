use deadpool_redis::{Config as PoolConfig, Pool, PoolError, Runtime};
use thiserror::Error;

/// Type alias used throughout the codebase.
pub type RedisPool = Pool;

#[derive(Debug, Error)]
pub enum RedisPoolError {
    #[error("Failed to create Redis pool: {0}")]
    Create(#[from] deadpool_redis::CreatePoolError),
    #[error("Failed to connect to Redis on startup: {0}")]
    Connect(#[from] PoolError),
}

/// Initialise a deadpool-redis connection pool from a `redis://` URL.
pub async fn build(url: &str) -> Result<RedisPool, RedisPoolError> {
    let cfg = PoolConfig::from_url(url);
    let pool = cfg.create_pool(Some(Runtime::Tokio1))?;
    // Eagerly verify connectivity so we fail fast at startup rather than on first request.
    pool.get().await?;
    Ok(pool)
}
