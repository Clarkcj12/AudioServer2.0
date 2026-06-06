use std::env;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("Missing required environment variable: {0}")]
    MissingVar(String),
    #[error("Invalid value for {0}: {1}")]
    InvalidVar(String, String),
}

/// All configuration is read from environment variables so every relay node
/// can be launched with the same binary and different env (Docker, systemd, etc.).
#[derive(Debug, Clone)]
pub struct Config {
    pub redis_url: String,
    /// Shared HS256 secret. ALL relay nodes in the cluster MUST use the same value.
    pub jwt_secret: String,
    pub jwt_expiry_seconds: u64,
    pub bind_addr: String,
    /// Filesystem path to the compiled Svelte static files.
    pub static_dir: String,
    /// PostgreSQL connection URL. `None` when `DATABASE_URL` is unset; the relay
    /// starts without a DB and user-settings endpoints return 503.
    pub database_url: Option<String>,
    /// If set alongside `bootstrap_password` and `admin_users` is empty on
    /// startup, the relay creates this admin account automatically.
    /// Remove both vars from env after first boot.
    pub bootstrap_username: Option<String>,
    pub bootstrap_password: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Ok(Self {
            redis_url: require("REDIS_URL")?,
            jwt_secret: require("JWT_SECRET")?,
            jwt_expiry_seconds: parse_u64("JWT_EXPIRY_SECONDS", 86400)?,
            bind_addr: env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into()),
            static_dir: env::var("STATIC_DIR").unwrap_or_else(|_| "../client-lite/build".into()),
            database_url: env::var("DATABASE_URL").ok(),
            bootstrap_username: env::var("BOOTSTRAP_USERNAME").ok(),
            bootstrap_password: env::var("BOOTSTRAP_PASSWORD").ok(),
        })
    }
}

fn require(key: &str) -> Result<String, ConfigError> {
    env::var(key).map_err(|_| ConfigError::MissingVar(key.into()))
}

fn parse_u64(key: &str, default: u64) -> Result<u64, ConfigError> {
    match env::var(key) {
        Ok(v) => v
            .parse()
            .map_err(|_| ConfigError::InvalidVar(key.into(), v)),
        Err(_) => Ok(default),
    }
}
