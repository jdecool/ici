//! Privileged background operations. Never called by an HTTP handler.
use crate::{
    config::{Config, setting},
    identity::{Error, crypto},
    tenancy::registry::State,
};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    transport::smtp::authentication::Credentials,
};
use sqlx::{
    Connection, PgConnection, PgPool, Row,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use std::str::FromStr;
use uuid::Uuid;

pub static CENTRAL_MIGRATIONS: sqlx::migrate::Migrator = sqlx::migrate!("./migrations/central");
pub static TENANT_MIGRATIONS: sqlx::migrate::Migrator = sqlx::migrate!("./migrations/tenant");

pub async fn initialize(config: &Config, admin_url: &str) -> Result<PgPool, Error> {
    let admin = PgPoolOptions::new()
        .max_connections(3)
        .connect(admin_url)
        .await?;
    CENTRAL_MIGRATIONS
        .run(&admin)
        .await
        .map_err(Error::internal_from)?;
    let app = url::Url::parse(&config.central_url).map_err(Error::internal_from)?;
    let name = app.username();
    if name != "ici_registry" {
        return Err(Error::internal());
    }
    let password = app.password().ok_or_else(Error::internal)?;
    let escaped = password.replace('\'', "''");
    if !sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT FROM pg_roles WHERE rolname=$1)")
        .bind(name)
        .fetch_one(&admin)
        .await?
    {
        sqlx::query(&format!("CREATE ROLE ici_registry LOGIN PASSWORD '{escaped}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT")).execute(&admin).await?;
    }
    sqlx::raw_sql("REVOKE CONNECT ON DATABASE postgres,template1 FROM PUBLIC; REVOKE ALL ON DATABASE ici FROM PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT CONNECT ON DATABASE ici TO ici_registry; GRANT USAGE ON SCHEMA public TO ici_registry; GRANT SELECT,INSERT,UPDATE,DELETE ON tenants,outbox,handoffs,rate_limits TO ici_registry;").execute(&admin).await?;
    Ok(admin)
}

pub async fn tick(
    state: &State,
    admin: &PgPool,
    admin_url: &str,
    migrate_all: bool,
) -> Result<(), Error> {
    // A session advisory lock serializes privileged DDL across worker instances.
    let mut guard = admin.acquire().await?;
    if migrate_all {
        sqlx::query("SELECT pg_advisory_lock(74829311)")
            .execute(&mut *guard)
            .await?;
    } else {
        let acquired: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock(74829311)")
            .fetch_one(&mut *guard)
            .await?;
        if !acquired {
            return Ok(());
        }
    }
    let result = work(state, admin, admin_url, migrate_all).await;
    sqlx::query("SELECT pg_advisory_unlock(74829311)")
        .execute(&mut *guard)
        .await?;
    result
}
async fn work(
    state: &State,
    admin: &PgPool,
    admin_url: &str,
    migrate_all: bool,
) -> Result<(), Error> {
    let rows = sqlx::query("SELECT *,consent_at::text AS consent_text FROM tenants WHERE (state IN ('queued','provisioning','failed') AND retry_at<=now()) OR ($1 AND state='active') ORDER BY updated_at LIMIT CASE WHEN $1 THEN NULL ELSE 20 END").bind(migrate_all).fetch_all(admin).await?;
    for row in rows {
        let id: Uuid = row.get("id");
        let was_active = row.get::<String, _>("state") == "active";
        if !was_active {
            sqlx::query("UPDATE tenants SET state='provisioning', updated_at=now() WHERE id=$1")
                .bind(id)
                .execute(admin)
                .await?;
        }
        let result = provision(state, admin, admin_url, &row).await;
        match result {
            Ok(()) => {
                sqlx::query("UPDATE tenants SET state='active',first_name=NULL,last_name=NULL,email=NULL,password_hash=NULL,updated_at=now() WHERE id=$1").bind(id).execute(admin).await?;
                tracing::info!(tenant_id=%id, "Tenant ready");
            }
            Err(_) => {
                if !was_active {
                    sqlx::query("UPDATE tenants SET state='failed', attempts=attempts+1,retry_at=now()+make_interval(secs=>LEAST(3600, power(2,LEAST(attempts,10))::int * 5)),updated_at=now() WHERE id=$1").bind(id).execute(admin).await?;
                }
                tracing::error!(tenant_id=%id, "Tenant provisioning failed; retry scheduled");
                if migrate_all {
                    return Err(Error::internal());
                }
            }
        }
    }
    send_outbox(state, admin).await?;
    let slugs: Vec<String> = sqlx::query_scalar("SELECT slug FROM tenants WHERE state='active'")
        .fetch_all(admin)
        .await?;
    for slug in slugs {
        let tenant = state.tenant(&slug).await?;
        send_outbox(state, &tenant.pool).await?;
    }
    sqlx::raw_sql("DELETE FROM handoffs WHERE expires_at<now(); DELETE FROM rate_limits WHERE expires_at<now(); DELETE FROM tenants WHERE state='pending' AND expires_at<now();").execute(admin).await?;
    Ok(())
}
pub(super) async fn provision(
    state: &State,
    admin: &PgPool,
    admin_url: &str,
    row: &sqlx::postgres::PgRow,
) -> Result<(), Error> {
    let id: Uuid = row.get("id");
    let identifier = format!("ici_t_{}", id.simple());
    // Persist the encrypted credential before any DDL, so every interrupted step is resumable.
    let existing: Option<String> = row.get("database_secret");
    let secret = match existing {
        Some(secret) => secret,
        None => {
            let mut url = url::Url::parse(
                &setting("TENANT_DATABASE_BASE_URL").map_err(Error::internal_from)?,
            )
            .map_err(Error::internal_from)?;
            url.set_username(&identifier)
                .map_err(Error::internal_from)?;
            url.set_password(Some(&crypto::token()))
                .map_err(Error::internal_from)?;
            url.set_path(&identifier);
            let secret = crypto::encrypt(&state.config.encryption_key, url.as_str())?;
            sqlx::query("UPDATE tenants SET database_secret=$1 WHERE id=$2")
                .bind(&secret)
                .bind(id)
                .execute(admin)
                .await?;
            secret
        }
    };
    let connection_url = crypto::decrypt(&state.config.encryption_key, &secret)?;
    let url = url::Url::parse(&connection_url).map_err(Error::internal_from)?;
    let password = url.password().ok_or_else(Error::internal)?;
    let role_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT FROM pg_roles WHERE rolname=$1)")
            .bind(&identifier)
            .fetch_one(admin)
            .await?;
    if !role_exists {
        sqlx::query(&format!("CREATE ROLE {identifier} LOGIN PASSWORD '{}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT", password.replace('\'', "''"))).execute(admin).await?;
    }
    let database_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT FROM pg_database WHERE datname=$1)")
            .bind(&identifier)
            .fetch_one(admin)
            .await?;
    if !database_exists {
        // CREATE DATABASE cannot run inside a transaction.
        sqlx::query(&format!("CREATE DATABASE {identifier}"))
            .execute(admin)
            .await?;
    }
    sqlx::raw_sql(&format!("REVOKE ALL ON DATABASE {identifier} FROM PUBLIC; GRANT CONNECT ON DATABASE {identifier} TO {identifier};")).execute(admin).await?;
    let options = PgConnectOptions::from_str(admin_url)?.database(&identifier);
    let mut connection = PgConnection::connect_with(&options).await?;
    TENANT_MIGRATIONS
        .run(&mut connection)
        .await
        .map_err(Error::internal_from)?;
    sqlx::raw_sql(&format!("REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO {identifier}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO {identifier}; REVOKE ALL ON _sqlx_migrations FROM {identifier};")).execute(&mut connection).await?;
    let mut transaction = connection.begin().await?;
    if let Some(email) = row.get::<Option<String>, _>("email") {
        sqlx::query("INSERT INTO company (id,name) VALUES ($1,$2) ON CONFLICT DO NOTHING")
            .bind(id)
            .bind(row.get::<String, _>("slug"))
            .execute(&mut *transaction)
            .await?;
        sqlx::query("INSERT INTO users (id,email,first_name,last_name,password_hash,role) VALUES ($1,$2,$3,$4,$5,'admin') ON CONFLICT DO NOTHING").bind(id).bind(email).bind(row.get::<String,_>("first_name")).bind(row.get::<String,_>("last_name")).bind(row.get::<String,_>("password_hash")).execute(&mut *transaction).await?;
        sqlx::query("INSERT INTO consents (user_id,version,accepted_at) SELECT $1,$2,consent_at FROM (SELECT $3::timestamptz AS consent_at) consent ON CONFLICT DO NOTHING")
            .bind(id).bind(row.get::<String,_>("terms_version")).bind(row.get::<String,_>("consent_text")).execute(&mut *transaction).await?;
    }
    transaction.commit().await?;
    connection.close().await?;
    Ok(())
}
async fn send_outbox(state: &State, admin: &PgPool) -> Result<(), Error> {
    let host = setting("SMTP_HOST").map_err(Error::internal_from)?;
    let port: u16 = setting("SMTP_PORT")
        .map_err(Error::internal_from)?
        .parse()
        .map_err(Error::internal_from)?;
    let mut builder = if setting("SMTP_TLS").is_ok_and(|value| value == "false") {
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host)
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host).map_err(Error::internal_from)?
    }
    .port(port);
    if let Ok(username) = setting("SMTP_USERNAME")
        && !username.is_empty()
    {
        builder = builder.credentials(Credentials::new(
            username,
            setting("SMTP_PASSWORD").map_err(Error::internal_from)?,
        ));
    }
    let transport = builder.build();
    for row in sqlx::query(
        "SELECT id,payload FROM outbox WHERE retry_at<=now() ORDER BY retry_at LIMIT 20",
    )
    .fetch_all(admin)
    .await?
    {
        let id: Uuid = row.get("id");
        let payload = crypto::decrypt(
            &state.config.encryption_key,
            &row.get::<String, _>("payload"),
        )?;
        let payload: serde_json::Value =
            serde_json::from_str(&payload).map_err(Error::internal_from)?;
        let text = |field: &str| payload[field].as_str().ok_or_else(Error::internal);
        let message = Message::builder()
            .from(
                setting("SMTP_FROM")
                    .map_err(Error::internal_from)?
                    .parse()
                    .map_err(Error::internal_from)?,
            )
            .to(text("email")?.parse().map_err(Error::internal_from)?)
            .subject(text("subject")?)
            .header(lettre::message::header::ContentType::TEXT_PLAIN)
            .body(text("body")?.to_owned())
            .map_err(Error::internal_from)?;
        if transport.send(message).await.is_ok() {
            sqlx::query("DELETE FROM outbox WHERE id=$1")
                .bind(id)
                .execute(admin)
                .await?;
        } else {
            sqlx::query("UPDATE outbox SET attempts=attempts+1,retry_at=now()+make_interval(secs=>LEAST(3600,power(2,LEAST(attempts,10))::int*5)) WHERE id=$1").bind(id).execute(admin).await?;
            tracing::warn!(message_id=%id, "SMTP delivery failed; retry scheduled");
        }
    }
    Ok(())
}
