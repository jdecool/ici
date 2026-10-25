//! HTTP composition root. Business capabilities live in independent crates.

mod greeting;
mod health;

use axum::{Router, routing::get};
use tower_http::trace::TraceLayer;

/// Build the HTTP application without opening a socket.
pub fn router() -> Router {
    Router::new()
        .route("/api/hello", get(greeting::http::hello))
        .route("/health", get(health::health))
        .layer(TraceLayer::new_for_http())
}
