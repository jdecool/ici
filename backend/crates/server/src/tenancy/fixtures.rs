//! Explicit local demonstration data; never loaded by ordinary provisioning.
use super::{registry::State, worker};
use crate::identity::{Error, crypto, rules::TERMS_VERSION};
use sqlx::{Connection, PgConnection, PgPool, Row, postgres::PgConnectOptions};
use std::str::FromStr;
use uuid::Uuid;

pub async fn load(state: &State, admin: &PgPool, admin_url: &str) -> Result<(), Error> {
    // A dedicated connection releases the worker lock even if loading fails.
    let mut guard = PgConnection::connect(admin_url).await?;
    sqlx::query("SELECT pg_advisory_lock(74829311)")
        .execute(&mut guard)
        .await?;
    let row = sqlx::query("INSERT INTO tenants(id,slug,state,terms_version,receipt_hash) VALUES ($1,'acme','queued',$2,$3) ON CONFLICT(slug) DO UPDATE SET updated_at=now() RETURNING *,consent_at::text AS consent_text")
        .bind(Uuid::new_v4()).bind(TERMS_VERSION).bind(crypto::digest(&crypto::token())).fetch_one(admin).await?;
    let id: Uuid = row.get("id");
    worker::provision(state, admin, admin_url, &row).await?;
    let options =
        PgConnectOptions::from_str(admin_url)?.database(&format!("ici_t_{}", id.simple()));
    let mut connection = PgConnection::connect_with(&options).await?;
    let mut tx = connection.begin().await?;
    sqlx::raw_sql("TRUNCATE presence_entries,presence_templates,planning_settings,sessions,resets,invitations,email_changes,outbox,consents,users,teams,locations,company; INSERT INTO planning_settings DEFAULT VALUES;").execute(&mut *tx).await?;
    sqlx::query("INSERT INTO company(id,name) VALUES ($1,'ACME')")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    for (name, code, city, address) in [
        (
            "Paris - Siège",
            "PAR",
            "Paris",
            "10 rue de la Paix, 75002 Paris",
        ),
        (
            "Lyon - Confluence",
            "CON",
            "Lyon",
            "112 cours Charlemagne, 69002 Lyon",
        ),
        (
            "Lyon - Part Dieu",
            "LPD",
            "Lyon",
            "5 place Charles Béraudier, 69003 Lyon",
        ),
    ] {
        sqlx::query("INSERT INTO locations(id,name,code,city,address) VALUES ($1,$2,$3,$4,$5)")
            .bind(Uuid::new_v4())
            .bind(name)
            .bind(code)
            .bind(city)
            .bind(address)
            .execute(&mut *tx)
            .await?;
    }
    let locations: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM locations ORDER BY code")
        .fetch_all(&mut *tx)
        .await?;
    for (index, (first, last, email)) in [
        ("Alice", "Martin", "admin@example.com"),
        ("Lucas", "Bernard", "user@example.com"),
        ("Emma", "Dubois", "emma.dubois@example.com"),
        ("Hugo", "Thomas", "hugo.thomas@example.com"),
        ("Chloé", "Robert", "chloe.robert@example.com"),
        ("Louis", "Richard", "louis.richard@example.com"),
        ("Léa", "Petit", "lea.petit@example.com"),
        ("Gabriel", "Durand", "gabriel.durand@example.com"),
        ("Manon", "Leroy", "manon.leroy@example.com"),
        ("Raphaël", "Moreau", "raphael.moreau@example.com"),
    ]
    .into_iter()
    .enumerate()
    {
        let user = Uuid::new_v4();
        let hash = crypto::hash_password("password".into()).await?;
        sqlx::query("INSERT INTO users(id,email,first_name,last_name,password_hash,role,location_id) VALUES ($1,$2,$3,$4,$5,$6,$7)").bind(user).bind(email).bind(first).bind(last).bind(&hash).bind(if index == 0 { "admin" } else { "collaborator" }).bind(locations[index % locations.len()]).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO consents(user_id,version,accepted_at) VALUES ($1,$2,now())")
            .bind(user)
            .bind(TERMS_VERSION)
            .execute(&mut *tx)
            .await?;
        sqlx::query("WITH slots AS MATERIALIZED (SELECT date_trunc('week',now() AT TIME ZONE 'Europe/Paris')::date + day AS date, half, random() AS chance FROM generate_series(-14,20) day CROSS JOIN (VALUES ('am'),('pm')) halves(half) WHERE extract(isodow FROM date_trunc('week',now() AT TIME ZONE 'Europe/Paris')::date + day)<=5), statuses AS (SELECT *,CASE WHEN chance<0.65 THEN 'office' WHEN chance<0.85 THEN 'remote' WHEN chance<0.95 THEN 'travel' ELSE 'off' END AS status FROM slots) INSERT INTO presence_entries(user_id,date,half,status,location_id) SELECT $1,date,half,status,CASE WHEN status='office' THEN $2::uuid ELSE NULL END FROM statuses")
            .bind(user).bind(locations[index % locations.len()]).execute(&mut *tx).await?;
        // Ensure every location has past and future office presence regardless of randomness.
        sqlx::query("INSERT INTO presence_entries(user_id,date,half,status,location_id) SELECT $1,date_trunc('week',now() AT TIME ZONE 'Europe/Paris')::date + day,'am','office',$2 FROM (VALUES (-7),(7)) days(day) ON CONFLICT(user_id,date,half) DO UPDATE SET status='office',location_id=EXCLUDED.location_id").bind(user).bind(locations[index % locations.len()]).execute(&mut *tx).await?;
    }
    sqlx::query("DELETE FROM handoffs WHERE tenant_id=$1")
        .bind(id)
        .execute(admin)
        .await?;
    tx.commit().await?;
    sqlx::query("UPDATE tenants SET state='active',first_name=NULL,last_name=NULL,email=NULL,password_hash=NULL,verification_hash=NULL,updated_at=now() WHERE id=$1").bind(id).execute(admin).await?;
    tracing::info!("ACME fixtures loaded: 10 users, 3 locations, 5 weeks of presence");
    guard.close().await?;
    Ok(())
}
