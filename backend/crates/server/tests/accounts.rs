//! Real PostgreSQL contracts. The tools stack supplies an isolated database server.
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use http_body_util::BodyExt;
use ici_server::{
    application,
    config::Config,
    identity::{Error, crypto},
    tenancy::{registry::State, worker},
};
use serde_json::{Value, json};
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use tower::ServiceExt;
use uuid::Uuid;

mod organization;
mod planning;

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
const ROOT: &str = "ici.localhost:5173";
const PASSWORD: &str = "A secure pass phrase1!";
async fn call(
    app: &Router,
    method: &str,
    path: &str,
    host: &str,
    body: Option<Value>,
    extra: &[(&str, &str)],
) -> TestResult<Response> {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("host", host);
    if method != "GET" && !extra.iter().any(|(name, _)| *name == "origin") {
        request = request.header("origin", format!("http://{host}"));
    }
    for (key, value) in extra {
        request = request.header(*key, *value);
    }
    let body = if let Some(body) = body {
        request = request.header("content-type", "application/json");
        Body::from(body.to_string())
    } else {
        Body::empty()
    };
    Ok(app.clone().oneshot(request.body(body)?).await?)
}
async fn data(response: Response) -> TestResult<Value> {
    Ok(serde_json::from_slice(
        &response.into_body().collect().await?.to_bytes(),
    )?)
}
fn registration(slug: &str) -> Value {
    json!({"slug":slug,"email":"owner@example.com","password":PASSWORD,"first_name":"Camille","last_name":"Durand","accepted_terms":true,"terms_version":ici_server::identity::TERMS_VERSION})
}
async fn queued_token(admin: &PgPool, key: &[u8], subject: &str) -> TestResult<String> {
    for row in sqlx::query("SELECT payload FROM outbox ORDER BY retry_at DESC")
        .fetch_all(admin)
        .await?
    {
        let payload = crypto::decrypt(key, &row.get::<String, _>("payload"))?;
        let payload: Value = serde_json::from_str(&payload)?;
        if payload["subject"]
            .as_str()
            .is_some_and(|value| value.contains(subject))
        {
            return Ok(payload["body"]
                .as_str()
                .ok_or("missing body")?
                .split("#token=")
                .nth(1)
                .ok_or("missing token")?
                .split_whitespace()
                .next()
                .ok_or("empty token")?
                .into());
        }
    }
    Err("missing email".into())
}
async fn login(app: &Router, slug: &str, password: &str) -> TestResult<String> {
    let response = call(
        app,
        "POST",
        "/api/auth/login",
        ROOT,
        Some(json!({"slug":slug,"email":"owner@example.com","password":password,"remember":true})),
        &[],
    )
    .await?;
    assert_eq!(response.status(), StatusCode::OK);
    Ok(data(response).await?["code"]
        .as_str()
        .ok_or("missing code")?
        .into())
}
async fn handoff(app: &Router, slug: &str, code: &str) -> TestResult<Response> {
    Ok(app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/handoff")
                .header("host", format!("{slug}.{ROOT}"))
                .header("origin", format!("http://{ROOT}"))
                .header("content-type", "application/x-www-form-urlencoded")
                .body(Body::from(format!("code={code}")))?,
        )
        .await?)
}

// Contract cases share one privileged PostgreSQL instance and reset it sequentially.
static DATABASE_CONTRACT: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn initialize_contract() -> TestResult<(Config, String, PgPool)> {
    let admin_url = std::env::var("TEST_DATABASE_URL")?;
    let config = Config {
        root_domain: "ici.localhost".into(),
        public_origin: format!("http://{ROOT}"),
        secure: false,
        trust_proxy: false,
        central_url: admin_url.replace(
            "postgres:local-provisioner-only",
            "ici_registry:local-registry-only",
        ),
        encryption_key: vec![7; 32],
    };
    assert_eq!(std::env::var("ICI_TEST_DATABASE")?, "1");
    let recovery = PgPool::connect(&admin_url).await?;
    sqlx::raw_sql("DO $$ BEGIN IF to_regclass('outbox') IS NULL AND to_regclass('unavailable_outbox') IS NOT NULL THEN ALTER TABLE unavailable_outbox RENAME TO outbox; END IF; END $$;")
        .execute(&recovery).await?;
    recovery.close().await;
    let admin = worker::initialize(&config, &admin_url).await?;
    // A killed mutant can interrupt cleanup. Reset only the explicitly designated test instance.
    assert_eq!(std::env::var("ICI_TEST_DATABASE")?, "1");
    sqlx::raw_sql(
        "DELETE FROM handoffs; DELETE FROM outbox; DELETE FROM rate_limits; DELETE FROM tenants;",
    )
    .execute(&admin)
    .await?;
    let databases: Vec<String> = sqlx::query_scalar(
        "SELECT datname FROM pg_database WHERE datname ~ '^ici_t_[a-f0-9]{32}$'",
    )
    .fetch_all(&admin)
    .await?;
    for name in databases {
        sqlx::query(&format!("DROP DATABASE {name} WITH (FORCE)"))
            .execute(&admin)
            .await?;
    }
    let roles: Vec<String> =
        sqlx::query_scalar("SELECT rolname FROM pg_roles WHERE rolname ~ '^ici_t_[a-f0-9]{32}$'")
            .fetch_all(&admin)
            .await?;
    for name in roles {
        sqlx::query(&format!("DROP ROLE {name}"))
            .execute(&admin)
            .await?;
    }
    Ok((config, admin_url, admin))
}

async fn capability_contract(planning: bool) -> TestResult {
    let _guard = DATABASE_CONTRACT.lock().await;
    let (config, admin_url, admin) = initialize_contract().await?;
    let state = State::connect(config).await?;
    let app = application(state.clone());
    static PASSWORD_HASH: tokio::sync::OnceCell<String> = tokio::sync::OnceCell::const_new();
    let hash = PASSWORD_HASH
        .get_or_try_init(|| crypto::hash_password(PASSWORD.into()))
        .await?;
    let mut slugs = Vec::new();
    for _ in 0..2 {
        let id = Uuid::new_v4();
        let slug = format!("test-{}", id.simple());
        sqlx::query("INSERT INTO tenants(id,slug,state,first_name,last_name,email,password_hash,terms_version,receipt_hash) VALUES ($1,$2,'queued','Camille','Durand','owner@example.com',$3,$4,$2)")
            .bind(id).bind(&slug).bind(hash).bind(ici_server::identity::TERMS_VERSION)
            .execute(&admin).await?;
        slugs.push(slug);
    }
    worker::tick(&state, &admin, &admin_url, false).await?;
    let tenant = state.tenant(&slugs[0]).await?;
    let other = state.tenant(&slugs[1]).await?;
    if planning {
        planning::lifecycle(&app, &tenant, &other).await?;
    } else {
        organization::lifecycle(&state, &app, &tenant, &other, &admin, &admin_url).await?;
    }
    for tenant in [&tenant, &other] {
        tenant.pool.close().await;
        let name = format!("ici_t_{}", tenant.id.simple());
        sqlx::query(&format!("DROP DATABASE {name} WITH (FORCE)"))
            .execute(&admin)
            .await?;
        sqlx::query(&format!("DROP ROLE {name}"))
            .execute(&admin)
            .await?;
        sqlx::query("DELETE FROM handoffs WHERE tenant_id=$1")
            .bind(tenant.id)
            .execute(&admin)
            .await?;
        sqlx::query("DELETE FROM tenants WHERE id=$1")
            .bind(tenant.id)
            .execute(&admin)
            .await?;
    }
    Ok(())
}

#[tokio::test]
async fn planning_contract() -> TestResult {
    capability_contract(true).await
}

#[tokio::test]
async fn organization_contract() -> TestResult {
    capability_contract(false).await
}

#[tokio::test]
async fn complete_account_lifecycle_and_database_isolation() -> TestResult {
    tracing_subscriber::fmt()
        .with_env_filter("ici_server=debug,sqlx=warn")
        .with_test_writer()
        .try_init()?;
    let _guard = DATABASE_CONTRACT.lock().await;
    let (config, admin_url, admin) = initialize_contract().await?;
    let state = State::connect(config.clone()).await?;
    let app = application(state.clone());
    let slug = format!("test-{}", Uuid::new_v4().simple());
    let other = format!("test-{}", Uuid::new_v4().simple());
    let host = format!("{slug}.{ROOT}");
    assert_eq!(config.tenant_origin(&slug), format!("http://{host}"));
    let response = call(&app, "GET", "/api/config", ROOT, None, &[]).await?;
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(data(response).await?["tenant"], Value::Null);
    for invalid in [
        "ici.localhost.evil:5173",
        "x.acme.ici.localhost:5173",
        "ici.localhost:8080",
        "user@ici.localhost:5173",
        "ici.localhost:05173",
    ] {
        assert_eq!(
            call(&app, "GET", "/api/config", invalid, None, &[])
                .await?
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        call(&app, "GET", "/api/config", &host, None, &[])
            .await?
            .status(),
        StatusCode::NOT_FOUND
    );
    let request = Request::builder()
        .method("POST")
        .uri("/api/registrations")
        .header("host", ROOT)
        .header("origin", "http://evil.example")
        .header("content-type", "application/json")
        .body(Body::from(registration(&slug).to_string()))?;
    assert_eq!(
        app.clone().oneshot(request).await?.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        data(
            call(
                &app,
                "GET",
                &format!("/api/tenants/availability?slug={slug}"),
                ROOT,
                None,
                &[]
            )
            .await?
        )
        .await?["available"],
        true
    );
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/tenants/availability?slug=admin",
            ROOT,
            None,
            &[]
        )
        .await?
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    for (field, value) in [
        ("first_name", json!("")),
        ("last_name", json!("")),
        ("password", json!("short")),
        ("email", json!("invalid")),
        ("email", json!("owner<owner@example.com>")),
        ("accepted_terms", json!(false)),
        ("terms_version", json!("old")),
    ] {
        let mut body = registration(&slug);
        body[field] = value;
        let response = call(&app, "POST", "/api/registrations", ROOT, Some(body), &[]).await?;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{field}"
        );
    }
    let (first, second) = tokio::join!(
        call(
            &app,
            "POST",
            "/api/registrations",
            ROOT,
            Some(registration(&slug)),
            &[]
        ),
        call(
            &app,
            "POST",
            "/api/registrations",
            ROOT,
            Some(registration(&slug)),
            &[]
        )
    );
    let (first, second) = (first?, second?);
    let response = if first.status() == StatusCode::ACCEPTED {
        assert_eq!(second.status(), StatusCode::CONFLICT);
        first
    } else {
        assert_eq!(first.status(), StatusCode::CONFLICT);
        second
    };
    let receipt = data(response).await?["receipt"]
        .as_str()
        .ok_or("receipt")?
        .to_owned();
    let authorization = format!("Bearer {receipt}");
    assert_eq!(
        data(
            call(
                &app,
                "GET",
                "/api/registrations/status",
                ROOT,
                None,
                &[("authorization", &authorization)]
            )
            .await?
        )
        .await?["state"],
        "pending"
    );
    assert_eq!(
        call(&app, "GET", "/api/registrations/status", ROOT, None, &[])
            .await?
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        data(
            call(
                &app,
                "GET",
                &format!("/api/tenants/availability?slug={slug}"),
                ROOT,
                None,
                &[]
            )
            .await?
        )
        .await?["available"],
        false
    );
    let old_token = queued_token(&admin, &config.encryption_key, "Confirmez").await?;
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/registrations/resend",
            ROOT,
            Some(json!({})),
            &[("authorization", &authorization)]
        )
        .await?
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/registrations/verify",
            ROOT,
            Some(json!({"token":old_token})),
            &[]
        )
        .await?
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let verification = queued_token(&admin, &config.encryption_key, "Confirmez").await?;
    let verified = call(
        &app,
        "POST",
        "/api/registrations/verify",
        ROOT,
        Some(json!({"token":verification})),
        &[],
    )
    .await?;
    assert_eq!(verified.status(), StatusCode::OK);
    let receipt = data(verified).await?["receipt"]
        .as_str()
        .ok_or("receipt")?
        .to_owned();
    let authorization = format!("Bearer {receipt}");
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/registrations/verify",
            ROOT,
            Some(json!({"token":verification})),
            &[]
        )
        .await?
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        data(
            call(
                &app,
                "GET",
                "/api/registrations/status",
                ROOT,
                None,
                &[("authorization", &authorization)]
            )
            .await?
        )
        .await?["state"],
        "queued"
    );
    worker::tick(&state, &admin, &admin_url, false).await?;
    assert_eq!(
        data(
            call(
                &app,
                "GET",
                "/api/registrations/status",
                ROOT,
                None,
                &[("authorization", &authorization)]
            )
            .await?
        )
        .await?["state"],
        "active"
    );
    let tenant = state.tenant(&slug).await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM consents")
            .fetch_one(&tenant.pool)
            .await?,
        1
    );
    assert!(
        sqlx::query("CREATE TABLE forbidden (id int)")
            .execute(&tenant.pool)
            .await
            .is_err()
    );
    // Restarting application state must preserve accounts and tenant resolution.
    let restarted = State::connect(config.clone()).await?;
    assert_eq!(restarted.tenant(&slug).await?.id, tenant.id);
    assert_eq!(
        data(call(&app, "GET", "/api/config", &host, None, &[]).await?).await?["tenant"],
        slug
    );
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/tenants/availability?slug=other",
            &host,
            None,
            &[]
        )
        .await?
        .status(),
        StatusCode::NOT_FOUND
    );
    let invalid = call(
        &app,
        "POST",
        "/api/auth/login",
        ROOT,
        Some(json!({"slug":slug,"email":"owner@example.com","password":"incorrect"})),
        &[],
    )
    .await?;
    assert_eq!(invalid.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        call(&app, "GET", "/api/auth/session", &host, None, &[])
            .await?
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let code = login(&app, &slug, PASSWORD).await?;
    assert!(sqlx::query_scalar::<_,bool>("SELECT expires_at>now()+interval '55 seconds' AND expires_at<=now()+interval '60 seconds' FROM handoffs WHERE token_hash=$1")
        .bind(crypto::digest(&code)).fetch_one(&admin).await?);
    let exchanged = handoff(&app, &slug, &code).await?;
    assert_eq!(exchanged.status(), StatusCode::SEE_OTHER);
    let cookie = exchanged.headers()["set-cookie"].to_str()?.to_owned();
    assert!(!cookie.contains("; Secure"));
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Lax"));
    assert!(cookie.contains("Max-Age=2592000"));
    assert!(!cookie.contains("Domain="));
    assert_eq!(
        handoff(&app, &slug, &code).await?.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let session = data(
        call(
            &app,
            "GET",
            "/api/auth/session",
            &host,
            None,
            &[("cookie", &cookie)],
        )
        .await?,
    )
    .await?;
    assert_eq!(session["first_name"], "Camille");
    assert_eq!(session["company"], slug);
    let csrf = session["csrf"].as_str().ok_or("csrf")?;
    assert_eq!(csrf.len(), 64);
    assert_eq!(
        data(
            call(
                &app,
                "GET",
                "/api/auth/session",
                &host,
                None,
                &[("cookie", &cookie)]
            )
            .await?
        )
        .await?["csrf"],
        csrf
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/auth/logout",
            &host,
            Some(json!({})),
            &[("cookie", &cookie)]
        )
        .await?
        .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/auth/logout",
            &host,
            Some(json!({})),
            &[("cookie", &cookie), ("x-csrf-token", "wrong")]
        )
        .await?
        .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/auth/logout",
            &host,
            Some(json!({})),
            &[("cookie", &cookie), ("x-csrf-token", csrf)]
        )
        .await?
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/auth/session",
            &host,
            None,
            &[("cookie", &cookie)]
        )
        .await?
        .status(),
        StatusCode::UNAUTHORIZED
    );
    // A second tenant with the same email owns an independent account and database.
    let mut body = registration(&other);
    body["password"] = json!("Another secure pass phrase1!");
    assert_eq!(
        call(&app, "POST", "/api/registrations", ROOT, Some(body), &[])
            .await?
            .status(),
        StatusCode::ACCEPTED
    );
    let verification = queued_token(&admin, &config.encryption_key, "Confirmez").await?;
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/registrations/verify",
            ROOT,
            Some(json!({"token":verification})),
            &[]
        )
        .await?
        .status(),
        StatusCode::OK
    );
    worker::tick(&state, &admin, &admin_url, false).await?;
    let second = state.tenant(&other).await?;
    let row = sqlx::query("SELECT database_secret FROM tenants WHERE id=$1")
        .bind(tenant.id)
        .fetch_one(&admin)
        .await?;
    let secret = crypto::decrypt(
        &config.encryption_key,
        &row.get::<String, _>("database_secret"),
    )?;
    let mut cross = url::Url::parse(&secret)?;
    cross.set_path(&format!("ici_t_{}", second.id.simple()));
    assert!(PgPoolOptions::new().connect(cross.as_str()).await.is_err());
    assert!(
        sqlx::query("CREATE DATABASE forbidden")
            .execute(&tenant.pool)
            .await
            .is_err()
    );
    let cross_code = login(&app, &slug, PASSWORD).await?;
    assert_eq!(
        handoff(&app, &other, &cross_code).await?.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        handoff(&app, &slug, &cross_code).await?.status(),
        StatusCode::SEE_OTHER
    );
    let code = login(&app, &slug, PASSWORD).await?;
    let response = handoff(&app, &slug, &code).await?;
    let cookie = response.headers()["set-cookie"].to_str()?.to_owned();
    let pending_code = login(&app, &slug, PASSWORD).await?;
    let known = data(
        call(
            &app,
            "POST",
            "/api/auth/forgot-password",
            ROOT,
            Some(json!({"slug":slug,"email":"owner@example.com"})),
            &[],
        )
        .await?,
    )
    .await?;
    let unknown = data(
        call(
            &app,
            "POST",
            "/api/auth/forgot-password",
            ROOT,
            Some(json!({"slug":slug,"email":"unknown@example.com"})),
            &[],
        )
        .await?,
    )
    .await?;
    assert_eq!(known, unknown);
    let reset = queued_token(&admin, &config.encryption_key, "Réinitialisez").await?;
    assert!(sqlx::query_scalar::<_,bool>("SELECT expires_at>now()+interval '29 minutes' AND expires_at<=now()+interval '30 minutes' FROM resets WHERE token_hash=$1")
        .bind(crypto::digest(&reset)).fetch_one(&tenant.pool).await?);

    assert_eq!(
        call(
            &app,
            "POST",
            "/api/auth/reset-password",
            &host,
            Some(json!({"token":reset,"password":"short"})),
            &[]
        )
        .await?
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/auth/reset-password",
            &host,
            Some(json!({"token":reset,"password":"The New secure pass phrase1!1!"})),
            &[]
        )
        .await?
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/auth/reset-password",
            &host,
            Some(json!({"token":reset,"password":PASSWORD})),
            &[]
        )
        .await?
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/auth/session",
            &host,
            None,
            &[("cookie", &cookie)]
        )
        .await?
        .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        handoff(&app, &slug, &pending_code).await?.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let _ = login(&app, &slug, "The New secure pass phrase1!1!").await?;
    let _ = login(&app, &other, "Another secure pass phrase1!").await?;
    // Active migrations can be rerun without changing the administrator.
    worker::tick(&state, &admin, &admin_url, true).await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM users")
            .fetch_one(&tenant.pool)
            .await?,
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM outbox")
            .fetch_one(&admin)
            .await?,
        0
    );
    state.limit("test-limit", 1).await?;
    assert_eq!(
        state
            .limit("test-limit", 1)
            .await
            .err()
            .map(|error| error.status),
        Some(StatusCode::TOO_MANY_REQUESTS)
    );
    sqlx::query("UPDATE rate_limits SET expires_at=now()-interval '1 second' WHERE key=$1")
        .bind(crypto::digest("test-limit"))
        .execute(&admin)
        .await?;
    state.limit("test-limit", 1).await?;
    assert_eq!(
        data(call(&app, "GET", "/health", ROOT, None, &[]).await?).await?["status"],
        "ok"
    );
    assert_eq!(
        call(&app, "GET", "/api/tenants/availability", ROOT, None, &[])
            .await?
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/auth/login",
            ROOT,
            Some(json!({"email":"bad","password":"value"})),
            &[]
        )
        .await?
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/auth/login",
            ROOT,
            Some(json!({"slug":slug,"email":"bad","password":"value"})),
            &[]
        )
        .await?
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/auth/login",
            ROOT,
            Some(json!({"slug":"nonexistent","email":"owner@example.com","password":PASSWORD})),
            &[]
        )
        .await?
        .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/auth/forgot-password",
            ROOT,
            Some(json!({"slug":"nonexistent","email":"owner@example.com"})),
            &[]
        )
        .await?
        .status(),
        StatusCode::OK
    );
    for (host, origin, body) in [
        (Some(ROOT), None, "{}"),
        (None, Some("http://ici.localhost:5173"), "{}"),
        (Some(ROOT), Some("http://ici.localhost:5173"), "not-json"),
    ] {
        let mut builder = Request::builder()
            .method("POST")
            .uri("/api/registrations")
            .header("content-type", "application/json");
        if let Some(host) = host {
            builder = builder.header("host", host);
        }
        if let Some(origin) = origin {
            builder = builder.header("origin", origin);
        }
        let response = app.clone().oneshot(builder.body(Body::from(body))?).await?;
        assert!(response.status().is_client_error());
        assert!(data(response).await?["code"].is_string());
    }
    assert_eq!(
        data(
            app.clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/auth/handoff")
                        .header("host", &host)
                        .header("origin", format!("http://{ROOT}"))
                        .header("content-type", "application/x-www-form-urlencoded")
                        .body(Body::from("wrong=value"))?
                )
                .await?
        )
        .await?["code"],
        "invalid_input"
    );
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/auth/session",
            &host,
            None,
            &[("cookie", "other=123; ici_session=short")]
        )
        .await?
        .status(),
        StatusCode::UNAUTHORIZED
    );
    let expired_code = login(&app, &other, "Another secure pass phrase1!").await?;
    sqlx::query("UPDATE handoffs SET expires_at=now()-interval '1 second' WHERE token_hash=$1")
        .bind(crypto::digest(&expired_code))
        .execute(&admin)
        .await?;
    assert_eq!(
        handoff(&app, &other, &expired_code).await?.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let direct=call(&app,"POST","/api/auth/login",&host,Some(json!({"slug":other,"email":"owner@example.com","password":"The New secure pass phrase1!1!"})),&[]).await?;
    assert_eq!(direct.status(), StatusCode::OK);
    let direct = data(direct).await?;
    let direct_code = direct["code"].as_str().ok_or("direct code")?;
    let response = handoff(&app, &slug, direct_code).await?;
    let short_cookie = response.headers()["set-cookie"].to_str()?.to_owned();
    assert!(short_cookie.contains("Max-Age=43200"));
    sqlx::query("UPDATE sessions SET expires_at=now()-interval '1 second'")
        .execute(&tenant.pool)
        .await?;
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/auth/session",
            &host,
            None,
            &[("cookie", &short_cookie)]
        )
        .await?
        .status(),
        StatusCode::UNAUTHORIZED
    );
    // An expired reservation is released and cannot be verified using its original token.
    let expired_slug = format!("expired-{}", Uuid::new_v4().simple());
    let mut expired_body = registration(&expired_slug);
    expired_body["email"] = json!("expiry@example.com");
    let result = data(
        call(
            &app,
            "POST",
            "/api/registrations",
            ROOT,
            Some(expired_body.clone()),
            &[],
        )
        .await?,
    )
    .await?;
    let expired_receipt = format!("Bearer {}", result["receipt"].as_str().ok_or("receipt")?);
    let old = queued_token(&admin, &config.encryption_key, "Confirmez").await?;
    sqlx::query("UPDATE tenants SET expires_at=now()-interval '1 second' WHERE slug=$1")
        .bind(&expired_slug)
        .execute(&admin)
        .await?;
    assert_eq!(
        data(
            call(
                &app,
                "GET",
                "/api/registrations/status",
                ROOT,
                None,
                &[("authorization", &expired_receipt)]
            )
            .await?
        )
        .await?["state"],
        "expired"
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/registrations/verify",
            ROOT,
            Some(json!({"token":old})),
            &[]
        )
        .await?
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        data(
            call(
                &app,
                "GET",
                &format!("/api/tenants/availability?slug={expired_slug}"),
                ROOT,
                None,
                &[]
            )
            .await?
        )
        .await?["available"],
        true
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/registrations",
            ROOT,
            Some(expired_body),
            &[]
        )
        .await?
        .status(),
        StatusCode::ACCEPTED
    );
    let verification = queued_token(&admin, &config.encryption_key, "Confirmez").await?;
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/registrations/verify",
            ROOT,
            Some(json!({"token":verification})),
            &[]
        )
        .await?
        .status(),
        StatusCode::OK
    );
    // Simulate interruption after the credential step and recover from an explicit failed state.
    sqlx::query("UPDATE tenants SET database_secret='invalid' WHERE slug=$1")
        .bind(&expired_slug)
        .execute(&admin)
        .await?;
    worker::tick(&state, &admin, &admin_url, false).await?;
    let failed =
        sqlx::query("SELECT state,attempts,retry_at>now() AS delayed FROM tenants WHERE slug=$1")
            .bind(&expired_slug)
            .fetch_one(&admin)
            .await?;
    assert_eq!(failed.get::<String, _>("state"), "failed");
    assert_eq!(failed.get::<i32, _>("attempts"), 1);
    assert!(failed.get::<bool, _>("delayed"));
    sqlx::query("UPDATE tenants SET database_secret=NULL,retry_at=now() WHERE slug=$1")
        .bind(&expired_slug)
        .execute(&admin)
        .await?;
    worker::tick(&state, &admin, &admin_url, false).await?;
    let recovered = state.tenant(&expired_slug).await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM users")
            .fetch_one(&recovered.pool)
            .await?,
        1
    );
    // A competing worker cannot enter a cycle while a session lock is held.
    let mut locked = admin.acquire().await?;
    sqlx::query("SELECT pg_advisory_lock(74829311)")
        .execute(&mut *locked)
        .await?;
    worker::tick(&state, &admin, &admin_url, false).await?;
    sqlx::query("SELECT pg_advisory_unlock(74829311)")
        .execute(&mut *locked)
        .await?;
    drop(locked);
    // A one-off migration must wait for a competing worker, rather than silently succeed without migrating.
    let mut locked = admin.acquire().await?;
    sqlx::query("SELECT pg_advisory_lock(74829311)")
        .execute(&mut *locked)
        .await?;
    let mut migration = std::pin::pin!(worker::tick(&state, &admin, &admin_url, true));
    let waited = tokio::select! {
        result = &mut migration => {result?; false},
        _ = tokio::time::sleep(std::time::Duration::from_millis(50)) => true,
    };
    sqlx::query("SELECT pg_advisory_unlock(74829311)")
        .execute(&mut *locked)
        .await?;
    drop(locked);
    if waited {
        migration.await?;
    }
    assert!(waited, "One-off migration skipped a contended worker lock");
    // The real worker executable loads configuration and secrets from a mounted-file equivalent.
    let key_file = std::env::temp_dir().join(format!("ici-key-{}", Uuid::new_v4().simple()));
    std::fs::write(&key_file, hex::encode(&config.encryption_key))?;
    let command = || {
        let mut command = std::process::Command::new(env!("CARGO_BIN_EXE_ici-worker"));
        command
            .env("ROOT_DOMAIN", &config.root_domain)
            .env("PUBLIC_ORIGIN", &config.public_origin)
            .env("CENTRAL_DATABASE_URL", &config.central_url)
            .env("REGISTRY_KEY_FILE", &key_file)
            .env("PROVISIONER_DATABASE_URL", &admin_url);
        command
    };
    let output = command().arg("--migrate-tenants").output()?;
    assert!(
        output.status.success(),
        "worker migration failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    // Exercise durable SMTP retry without changing the worker's environment globally.
    let mut transaction = admin.begin().await?;
    ici_server::tenancy::registry::enqueue(
        &mut transaction,
        &state,
        "retry@example.com",
        "Retry test",
        "Test delivery retry",
    )
    .await?;
    transaction.commit().await?;
    let output = command()
        .env("SMTP_HOST", "127.0.0.1")
        .env("SMTP_PORT", "1")
        .arg("--migrate-tenants")
        .output()?;
    assert!(output.status.success());
    assert_eq!(
        sqlx::query_scalar::<_, i32>("SELECT attempts FROM outbox LIMIT 1")
            .fetch_one(&admin)
            .await?,
        1
    );
    sqlx::query("UPDATE outbox SET retry_at=now()")
        .execute(&admin)
        .await?;
    worker::tick(&state, &admin, &admin_url, false).await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM outbox")
            .fetch_one(&admin)
            .await?,
        0
    );
    std::fs::remove_file(key_file)?;
    // HTTPS uses a local Secure cookie and validates the configured default port.
    let mut tls_config = config.clone();
    tls_config.secure = true;
    tls_config.public_origin = "https://ici.localhost".into();
    let tls_app = application(State::connect(tls_config).await?);
    let tls_login=data(call(&tls_app,"POST","/api/auth/login","ici.localhost",Some(json!({"slug":other,"email":"owner@example.com","password":"Another secure pass phrase1!"})),&[("origin","https://ici.localhost")]).await?).await?;
    let code = tls_login["code"].as_str().ok_or("TLS transfer")?;
    let request = Request::builder()
        .method("POST")
        .uri("/api/auth/handoff")
        .header("host", format!("{other}.ici.localhost"))
        .header("origin", "https://ici.localhost")
        .header("content-type", "application/x-www-form-urlencoded")
        .body(Body::from(format!("code={code}")))?;
    let response = tls_app.oneshot(request).await?;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert!(
        response.headers()["set-cookie"]
            .to_str()?
            .contains("; Secure")
    );
    // Adapter failures retain the 503 contract rather than becoming a name conflict.
    sqlx::query("ALTER TABLE outbox RENAME TO unavailable_outbox")
        .execute(&admin)
        .await?;
    let mut unavailable = registration("outage-test");
    unavailable["email"] = json!("outage@example.com");
    let failed_registration = call(
        &app,
        "POST",
        "/api/registrations",
        ROOT,
        Some(unavailable),
        &[],
    )
    .await;
    sqlx::query("ALTER TABLE unavailable_outbox RENAME TO outbox")
        .execute(&admin)
        .await?;
    assert_eq!(
        failed_registration?.status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    // Rate limits remain visible across the domain account port.
    sqlx::query("UPDATE rate_limits SET count=10 WHERE key=$1")
        .bind(crypto::digest(&format!("login:{other}:owner@example.com")))
        .execute(&admin)
        .await?;
    assert_eq!(call(&app,"POST","/api/auth/login",ROOT,Some(json!({"slug":other,"email":"owner@example.com","password":"Another secure pass phrase1!"})),&[]).await?.status(),StatusCode::TOO_MANY_REQUESTS);
    // A root-origin POST is allowed only for the transfer endpoint, never tenant logout/login.
    let forged = call(
        &app,
        "POST",
        "/api/auth/logout",
        &host,
        Some(json!({})),
        &[("origin", &format!("http://{ROOT}"))],
    )
    .await?;
    assert_eq!(forged.status(), StatusCode::FORBIDDEN);
    assert_eq!(forged.headers()["cache-control"], "no-store");
    assert_eq!(data(forged).await?["code"], "invalid_origin");
    // A registry/credential failure must not be hidden as an unknown account.
    let old_secret: String = sqlx::query_scalar("SELECT database_secret FROM tenants WHERE id=$1")
        .bind(recovered.id)
        .fetch_one(&admin)
        .await?;
    sqlx::query("UPDATE tenants SET database_secret='invalid' WHERE id=$1")
        .bind(recovered.id)
        .execute(&admin)
        .await?;
    let broken = application(State::connect(config.clone()).await?);
    assert_eq!(
        call(
            &broken,
            "POST",
            "/api/auth/login",
            ROOT,
            Some(json!({"slug":expired_slug,"email":"expiry@example.com","password":PASSWORD})),
            &[]
        )
        .await?
        .status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        call(
            &broken,
            "POST",
            "/api/auth/forgot-password",
            ROOT,
            Some(json!({"slug":expired_slug,"email":"expiry@example.com"})),
            &[]
        )
        .await?
        .status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    sqlx::query("UPDATE tenants SET database_secret=$1 WHERE id=$2")
        .bind(old_secret)
        .bind(recovered.id)
        .execute(&admin)
        .await?;
    // Simulate a crash after tenant data commits but before the registry becomes active.
    let mut admin_tenant_url = url::Url::parse(&admin_url)?;
    admin_tenant_url.set_path(&format!("ici_t_{}", recovered.id.simple()));
    let admin_tenant = PgPoolOptions::new()
        .max_connections(1)
        .connect(admin_tenant_url.as_str())
        .await?;
    let mut blocker = admin_tenant.begin().await?;
    sqlx::query("LOCK TABLE company IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *blocker)
        .await?;
    sqlx::query("UPDATE tenants SET state='queued' WHERE id=$1")
        .bind(recovered.id)
        .execute(&admin)
        .await?;
    let (cycle, observed) = tokio::join!(worker::tick(&state, &admin, &admin_url, false), async {
        let observed = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                let current: String = sqlx::query_scalar("SELECT state FROM tenants WHERE id=$1")
                    .bind(recovered.id)
                    .fetch_one(&admin)
                    .await?;
                if current == "provisioning" {
                    return Ok::<_, sqlx::Error>(());
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await;
        blocker.rollback().await?;
        Ok::<_, sqlx::Error>(observed)
    });
    cycle?;
    let observed = observed?;
    assert!(observed.is_ok(), "Provisioning state was never observable");
    assert_eq!(state.tenant(&expired_slug).await?.id, recovered.id);
    admin_tenant.close().await;
    // Without --migrate-tenants the executable must keep processing durable jobs.
    let key_file = std::env::temp_dir().join(format!("ici-loop-key-{}", Uuid::new_v4().simple()));
    std::fs::write(&key_file, hex::encode(&config.encryption_key))?;
    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_ici-worker"))
        .env("ROOT_DOMAIN", &config.root_domain)
        .env("PUBLIC_ORIGIN", &config.public_origin)
        .env("CENTRAL_DATABASE_URL", &config.central_url)
        .env("REGISTRY_KEY_FILE", &key_file)
        .env("PROVISIONER_DATABASE_URL", &admin_url)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()?;
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    let running = child.try_wait()?.is_none();
    if running {
        child.kill()?;
    }
    child.wait()?;
    std::fs::remove_file(key_file)?;
    assert!(running, "Worker exited without a one-off migration request");
    // Test-only cleanup touches only the internally generated databases from this test.
    for id in [tenant.id, second.id, recovered.id] {
        let name = format!("ici_t_{}", id.simple());
        sqlx::query(&format!("DROP DATABASE {name} WITH (FORCE)"))
            .execute(&admin)
            .await?;
        sqlx::query(&format!("DROP ROLE {name}"))
            .execute(&admin)
            .await?;
        sqlx::query("DELETE FROM handoffs WHERE tenant_id=$1")
            .bind(id)
            .execute(&admin)
            .await?;
        sqlx::query("DELETE FROM tenants WHERE id=$1")
            .bind(id)
            .execute(&admin)
            .await?;
    }
    Ok(())
}

#[test]
fn stable_error_contract() {
    assert_eq!(Error::field("email").code, "invalid_input");
    assert_eq!(Error::internal().to_string(), "service_unavailable");
}
