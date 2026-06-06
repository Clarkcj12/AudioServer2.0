use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::Serialize;
use tracing::warn;

use crate::{
    auth::{admin_ticket, extractor::AdminClaims},
    AppState,
};

#[derive(Serialize)]
struct TicketResponse {
    ticket: String,
    expires_in: u8,
}

/// `POST /api/admin/ticket`
///
/// Issues a short-lived (15 s) WebSocket ticket for the admin event stream.
/// The browser passes the ticket as `?ticket=<uuid>` when opening
/// `GET /ws/admin` — the httpOnly cookie cannot be read by the WebSocket API.
pub async fn issue_ticket(
    AdminClaims(_): AdminClaims,
    State(state): State<AppState>,
) -> impl IntoResponse {
    match admin_ticket::issue(&state.redis).await {
        Ok(uuid) => Json(TicketResponse {
            ticket: uuid.to_string(),
            expires_in: 15,
        })
        .into_response(),
        Err(e) => {
            warn!(error = %e, "admin ticket issuance failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "ticket issuance failed").into_response()
        }
    }
}
