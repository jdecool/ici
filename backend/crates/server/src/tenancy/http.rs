use crate::identity::extract::JsonBody;
use crate::{
    identity::{Error, crypto},
    tenancy::registry::{State, verification_mail},
};
use axum::{
    Json,
    extract::{Query, State as ExtractState},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;

#[derive(Clone)]
pub struct Context {
    pub slug: Option<String>,
}
#[derive(Deserialize)]
pub struct Availability {
    slug: String,
}
pub async fn availability(
    ExtractState(state): ExtractState<State>,
    query: Result<Query<Availability>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, Error> {
    let Query(query) = query.map_err(|_| Error::field("slug"))?;
    let slug =
        crate::tenancy::rules::normalize_slug(&query.slug).ok_or_else(|| Error::field("slug"))?;
    let taken: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tenants WHERE slug=$1 AND (state!='pending' OR expires_at>now()))").bind(slug).fetch_one(&state.central).await?;
    Ok(Json(json!({"available": !taken})))
}
#[derive(Deserialize)]
pub struct Registration {
    first_name: String,
    last_name: String,
    slug: String,
    email: String,
    password: String,
    accepted_terms: bool,
    terms_version: String,
}
pub async fn register(
    ExtractState(state): ExtractState<State>,
    JsonBody(input): JsonBody<Registration>,
) -> Result<(StatusCode, Json<Value>), Error> {
    let slug =
        crate::tenancy::rules::normalize_slug(&input.slug).ok_or_else(|| Error::field("slug"))?;
    let email = crate::identity::rules::normalize_email(&input.email)
        .ok_or_else(|| Error::field("email"))?;
    if email.parse::<lettre::Address>().is_err() {
        return Err(Error::field("email"));
    }
    if !crate::identity::rules::valid_name(&input.first_name) {
        return Err(Error::field("first_name"));
    }
    if !crate::identity::rules::valid_name(&input.last_name) {
        return Err(Error::field("last_name"));
    }
    if !crate::identity::rules::valid_password(&input.password) {
        return Err(Error::field("password"));
    }
    if !input.accepted_terms || input.terms_version != crate::identity::rules::TERMS_VERSION {
        return Err(Error::field("accepted_terms"));
    }
    state.limit(&format!("register:{email}"), 5).await?;
    let hash = crypto::hash_password(input.password).await?;
    let pending = crate::tenancy::registration::register(
        &slug,
        &super::postgres::Registration {
            state: &state,
            first_name: &input.first_name,
            last_name: &input.last_name,
            email: &email,
            password_hash: &hash,
        },
    )
    .await
    .map_err(|error| match error {
        crate::tenancy::registration::ReservationError::InvalidSlug => Error::field("slug"),
        crate::tenancy::registration::ReservationError::AlreadyReserved => {
            let mut error = Error::new(StatusCode::CONFLICT, "slug_unavailable");
            error.fields = json!({"slug":"unavailable"});
            error
        }
        crate::tenancy::registration::ReservationError::Unavailable => Error::internal(),
    })?;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({"receipt":pending.receipt,"slug":pending.slug})),
    ))
}

fn receipt(headers: &HeaderMap) -> Result<String, Error> {
    headers
        .get("authorization")
        .and_then(|header| header.to_str().ok())
        .and_then(|header| header.strip_prefix("Bearer "))
        .filter(|value| value.len() == 64)
        .map(crypto::digest)
        .ok_or_else(Error::unauthorized)
}
pub async fn status(
    ExtractState(state): ExtractState<State>,
    headers: HeaderMap,
) -> Result<Json<Value>, Error> {
    let row = sqlx::query(
        "SELECT slug,state,expires_at>now() AS valid FROM tenants WHERE receipt_hash=$1",
    )
    .bind(receipt(&headers)?)
    .fetch_optional(&state.central)
    .await?
    .ok_or_else(Error::unauthorized)?;
    let slug: String = row.get("slug");
    let status: String = row.get("state");
    let status = if status == "pending" && !row.get::<bool, _>("valid") {
        "expired"
    } else {
        &status
    };
    Ok(Json(
        json!({"state": status, "slug": slug, "origin": state.config.tenant_origin(&slug)}),
    ))
}
pub async fn resend(
    ExtractState(state): ExtractState<State>,
    headers: HeaderMap,
) -> Result<Json<Value>, Error> {
    let receipt = receipt(&headers)?;
    state.limit(&format!("resend:{receipt}"), 3).await?;
    let token = crypto::token();
    let mut transaction = state.central.begin().await?;
    let registration = sqlx::query("UPDATE tenants SET verification_hash=$1 WHERE receipt_hash=$2 AND state='pending' AND expires_at>now() RETURNING email,slug").bind(crypto::digest(&token)).bind(receipt).fetch_optional(&mut *transaction).await?;
    if let Some(registration) = registration {
        verification_mail(
            &mut transaction,
            &state,
            &registration.get::<String, _>("email"),
            &registration.get::<String, _>("slug"),
            &token,
        )
        .await?;
    }
    transaction.commit().await?;
    Ok(Json(json!({"sent": true})))
}
#[derive(Deserialize)]
pub struct Verification {
    token: String,
}
pub async fn verify(
    ExtractState(state): ExtractState<State>,
    JsonBody(input): JsonBody<Verification>,
) -> Result<Json<Value>, Error> {
    let receipt = crypto::token();
    let slug: Option<String> = sqlx::query_scalar("UPDATE tenants SET state='queued', verification_hash=NULL,receipt_hash=$1, updated_at=now() WHERE verification_hash=$2 AND state='pending' AND expires_at>now() RETURNING slug")
        .bind(crypto::digest(&receipt)).bind(crypto::digest(&input.token)).fetch_optional(&state.central).await?;
    let slug = slug.ok_or_else(|| Error::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_token"))?;
    Ok(Json(json!({"receipt": receipt, "slug": slug})))
}
