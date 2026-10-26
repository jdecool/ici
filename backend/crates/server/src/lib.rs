//! Application composition with capability modules.

pub mod config;
mod health;
pub mod identity;
mod security;
pub mod tenancy;

use axum::{Router, routing::get};
use tower_http::trace::TraceLayer;

/// Build the HTTP application without opening a socket.
pub fn router() -> Router {
    Router::new()
        .route("/health", get(health::health))
        .layer(TraceLayer::new_for_http())
}

/// Compose the persisted application with a validated runtime configuration.
pub fn application(state: tenancy::registry::State) -> Router {
    use axum::{middleware, routing::post};
    let api = Router::new()
        .route("/api/config", get(public_config))
        .route(
            "/api/tenants/availability",
            get(tenancy::http::availability),
        )
        .route("/api/registrations", post(tenancy::http::register))
        .route("/api/registrations/resend", post(tenancy::http::resend))
        .route("/api/registrations/verify", post(tenancy::http::verify))
        .route("/api/registrations/status", get(tenancy::http::status))
        .route("/api/auth/login", post(identity::http::login))
        .route("/api/auth/handoff", post(identity::http::handoff))
        .route("/api/auth/session", get(identity::http::session))
        .route("/api/auth/logout", post(identity::http::logout))
        .route("/api/auth/forgot-password", post(identity::http::forgot))
        .route("/api/auth/reset-password", post(identity::http::reset))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            security::guard,
        ))
        .with_state(state.clone());
    Router::new().merge(api).route(
        "/health",
        get(move || async move {
            match sqlx::query("SELECT 1").execute(&state.central).await {
                Ok(_) => (
                    axum::http::StatusCode::OK,
                    axum::Json(serde_json::json!({"status":"ok"})),
                ),
                Err(_) => (
                    axum::http::StatusCode::SERVICE_UNAVAILABLE,
                    axum::Json(serde_json::json!({"status":"unavailable"})),
                ),
            }
        }),
    )
}
async fn public_config(
    axum::extract::State(state): axum::extract::State<tenancy::registry::State>,
    axum::Extension(context): axum::Extension<tenancy::http::Context>,
) -> axum::Json<serde_json::Value> {
    axum::Json(
        serde_json::json!({"root_domain":state.config.root_domain,"public_origin":state.config.public_origin,"tenant":context.slug,"terms_version": crate::identity::rules::TERMS_VERSION}),
    )
}
