//! Session authorization is evaluated against the current account on every request.
use super::{Error, crypto, http::session_token};
use axum::http::{HeaderMap, StatusCode};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

pub async fn authorize(
    connection: &mut PgConnection,
    headers: &HeaderMap,
    admin: bool,
    mutation: bool,
) -> Result<Uuid, Error> {
    let row = sqlx::query("SELECT users.id,users.role,sessions.csrf_hash FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=$1 AND sessions.expires_at>now() AND users.status='active'")
        .bind(session_token(headers)?).fetch_optional(connection).await?.ok_or_else(Error::unauthorized)?;
    if admin && row.get::<String, _>("role") != "admin" {
        return Err(Error::new(StatusCode::FORBIDDEN, "forbidden"));
    }
    if mutation {
        let csrf = headers
            .get("x-csrf-token")
            .and_then(|header| header.to_str().ok())
            .ok_or_else(|| Error::new(StatusCode::FORBIDDEN, "csrf_failed"))?;
        if crypto::digest(csrf) != row.get::<String, _>("csrf_hash") {
            return Err(Error::new(StatusCode::FORBIDDEN, "csrf_failed"));
        }
    }
    Ok(row.get("id"))
}
/// Serialize organization mutations, including cross-account administrator invariants.
pub async fn lock(connection: &mut PgConnection) -> Result<(), Error> {
    sqlx::query("SELECT id FROM company FOR UPDATE")
        .fetch_one(connection)
        .await?;
    Ok(())
}
