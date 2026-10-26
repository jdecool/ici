//! Tenant-scoped location and team HTTP adapters.
pub(crate) mod rules;
use crate::{
    identity::{Error, access, extract::JsonBody, http::tenant},
    tenancy::{http::Context, registry::State},
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

pub(crate) fn id(value: &str) -> Result<Uuid, Error> {
    Uuid::parse_str(value).map_err(|_| missing())
}
pub(crate) fn missing() -> Error {
    Error::new(StatusCode::NOT_FOUND, "not_found")
}
pub(crate) fn conflict() -> Error {
    Error::new(StatusCode::CONFLICT, "resource_in_use")
}
pub(crate) fn database(error: sqlx::Error) -> Error {
    match error
        .as_database_error()
        .and_then(|error| error.code())
        .as_deref()
    {
        Some("23505") => Error::new(StatusCode::CONFLICT, "already_exists"),
        Some("23503") => conflict(),
        _ => error.into(),
    }
}
#[derive(Deserialize)]
pub struct Location {
    name: String,
    code: String,
    #[serde(default)]
    city: String,
    #[serde(default)]
    address: String,
}
impl Location {
    fn validate(&mut self) -> Result<(), Error> {
        self.name = self.name.trim().into();
        self.code = self.code.trim().to_ascii_uppercase();
        self.city = self.city.trim().into();
        self.address = self.address.trim().into();
        if !crate::organization::rules::valid_name(&self.name) {
            return Err(Error::field("name"));
        }
        if !crate::organization::rules::valid_code(&self.code) {
            return Err(Error::field("code"));
        }
        if !crate::organization::rules::valid_detail(&self.city) {
            return Err(Error::field("city"));
        }
        if !crate::organization::rules::valid_detail(&self.address) {
            return Err(Error::field("address"));
        }
        Ok(())
    }
}
#[derive(Deserialize)]
pub struct Team {
    name: String,
}

pub async fn locations(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut connection = tenant.pool.acquire().await?;
    access::authorize(&mut connection, &headers, false, false).await?;
    let rows = sqlx::query("SELECT locations.*, (SELECT count(*) FROM users WHERE location_id=locations.id) AS members FROM locations ORDER BY name,id").fetch_all(&mut *connection).await?;
    Ok(Json(
        json!({"locations":rows.iter().map(|row| json!({"id":row.get::<Uuid,_>("id").to_string(),"name":row.get::<String,_>("name"),"code":row.get::<String,_>("code"),"city":row.get::<String,_>("city"),"address":row.get::<String,_>("address"),"members":row.get::<i64,_>("members")})).collect::<Vec<_>>()}),
    ))
}
pub async fn teams(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut connection = tenant.pool.acquire().await?;
    access::authorize(&mut connection, &headers, true, false).await?;
    let rows = sqlx::query("SELECT teams.*, (SELECT count(*) FROM users WHERE team_id=teams.id) AS members FROM teams ORDER BY name,id").fetch_all(&mut *connection).await?;
    Ok(Json(
        json!({"teams":rows.iter().map(|row| json!({"id":row.get::<Uuid,_>("id").to_string(),"name":row.get::<String,_>("name"),"members":row.get::<i64,_>("members")})).collect::<Vec<_>>()}),
    ))
}
async fn save_location(
    state: State,
    context: Context,
    headers: HeaderMap,
    value: Option<String>,
    mut input: Location,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut tx = tenant.pool.begin().await?;
    access::lock(&mut tx).await?;
    access::authorize(&mut tx, &headers, true, true).await?;
    input.validate()?;
    let key = value
        .as_deref()
        .map(id)
        .transpose()?
        .unwrap_or_else(Uuid::new_v4);
    let changed = if value.is_some() {
        sqlx::query("UPDATE locations SET name=$2,code=$3,city=$4,address=$5 WHERE id=$1")
            .bind(key)
            .bind(input.name)
            .bind(input.code)
            .bind(input.city)
            .bind(input.address)
            .execute(&mut *tx)
            .await?
    } else {
        sqlx::query("INSERT INTO locations (id,name,code,city,address) VALUES ($1,$2,$3,$4,$5)")
            .bind(key)
            .bind(input.name)
            .bind(input.code)
            .bind(input.city)
            .bind(input.address)
            .execute(&mut *tx)
            .await?
    };
    if changed.rows_affected() == 0 {
        return Err(missing());
    }
    tx.commit().await?;
    Ok(Json(json!({"id":key.to_string()})))
}
pub async fn create_location(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
    JsonBody(input): JsonBody<Location>,
) -> Result<Json<Value>, Error> {
    save_location(state, context, headers, None, input).await
}
pub async fn update_location(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
    Path(key): Path<String>,
    JsonBody(input): JsonBody<Location>,
) -> Result<Json<Value>, Error> {
    save_location(state, context, headers, Some(key), input).await
}
async fn save_team(
    state: State,
    context: Context,
    headers: HeaderMap,
    value: Option<String>,
    input: Team,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut tx = tenant.pool.begin().await?;
    access::lock(&mut tx).await?;
    access::authorize(&mut tx, &headers, true, true).await?;
    if !crate::organization::rules::valid_name(&input.name) {
        return Err(Error::field("name"));
    }
    let key = value
        .as_deref()
        .map(id)
        .transpose()?
        .unwrap_or_else(Uuid::new_v4);
    let changed = if value.is_some() {
        sqlx::query("UPDATE teams SET name=$2 WHERE id=$1")
            .bind(key)
            .bind(input.name.trim())
            .execute(&mut *tx)
            .await
    } else {
        sqlx::query("INSERT INTO teams (id,name) VALUES ($1,$2)")
            .bind(key)
            .bind(input.name.trim())
            .execute(&mut *tx)
            .await
    }
    .map_err(database)?;
    if changed.rows_affected() == 0 {
        return Err(missing());
    }
    tx.commit().await?;
    Ok(Json(json!({"id":key.to_string()})))
}
pub async fn create_team(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
    JsonBody(input): JsonBody<Team>,
) -> Result<Json<Value>, Error> {
    save_team(state, context, headers, None, input).await
}
pub async fn update_team(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
    Path(key): Path<String>,
    JsonBody(input): JsonBody<Team>,
) -> Result<Json<Value>, Error> {
    save_team(state, context, headers, Some(key), input).await
}
async fn remove(connection: &mut PgConnection, query: &str, key: &str) -> Result<(), Error> {
    if sqlx::query(query)
        .bind(id(key)?)
        .execute(connection)
        .await
        .map_err(database)?
        .rows_affected()
        == 0
    {
        return Err(missing());
    }
    Ok(())
}
pub async fn delete_location(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
    Path(key): Path<String>,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut tx = tenant.pool.begin().await?;
    access::lock(&mut tx).await?;
    access::authorize(&mut tx, &headers, true, true).await?;
    remove(&mut tx, "DELETE FROM locations WHERE id=$1", &key).await?;
    tx.commit().await?;
    Ok(Json(json!({"deleted":true})))
}
pub async fn delete_team(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
    Path(key): Path<String>,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut tx = tenant.pool.begin().await?;
    access::lock(&mut tx).await?;
    access::authorize(&mut tx, &headers, true, true).await?;
    remove(&mut tx, "DELETE FROM teams WHERE id=$1", &key).await?;
    tx.commit().await?;
    Ok(Json(json!({"deleted":true})))
}
