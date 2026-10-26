pub(crate) mod authentication;
pub(crate) mod rules;
pub use rules::TERMS_VERSION;
pub(crate) mod access;
pub mod crypto;
pub(crate) mod extract;
pub mod http;
pub(crate) mod members;
mod postgres;

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

#[derive(Debug)]
pub struct Error {
    pub status: StatusCode,
    pub code: &'static str,
    pub fields: Value,
}
impl Error {
    pub fn new(status: StatusCode, code: &'static str) -> Self {
        Self {
            status,
            code,
            fields: json!({}),
        }
    }
    pub fn field(name: &str) -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code: "invalid_input",
            fields: json!({name: "invalid"}),
        }
    }
    pub fn internal_from<E>(_: E) -> Self {
        Self::internal()
    }
    pub fn internal() -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, "service_unavailable")
    }
    pub fn unauthorized() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthenticated")
    }
}
impl From<sqlx::Error> for Error {
    fn from(error: sqlx::Error) -> Self {
        // Do not log SQL arguments: they may contain credentials or tokens.
        tracing::error!(kind = ?error.as_database_error().map(|error| error.code()), "Database operation failed");
        Self::internal()
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({"code": self.code, "fields": self.fields})),
        )
            .into_response()
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code)
    }
}
impl std::error::Error for Error {}
