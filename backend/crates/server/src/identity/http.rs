use super::{Error, crypto};
use crate::identity::extract::JsonBody;
use crate::tenancy::{
    http::Context,
    registry::{State, Tenant, enqueue},
};
use axum::{
    Extension, Json,
    extract::State as ExtractState,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct Login {
    slug: Option<String>,
    email: String,
    password: String,
    #[serde(default)]
    remember: bool,
}
pub async fn login(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    JsonBody(input): JsonBody<Login>,
) -> Result<Response, Error> {
    let slug = context
        .slug
        .or(input.slug)
        .and_then(|slug| crate::tenancy::rules::normalize_slug(&slug))
        .ok_or_else(|| Error::field("slug"))?;
    let code = crate::identity::authentication::login(
        &super::postgres::TenantAccounts {
            state: &state,
            slug: &slug,
        },
        &super::postgres::Passwords { state: &state },
        &input.email,
        &input.password,
        input.remember,
    )
    .await
    .map_err(|error| match error {
        crate::identity::authentication::LoginError::InvalidEmail => Error::field("email"),
        crate::identity::authentication::LoginError::InvalidCredentials => {
            Error::new(StatusCode::UNAUTHORIZED, "invalid_credentials")
        }
        crate::identity::authentication::LoginError::Unavailable => Error::internal(),
        crate::identity::authentication::LoginError::RateLimited => {
            Error::new(StatusCode::TOO_MANY_REQUESTS, "rate_limited")
        }
    })?;
    Ok(Json(json!({"code":code,"target":format!("{}/api/auth/handoff",state.config.tenant_origin(&slug))})).into_response())
}
#[derive(Deserialize)]
pub struct Handoff {
    code: String,
}
pub async fn handoff(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    crate::identity::extract::FormBody(input): crate::identity::extract::FormBody<Handoff>,
) -> Result<Response, Error> {
    let tenant = tenant(&state, context).await?;
    let row = sqlx::query("DELETE FROM handoffs WHERE token_hash=$1 AND tenant_id=$2 AND expires_at>now() RETURNING user_id,remember,credential_version").bind(crypto::digest(&input.code)).bind(tenant.id).fetch_optional(&state.central).await?.ok_or_else(|| Error::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_handoff"))?;
    let token = crypto::token();
    let csrf = csrf_token(&state, &crypto::digest(&token));
    let mut transaction = tenant.pool.begin().await?;
    let version: i32 = sqlx::query_scalar(
        "SELECT credential_version FROM users WHERE id=$1 AND status='active' FOR UPDATE",
    )
    .bind(row.get::<Uuid, _>("user_id"))
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| Error::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_handoff"))?;
    if version != row.get::<i32, _>("credential_version") {
        return Err(Error::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_handoff",
        ));
    }
    let seconds = crate::identity::rules::session_seconds(row.get("remember"));
    sqlx::query("INSERT INTO sessions (token_hash,user_id,csrf_hash,expires_at) VALUES ($1,$2,$3,now()+make_interval(secs=>$4))")
        .bind(crypto::digest(&token)).bind(row.get::<Uuid,_>("user_id")).bind(crypto::digest(&csrf)).bind(seconds as f64).execute(&mut *transaction).await?;
    transaction.commit().await?;
    let mut response = (StatusCode::SEE_OTHER, [("location", "/")]).into_response();
    let secure = if state.config.secure { "; Secure" } else { "" };
    let cookie =
        format!("ici_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={seconds}{secure}");
    response.headers_mut().insert(
        "set-cookie",
        HeaderValue::from_str(&cookie).map_err(Error::internal_from)?,
    );
    Ok(response)
}
pub(crate) async fn tenant(state: &State, context: Context) -> Result<Tenant, Error> {
    state
        .tenant(&context.slug.ok_or_else(Error::unauthorized)?)
        .await
}
pub(crate) fn session_token(headers: &HeaderMap) -> Result<String, Error> {
    headers
        .get("cookie")
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies
                .split(';')
                .find_map(|cookie| cookie.trim().strip_prefix("ici_session="))
        })
        .filter(|token| token.len() == 64)
        .map(crypto::digest)
        .ok_or_else(Error::unauthorized)
}
pub async fn session(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let token = session_token(&headers)?;
    let csrf = csrf_token(&state, &token);
    let row = sqlx::query("SELECT users.id,users.email,users.first_name,users.last_name,users.role,company.name FROM sessions JOIN users ON users.id=sessions.user_id CROSS JOIN company WHERE sessions.token_hash=$1 AND sessions.expires_at>now() AND users.status='active'")
        .bind(token).fetch_optional(&tenant.pool).await?.ok_or_else(Error::unauthorized)?;
    Ok(Json(
        json!({"id": row.get::<Uuid,_>("id").to_string(), "company": row.get::<String,_>("name"), "email": row.get::<String,_>("email"), "first_name": row.get::<String,_>("first_name"), "last_name": row.get::<String,_>("last_name"), "role": row.get::<String,_>("role"), "csrf": csrf}),
    ))
}
pub async fn logout(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
) -> Result<Response, Error> {
    let tenant = tenant(&state, context).await?;
    let csrf = headers
        .get("x-csrf-token")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| Error::new(StatusCode::FORBIDDEN, "csrf_failed"))?;
    let removed = sqlx::query(
        "DELETE FROM sessions WHERE token_hash=$1 AND csrf_hash=$2 AND expires_at>now()",
    )
    .bind(session_token(&headers)?)
    .bind(crypto::digest(csrf))
    .execute(&tenant.pool)
    .await?
    .rows_affected();
    if removed == 0 {
        return Err(Error::new(StatusCode::FORBIDDEN, "csrf_failed"));
    }
    Ok((
        [(
            "set-cookie",
            "ici_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
        )],
        Json(json!({"logged_out": true})),
    )
        .into_response())
}
#[derive(Deserialize)]
pub struct Forgot {
    slug: Option<String>,
    email: String,
}
pub async fn forgot(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    JsonBody(input): JsonBody<Forgot>,
) -> Result<Json<Value>, Error> {
    let slug = context
        .slug
        .or(input.slug)
        .and_then(|slug| crate::tenancy::rules::normalize_slug(&slug))
        .ok_or_else(|| Error::field("slug"))?;
    let email = crate::identity::rules::normalize_email(&input.email)
        .ok_or_else(|| Error::field("email"))?;
    state.limit(&format!("forgot:{slug}:{email}"), 5).await?;
    let tenant = match state.tenant(&slug).await {
        Ok(tenant) => Some(tenant),
        Err(error) if error.code == "unknown_tenant" => None,
        Err(error) => return Err(error),
    };
    if let Some(tenant) = tenant {
        let mut account_transaction = tenant.pool.begin().await?;
        super::access::lock(&mut account_transaction).await?;
        let user: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM users WHERE email=$1 AND status='active'")
                .bind(&email)
                .fetch_optional(&mut *account_transaction)
                .await?;
        if let Some(user) = user {
            let token = crypto::token();
            insert_reset(&mut account_transaction, user, &token).await?;
            account_transaction.commit().await?;
            let mut transaction = state.central.begin().await?;
            enqueue(&mut transaction, &state, &email, "Réinitialisez votre mot de passe — Ici", &format!("Choisissez votre nouveau mot de passe :\n{}/reset-password#token={token}\nCe lien expire dans 30 minutes.", state.config.tenant_origin(&slug))).await?;
            transaction.commit().await?;
        }
    }
    Ok(Json(json!({"sent": true})))
}
async fn insert_reset(connection: &mut PgConnection, user: Uuid, token: &str) -> Result<(), Error> {
    sqlx::query("INSERT INTO resets (token_hash,user_id,expires_at) VALUES ($1,$2,now()+make_interval(secs=>$3))")
        .bind(crypto::digest(token))
        .bind(user)
        .bind(crate::identity::rules::RESET_SECONDS as f64)
        .execute(connection)
        .await?;
    Ok(())
}
#[derive(Deserialize)]
pub struct Reset {
    token: String,
    password: String,
}
pub async fn reset(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    JsonBody(input): JsonBody<Reset>,
) -> Result<Json<Value>, Error> {
    if !crate::identity::rules::valid_password(&input.password) {
        return Err(Error::field("password"));
    }
    let tenant = tenant(&state, context).await?;
    let hash = crypto::hash_password(input.password).await?;
    let mut transaction = tenant.pool.begin().await?;
    super::access::lock(&mut transaction).await?;
    let user: Option<Uuid> = sqlx::query_scalar(
        "SELECT resets.user_id FROM resets JOIN users ON users.id=resets.user_id WHERE token_hash=$1 AND resets.expires_at>now() AND users.status='active' FOR UPDATE",
    )
    .bind(crypto::digest(&input.token))
    .fetch_optional(&mut *transaction)
    .await?;
    let user = user.ok_or_else(|| Error::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_token"))?;
    sqlx::query(
        "UPDATE users SET password_hash=$1,credential_version=credential_version+1 WHERE id=$2",
    )
    .bind(hash)
    .bind(user)
    .execute(&mut *transaction)
    .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id=$1")
        .bind(user)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM resets WHERE user_id=$1")
        .bind(user)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    // Invalidate outstanding login transfers as well as existing sessions.
    sqlx::query("DELETE FROM handoffs WHERE tenant_id=$1 AND user_id=$2")
        .bind(tenant.id)
        .bind(user)
        .execute(&state.central)
        .await?;
    Ok(Json(json!({"reset": true})))
}

fn csrf_token(state: &State, session_hash: &str) -> String {
    crypto::digest(&format!(
        "{}:{session_hash}",
        hex::encode(&state.config.encryption_key)
    ))
}
