use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

/// Initialise a PostgreSQL connection pool and apply pending migrations.
///
/// Returns `None` (not an error) when `database_url` is `None` — the relay
/// starts cleanly without a DB; user-settings endpoints return 503.
pub async fn build(database_url: Option<&str>) -> Option<PgPool> {
    let url = database_url?;

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(url)
        .await
        .map_err(|e| tracing::error!(error = %e, "Failed to connect to PostgreSQL"))
        .ok()?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|e| tracing::error!(error = %e, "Failed to run DB migrations"))
        .ok()?;

    tracing::info!("PostgreSQL pool connected and migrations applied");
    Some(pool)
}
