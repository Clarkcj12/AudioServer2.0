use axum::{routing::{get, post, put}, Router};
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
};

use crate::{
    api::{admin_ticket, auth, player, sessions, settings, stats},
    ws::{admin::admin_ws_handler, handler::ws_handler},
    AppState,
};

/// Build the Axum router.
pub fn build(state: AppState) -> Router {
    let static_dir = state.config.static_dir.clone();

    Router::new()
        // ── Player endpoints ────────────────────────────────────────────────
        .route("/ws",          get(ws_handler))
        .route("/health",      get(|| async { "ok" }))

        // ── Auth endpoints (unauthenticated) ────────────────────────────────
        .route("/api/auth/login",              post(auth::login))
        .route("/api/auth/admin-ott",          post(auth::admin_ott_login))
        .route("/api/auth/player-callback",    post(player::player_callback))

        // ── Player REST API (requires player JWT, no role) ───────────────────
        .route("/api/player/me",               get(player::get_me))
        .route("/api/player/settings",         put(player::put_player_settings))

        // ── Admin REST API (requires admin JWT) ─────────────────────────────
        .route("/api/stats",              get(stats::get_stats))
        .route("/api/sessions",           get(sessions::get_sessions))
        .route("/api/settings/{uuid}",    get(settings::get_settings))
        .route("/api/settings/{uuid}",    put(settings::put_settings))
        .route("/api/admin/ticket",       post(admin_ticket::issue_ticket))

        // ── Admin WebSocket (ticket auth, streams audio:events) ─────────────
        .route("/ws/admin",    get(admin_ws_handler))

        // ── Static Svelte client ────────────────────────────────────────────
        .nest_service("/", ServeDir::new(static_dir))

        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state)
}
