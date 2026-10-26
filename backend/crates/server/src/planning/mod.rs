//! Authenticated tenant planning adapters.
pub(crate) mod rules;
use crate::planning::rules::Date;
use crate::{
    identity::{Error, access, extract::JsonBody, http::tenant},
    organization::{database, missing},
    tenancy::{http::Context, registry::State},
};
use axum::{
    Extension, Json,
    extract::{RawQuery, State as ExtractState},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct Settings {
    work_days: Vec<i32>,
}
#[derive(Clone, Deserialize)]
pub struct Presence {
    status: String,
    location_id: Option<Uuid>,
    #[serde(default)]
    note: String,
}
#[derive(Deserialize)]
pub struct Entry {
    date: String,
    half: String,
    #[serde(flatten)]
    value: Presence,
}
#[derive(Deserialize)]
pub struct Entries {
    user_id: Uuid,
    entries: Vec<Entry>,
}
#[derive(Deserialize)]
pub struct TemplateEntry {
    weekday: i32,
    half: String,
    #[serde(flatten)]
    value: Presence,
}
#[derive(Deserialize)]
pub struct Template {
    entries: Vec<TemplateEntry>,
}
#[derive(Deserialize)]
pub struct Apply {
    start: String,
    weeks: u32,
}
fn date(value: &str) -> Result<Date, Error> {
    Date::parse(value).ok_or_else(|| Error::field("date"))
}
fn monday(value: &str) -> Result<Date, Error> {
    let day = date(value)?;
    if day.weekday() != 0 {
        return Err(Error::field("start"));
    }
    Ok(day)
}
fn half(value: &str) -> Result<(), Error> {
    if !matches!(value, "am" | "pm") {
        return Err(Error::field("half"));
    }
    Ok(())
}
async fn validate(connection: &mut PgConnection, value: &Presence) -> Result<(), Error> {
    if !crate::planning::rules::valid_presence(
        &value.status,
        value.location_id.is_some(),
        &value.note,
    ) {
        return Err(Error::field("presence"));
    }
    if let Some(location) = value.location_id {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT FROM locations WHERE id=$1)")
            .bind(location)
            .fetch_one(connection)
            .await?;
        if !exists {
            return Err(Error::field("location_id"));
        }
    }
    Ok(())
}
async fn work_days(connection: &mut PgConnection) -> Result<Vec<i32>, Error> {
    Ok(
        sqlx::query_scalar("SELECT work_days FROM planning_settings")
            .fetch_one(connection)
            .await?,
    )
}
fn presence(row: &sqlx::postgres::PgRow) -> Value {
    json!({"status":row.get::<String,_>("status"),"location_id":row.get::<Option<Uuid>,_>("location_id"),"note":row.get::<String,_>("note")})
}
pub async fn settings(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut connection = tenant.pool.acquire().await?;
    access::authorize(&mut connection, &headers, false, false).await?;
    Ok(Json(json!({"work_days":work_days(&mut connection).await?})))
}
pub async fn save_settings(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
    JsonBody(input): JsonBody<Settings>,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut tx = tenant.pool.begin().await?;
    access::lock(&mut tx).await?;
    access::authorize(&mut tx, &headers, true, true).await?;
    if !crate::planning::rules::valid_days(&input.work_days) {
        return Err(Error::field("work_days"));
    }
    sqlx::query("UPDATE planning_settings SET work_days=$1")
        .bind(input.work_days)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"updated":true})))
}
pub async fn week(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut tx = tenant.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await?;
    access::authorize(&mut tx, &headers, false, false).await?;
    let params: Vec<_> =
        url::form_urlencoded::parse(query.as_deref().unwrap_or_default().as_bytes()).collect();
    let start = params
        .iter()
        .find(|(k, _)| k == "start")
        .ok_or_else(|| Error::field("start"))?;
    let start = monday(&start.1)?;
    let end = start.plus(6).ok_or_else(|| Error::field("start"))?;
    let users = sqlx::query("SELECT id,first_name,last_name,team_id,location_id FROM users WHERE status='active' ORDER BY last_name,first_name,id").fetch_all(&mut *tx).await?;
    let teams = sqlx::query("SELECT id,name FROM teams ORDER BY name,id")
        .fetch_all(&mut *tx)
        .await?;
    let locations = sqlx::query("SELECT id,name,code,city FROM locations ORDER BY name,id")
        .fetch_all(&mut *tx)
        .await?;
    let entries = sqlx::query("SELECT p.*,p.date::text AS day FROM presence_entries p JOIN users u ON p.user_id=u.id WHERE u.status='active' AND p.date BETWEEN $1::text::date AND $2::text::date ORDER BY p.user_id,p.date,p.half")
        .bind(start.iso()).bind(end.iso()).fetch_all(&mut *tx).await?;
    let result = json!({"start":start.iso(),"work_days":work_days(&mut tx).await?,
        "users":users.iter().map(|r| json!({"id":r.get::<Uuid,_>("id"),"first_name":r.get::<String,_>("first_name"),"last_name":r.get::<String,_>("last_name"),"team_id":r.get::<Option<Uuid>,_>("team_id"),"location_id":r.get::<Option<Uuid>,_>("location_id")})).collect::<Vec<_>>(),
        "teams":teams.iter().map(|r| json!({"id":r.get::<Uuid,_>("id"),"name":r.get::<String,_>("name")})).collect::<Vec<_>>(),
        "locations":locations.iter().map(|r| json!({"id":r.get::<Uuid,_>("id"),"name":r.get::<String,_>("name"),"code":r.get::<String,_>("code"),"city":r.get::<String,_>("city")})).collect::<Vec<_>>(),
        "entries":entries.iter().map(|r| { let mut v=presence(r); v["user_id"]=json!(r.get::<Uuid,_>("user_id")); v["date"]=json!(r.get::<String,_>("day")); v["half"]=json!(r.get::<String,_>("half")); v }).collect::<Vec<_>>()});
    tx.commit().await?;
    Ok(Json(result))
}
async fn write_entry(
    connection: &mut PgConnection,
    user: Uuid,
    entry: &Entry,
) -> Result<(), Error> {
    if entry.value.status == "none" {
        sqlx::query(
            "DELETE FROM presence_entries WHERE user_id=$1 AND date=$2::text::date AND half=$3",
        )
        .bind(user)
        .bind(&entry.date)
        .bind(&entry.half)
        .execute(connection)
        .await?;
    } else {
        sqlx::query("INSERT INTO presence_entries(user_id,date,half,status,location_id,note) VALUES ($1,$2::text::date,$3,$4,$5,$6) ON CONFLICT(user_id,date,half) DO UPDATE SET status=EXCLUDED.status,location_id=EXCLUDED.location_id,note=EXCLUDED.note")
            .bind(user).bind(&entry.date).bind(&entry.half).bind(&entry.value.status).bind(entry.value.location_id).bind(entry.value.note.trim()).execute(connection).await.map_err(database)?;
    }
    Ok(())
}
pub async fn save_entries(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
    JsonBody(input): JsonBody<Entries>,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut tx = tenant.pool.begin().await?;
    access::lock(&mut tx).await?;
    let me = access::authorize(&mut tx, &headers, false, true).await?;
    if me != input.user_id {
        access::authorize(&mut tx, &headers, true, true).await?;
    }
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT FROM users WHERE id=$1 AND status='active')")
            .bind(input.user_id)
            .fetch_one(&mut *tx)
            .await?;
    if !exists {
        return Err(missing());
    }
    if input.entries.is_empty() || input.entries.len() > 56 {
        return Err(Error::field("entries"));
    }
    let mut slots = std::collections::BTreeSet::new();
    let mut dates = Vec::new();
    for e in &input.entries {
        dates.push(date(&e.date)?);
        half(&e.half)?;
        if !slots.insert((&e.date, &e.half)) {
            return Err(Error::field("entries"));
        }
        validate(&mut tx, &e.value).await?;
    }
    dates.sort();
    if let (Some(first), Some(last)) = (dates.first(), dates.last())
        && first.plus(27).is_some_and(|end| *last > end)
    {
        return Err(Error::field("entries"));
    }
    for e in &input.entries {
        write_entry(&mut tx, input.user_id, e).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"updated":true})))
}
pub async fn template(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut connection = tenant.pool.acquire().await?;
    let me = access::authorize(&mut connection, &headers, false, false).await?;
    let rows = sqlx::query(
        "SELECT *,''::text AS note FROM presence_templates WHERE user_id=$1 ORDER BY weekday,half",
    )
    .bind(me)
    .fetch_all(&mut *connection)
    .await?;
    Ok(Json(
        json!({"entries":rows.iter().map(|r| { let mut v=presence(r); v["weekday"]=json!(r.get::<i32,_>("weekday")); v["half"]=json!(r.get::<String,_>("half")); v }).collect::<Vec<_>>()}),
    ))
}
pub async fn save_template(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
    JsonBody(input): JsonBody<Template>,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut tx = tenant.pool.begin().await?;
    access::lock(&mut tx).await?;
    let me = access::authorize(&mut tx, &headers, false, true).await?;
    if input.entries.len() > 14 {
        return Err(Error::field("entries"));
    }
    let mut slots = std::collections::BTreeSet::new();
    for e in &input.entries {
        if !(0..=6).contains(&e.weekday) || !slots.insert((e.weekday, &e.half)) {
            return Err(Error::field("weekday"));
        }
        half(&e.half)?;
        validate(&mut tx, &e.value).await?;
    }
    sqlx::query("DELETE FROM presence_templates WHERE user_id=$1")
        .bind(me)
        .execute(&mut *tx)
        .await?;
    for e in input.entries.iter().filter(|e| e.value.status != "none") {
        sqlx::query("INSERT INTO presence_templates(user_id,weekday,half,status,location_id) VALUES ($1,$2,$3,$4,$5)")
            .bind(me).bind(e.weekday).bind(&e.half).bind(&e.value.status).bind(e.value.location_id).execute(&mut *tx).await.map_err(database)?;
    }
    tx.commit().await?;
    Ok(Json(json!({"updated":true})))
}
pub async fn apply_template(
    ExtractState(state): ExtractState<State>,
    Extension(context): Extension<Context>,
    headers: HeaderMap,
    JsonBody(input): JsonBody<Apply>,
) -> Result<Json<Value>, Error> {
    let tenant = tenant(&state, context).await?;
    let mut tx = tenant.pool.begin().await?;
    access::lock(&mut tx).await?;
    let me = access::authorize(&mut tx, &headers, false, true).await?;
    let start = monday(&input.start)?;
    if !matches!(input.weeks, 1 | 4) {
        return Err(Error::field("weeks"));
    }
    let days = work_days(&mut tx).await?;
    let rows = sqlx::query("SELECT * FROM presence_templates WHERE user_id=$1")
        .bind(me)
        .fetch_all(&mut *tx)
        .await?;
    for offset in 0..input.weeks * 7 {
        let day = start.plus(offset).ok_or_else(|| Error::field("start"))?;
        if !days.contains(&(day.weekday() as i32)) {
            continue;
        }
        for h in ["am", "pm"] {
            let row = rows.iter().find(|r| {
                r.get::<i32, _>("weekday") == day.weekday() as i32
                    && r.get::<String, _>("half") == h
            });
            let value = match row {
                Some(r) => Presence {
                    status: r.get("status"),
                    location_id: r.get("location_id"),
                    note: String::new(),
                },
                None => Presence {
                    status: "none".into(),
                    location_id: None,
                    note: String::new(),
                },
            };
            write_entry(
                &mut tx,
                me,
                &Entry {
                    date: day.iso(),
                    half: h.into(),
                    value,
                },
            )
            .await?;
        }
    }
    tx.commit().await?;
    Ok(Json(json!({"updated":true})))
}
