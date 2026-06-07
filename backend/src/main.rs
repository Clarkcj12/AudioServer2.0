/// AudioServer 2.0 — Rust/Axum stateless relay node.
///
/// Each process is fully stateless; all session state lives in Redis.
/// Run N copies behind NGINX/HAProxy for horizontal scaling.
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

mod api;
mod auth;
mod config;
mod db;
mod redis_pool;
mod router;
mod storage;
mod ws;

pub use config::Config;
pub use redis_pool::RedisPool;
pub use storage::StorageClient;

/// Shared application state injected into every Axum handler via [`axum::extract::State`].
#[derive(Clone)]
pub struct AppState {
    /// Connection pool for regular Redis commands (OTT GETDEL, stats queries).
    pub redis: RedisPool,
    /// Bare client used to open one dedicated Pub/Sub connection per WS session.
    /// Pub/Sub connections are stateful and cannot be returned to the pool.
    pub redis_client: deadpool_redis::redis::Client,
    /// PostgreSQL pool for user settings. `None` when `DATABASE_URL` is unset.
    pub db: Option<sqlx::PgPool>,
    /// S3/MinIO client for audio media library. `None` when S3_* vars are unset.
    pub storage: Option<StorageClient>,
    pub config: Arc<Config>,
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Arc::new(Config::from_env().expect("Failed to load configuration"));

    let redis = redis_pool::build(&config.redis_url)
        .await
        .expect("Failed to connect to Redis");
    let redis_client = deadpool_redis::redis::Client::open(config.redis_url.as_str())
        .expect("Failed to create Redis Pub/Sub client");

    let db = db::build(config.database_url.as_deref()).await;
    if db.is_none() && config.database_url.is_some() {
        // DATABASE_URL was set but connection failed; already logged inside db::build.
        tracing::warn!("Continuing without PostgreSQL — user-settings endpoints will return 503");
    }

    // Seed the first admin user if BOOTSTRAP_USERNAME + BOOTSTRAP_PASSWORD are set
    // and admin_users table is empty.  Remove these env vars after first boot.
    if let (Some(pool), Some(username), Some(password)) = (
        db.as_ref(),
        config.bootstrap_username.as_deref(),
        config.bootstrap_password.as_deref(),
    ) {
        api::auth::seed_bootstrap_admin(pool, username, password).await;
    }

    let storage = StorageClient::from_config(&config);
    if storage.is_none() && config.s3_endpoint.is_some() {
        tracing::warn!("S3_ENDPOINT is set but storage client failed to initialise — media endpoints will return 503");
    } else if storage.is_none() {
        tracing::info!("S3 not configured — media library endpoints disabled (set S3_ENDPOINT/BUCKET/REGION/ACCESS_KEY/SECRET_KEY to enable)");
    }

    let state = AppState { redis, redis_client, db, storage, config: config.clone() };
    let app = router::build(state);

    let listener = TcpListener::bind(&config.bind_addr)
        .await
        .expect("Failed to bind TCP listener");

    info!("AudioServer relay listening on {}", config.bind_addr);
    axum::serve(listener, app).await.expect("Server error");
}
