//! Account administration, invitation acceptance and verified email changes.
use super::{Error, access, crypto, extract::JsonBody, http::tenant};
use crate::{
    organization::{database, id, missing},
    tenancy::{
        http::Context,
        registry::{State, Tenant, enqueue},
    },
};
use axum::{
    Extension, Json,
    extract::{Path, State as ExtractState},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct Member {
    first_name: String,
    last_name: String,
    email: String,
    role: String,
    team_id: Option<String>,
    location_id: Option<String>,
    status: Option<String>,
}
impl Member {
    fn validate(&mut self) -> Result<(), Error> {
        self.first_name = self.first_name.trim().into();
        self.last_name = self.last_name.trim().into();
        if !crate::identity::rules::valid_name(&self.first_name) {
            return Err(Error::field("first_name"));
        }
        if !crate::identity::rules::valid_name(&self.last_name) {
            return Err(Error::field("last_name"));
        }
        self.email = crate::identity::rules::normalize_email(&self.email)
            .ok_or_else(|| Error::field("email"))?;
        if !matches!(self.role.as_str(), "admin" | "collaborator") {
            return Err(Error::field("role"));
        }
        if self
            .status
            .as_ref()
            .is_some_and(|status| !matches!(status.as_str(), "active" | "inactive" | "pending"))
        {
            return Err(Error::field("status"));
        }
        Ok(())
    }
}
async fn available(connection: &mut PgConnection, email: &str, user: Uuid) -> Result<(), Error> {
    let taken: bool=sqlx::query_scalar("SELECT EXISTS(SELECT FROM users WHERE email=$1 AND id<>$2 UNION ALL SELECT FROM email_changes WHERE email=$1 AND user_id<>$2 AND expires_at>now())")
        .bind(email).bind(user).fetch_one(connection).await?;
    if taken {
        return Err(Error::new(StatusCode::CONFLICT, "email_unavailable"));
    }
    Ok(())
}
async fn references(
    connection: &mut PgConnection,
    input: &Member,
) -> Result<(Option<Uuid>, Option<Uuid>), Error> {
    let team = input
        .team_id
        .as_deref()
        .map(id)
        .transpose()
        .map_err(|_| Error::field("team_id"))?;
    let location = input
        .location_id
        .as_deref()
        .map(id)
        .transpose()
        .map_err(|_| Error::field("location_id"))?;
    for (query, key, field) in [
        (
            "SELECT EXISTS(SELECT FROM teams WHERE id=$1)",
            team,
            "team_id",
        ),
        (
            "SELECT EXISTS(SELECT FROM locations WHERE id=$1)",
            location,
            "location_id",
        ),
    ] {
        if let Some(key) = key
            && !sqlx::query_scalar::<_, bool>(query)
                .bind(key)
                .fetch_one(&mut *connection)
                .await?
        {
            return Err(Error::field(field));
        }
    }
    Ok((team, location))
}
async fn invite(
    connection: &mut PgConnection,
    state: &State,
    tenant: &Tenant,
    user: Uuid,
    email: &str,
) -> Result<(), Error> {
    let token = crypto::token();
    sqlx::query("INSERT INTO invitations (user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '48 hours') ON CONFLICT (user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at")
        .bind(user).bind(crypto::digest(&token)).execute(&mut *connection).await?;
    enqueue(connection,state,email,"Invitation à rejoindre votre entreprise — Ici",&format!("Choisissez votre mot de passe et acceptez les conditions pour rejoindre votre entreprise :\n{}/accept-invitation#token={token}\nCe lien expire dans 48 heures.",state.config.tenant_origin(&tenant.slug))).await
}
async fn revoke(connection: &mut PgConnection, user: Uuid) -> Result<(), Error> {
    sqlx::query("UPDATE users SET credential_version=credential_version+1 WHERE id=$1")
        .bind(user)
        .execute(&mut *connection)
        .await?;
    for query in [
        "DELETE FROM sessions WHERE user_id=$1",
        "DELETE FROM resets WHERE user_id=$1",
    ] {
        sqlx::query(query)
            .bind(user)
            .execute(&mut *connection)
            .await?;
    }
    // Handoffs carry credential_version, so the tenant transaction invalidates them atomically.
    Ok(())
}
pub async fn list(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut connection = tenant.pool.acquire().await?;
    access::authorize(&mut connection, &headers, true, false).await?;
    let rows=sqlx::query("SELECT users.*,email_changes.email AS pending_email FROM users LEFT JOIN email_changes ON email_changes.user_id=users.id AND email_changes.expires_at>now() ORDER BY last_name,first_name,users.id").fetch_all(&mut *connection).await?;
    Ok(Json(
        json!({"users":rows.iter().map(|row| json!({"id":row.get::<Uuid,_>("id").to_string(),"first_name":row.get::<String,_>("first_name"),"last_name":row.get::<String,_>("last_name"),"email":row.get::<String,_>("email"),"pending_email":row.get::<Option<String>,_>("pending_email"),"role":row.get::<String,_>("role"),"status":row.get::<String,_>("status"),"team_id":row.get::<Option<Uuid>,_>("team_id").map(|id| id.to_string()),"location_id":row.get::<Option<Uuid>,_>("location_id").map(|id| id.to_string())})).collect::<Vec<_>>()}),
    ))
}
pub async fn create(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
    JsonBody(mut input): JsonBody<Member>,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut tx = tenant.pool.begin().await?;
    access::lock(&mut tx).await?;
    access::authorize(&mut tx, &headers, true, true).await?;
    input.validate()?;
    if input
        .status
        .as_deref()
        .is_some_and(|status| status != "pending")
    {
        return Err(Error::field("status"));
    }
    let key = Uuid::new_v4();
    available(&mut tx, &input.email, key).await?;
    let (team, location) = references(&mut tx, &input).await?;
    sqlx::query("INSERT INTO users (id,first_name,last_name,email,role,status,team_id,location_id) VALUES ($1,$2,$3,$4,$5,'pending',$6,$7)")
        .bind(key).bind(input.first_name).bind(input.last_name).bind(&input.email).bind(input.role).bind(team).bind(location).execute(&mut *tx).await.map_err(database)?;
    invite(&mut tx, &state, &tenant, key, &input.email).await?;
    tx.commit().await?;
    Ok(Json(json!({"id":key.to_string()})))
}
pub async fn update(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
    Path(key): Path<String>,
    JsonBody(mut input): JsonBody<Member>,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut tx = tenant.pool.begin().await?;
    access::lock(&mut tx).await?;
    access::authorize(&mut tx, &headers, true, true).await?;
    input.validate()?;
    let key = id(&key)?;
    let old = sqlx::query("SELECT * FROM users WHERE id=$1")
        .bind(key)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(missing)?;
    let old_status: String = old.get("status");
    let old_role: String = old.get("role");
    let old_email: String = old.get("email");
    let activated = old.get::<Option<String>, _>("password_hash").is_some();
    let requested = input.status.as_deref().unwrap_or(&old_status);
    let status = match (activated, requested) {
        (true, "pending") => return Err(Error::field("status")),
        (false, "active") => "pending",
        (_, value) => value,
    };
    if old_status == "active"
        && old_role == "admin"
        && (status != "active" || input.role != "admin")
    {
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM users WHERE role='admin' AND status='active'")
                .fetch_one(&mut *tx)
                .await?;
        if count == 1 {
            return Err(Error::new(StatusCode::CONFLICT, "last_administrator"));
        }
    }
    available(&mut tx, &input.email, key).await?;
    let (team, location) = references(&mut tx, &input).await?;
    sqlx::query("DELETE FROM email_changes WHERE expires_at<=now()")
        .execute(&mut *tx)
        .await?;
    let pending: Option<String> =
        sqlx::query_scalar("SELECT email FROM email_changes WHERE user_id=$1 AND expires_at>now()")
            .bind(key)
            .fetch_optional(&mut *tx)
            .await?;
    if input.email != old_email && pending.as_deref() != Some(input.email.as_str()) {
        if activated && status != "inactive" {
            let token = crypto::token();
            sqlx::query("INSERT INTO email_changes (user_id,email,token_hash,expires_at) VALUES ($1,$2,$3,now()+interval '24 hours') ON CONFLICT (user_id) DO UPDATE SET email=excluded.email,token_hash=excluded.token_hash,expires_at=excluded.expires_at")
                .bind(key).bind(&input.email).bind(crypto::digest(&token)).execute(&mut *tx).await.map_err(database)?;
            enqueue(&mut tx,&state,&input.email,"Confirmez votre nouvelle adresse email — Ici",&format!("Confirmez votre nouvelle adresse :\n{}/confirm-email#token={token}\nCe lien expire dans 24 heures.",state.config.tenant_origin(&tenant.slug))).await?;
            enqueue(&mut tx,&state,&old_email,"Changement d’adresse email demandé — Ici","Une modification de votre adresse email a été demandée. Contactez votre administrateur si vous n’êtes pas à l’origine de cette demande.").await?;
        } else if !activated {
            sqlx::query("UPDATE users SET email=$2 WHERE id=$1")
                .bind(key)
                .bind(&input.email)
                .execute(&mut *tx)
                .await
                .map_err(database)?;
        } else {
            return Err(Error::field("email"));
        }
    } else if input.email == old_email {
        sqlx::query("DELETE FROM email_changes WHERE user_id=$1")
            .bind(key)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("UPDATE users SET first_name=$2,last_name=$3,role=$4,status=$5,team_id=$6,location_id=$7 WHERE id=$1")
        .bind(key).bind(input.first_name).bind(input.last_name).bind(input.role).bind(status).bind(team).bind(location).execute(&mut *tx).await?;
    if status == "inactive" {
        revoke(&mut tx, key).await?;
        for query in [
            "DELETE FROM invitations WHERE user_id=$1",
            "DELETE FROM email_changes WHERE user_id=$1",
        ] {
            sqlx::query(query).bind(key).execute(&mut *tx).await?;
        }
    } else if !activated && (input.email != old_email || old_status == "inactive") {
        invite(&mut tx, &state, &tenant, key, &input.email).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"updated":true})))
}
pub async fn resend(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
    Path(key): Path<String>,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut tx = tenant.pool.begin().await?;
    access::lock(&mut tx).await?;
    access::authorize(&mut tx, &headers, true, true).await?;
    let key = id(&key)?;
    state
        .limit(&format!("invite:{}:{key}", tenant.id), 5)
        .await?;
    let email: String =
        sqlx::query_scalar("SELECT email FROM users WHERE id=$1 AND status='pending'")
            .bind(key)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(missing)?;
    invite(&mut tx, &state, &tenant, key, &email).await?;
    tx.commit().await?;
    Ok(Json(json!({"sent":true})))
}
#[derive(Deserialize)]
pub struct Acceptance {
    token: String,
    password: String,
    accepted_terms: bool,
    terms_version: String,
}
pub async fn accept(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    JsonBody(input): JsonBody<Acceptance>,
) -> Result<Json<Value>, Error> {
    if !crate::identity::rules::valid_password(&input.password) {
        return Err(Error::field("password"));
    }
    if !input.accepted_terms || input.terms_version != crate::identity::rules::TERMS_VERSION {
        return Err(Error::field("accepted_terms"));
    }
    let tenant = tenant(&state, context).await?;
    state.limit(&format!("accept:{}", tenant.id), 30).await?;
    let hash = crypto::hash_password(input.password).await?;
    let mut tx = tenant.pool.begin().await?;
    access::lock(&mut tx).await?;
    let key: Uuid=sqlx::query_scalar("SELECT invitations.user_id FROM invitations JOIN users ON users.id=invitations.user_id WHERE token_hash=$1 AND expires_at>now() AND users.status='pending'")
        .bind(crypto::digest(&input.token)).fetch_optional(&mut *tx).await?.ok_or_else(invalid_token)?;
    sqlx::query("UPDATE users SET password_hash=$2,status='active',credential_version=credential_version+1 WHERE id=$1").bind(key).bind(hash).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO consents (user_id,version,accepted_at) VALUES ($1,$2,now())")
        .bind(key)
        .bind(crate::identity::rules::TERMS_VERSION)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM invitations WHERE user_id=$1")
        .bind(key)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"activated":true})))
}
#[derive(Deserialize)]
pub struct Confirmation {
    token: String,
}
fn invalid_token() -> Error {
    Error::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_token")
}
pub async fn confirm_email(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    JsonBody(input): JsonBody<Confirmation>,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut tx = tenant.pool.begin().await?;
    access::lock(&mut tx).await?;
    let row=sqlx::query("SELECT email_changes.user_id,email_changes.email FROM email_changes JOIN users ON users.id=email_changes.user_id WHERE token_hash=$1 AND expires_at>now() AND users.status='active'")
        .bind(crypto::digest(&input.token)).fetch_optional(&mut *tx).await?.ok_or_else(invalid_token)?;
    let key: Uuid = row.get("user_id");
    let email: String = row.get("email");
    available(&mut tx, &email, key).await?;
    sqlx::query("UPDATE users SET email=$2 WHERE id=$1")
        .bind(key)
        .bind(email)
        .execute(&mut *tx)
        .await
        .map_err(database)?;
    revoke(&mut tx, key).await?;
    sqlx::query("DELETE FROM email_changes WHERE user_id=$1")
        .bind(key)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"confirmed":true})))
}

#[cfg(test)]
mod validation_tests {
    use super::*;

    fn member() -> Member {
        Member {
            first_name: " Camille ".into(),
            last_name: " Durand ".into(),
            email: " OWNER@example.com ".into(),
            role: "collaborator".into(),
            team_id: None,
            location_id: None,
            status: None,
        }
    }

    #[test]
    fn normalizes_names_and_email_and_accepts_supported_roles_and_statuses() -> Result<(), Error> {
        for role in ["admin", "collaborator"] {
            for status in [None, Some("active"), Some("inactive"), Some("pending")] {
                let mut value = member();
                value.role = role.into();
                value.status = status.map(String::from);
                value.validate()?;
                assert_eq!(value.first_name, "Camille");
                assert_eq!(value.last_name, "Durand");
                assert_eq!(value.email, "owner@example.com");
            }
        }
        Ok(())
    }

    #[test]
    fn rejects_invalid_member_fields() {
        for field in ["first_name", "last_name", "email", "role", "status"] {
            let mut value = member();
            match field {
                "first_name" => value.first_name = " ".into(),
                "last_name" => value.last_name = " ".into(),
                "email" => value.email = "invalid".into(),
                "role" => value.role = "owner".into(),
                _ => value.status = Some("unknown".into()),
            }
            let Err(error) = value.validate() else {
                panic!("Invalid {field} must be rejected");
            };
            assert_eq!(error.code, "invalid_input");
            assert_eq!(error.fields, json!({field: "invalid"}));
        }
    }
}
