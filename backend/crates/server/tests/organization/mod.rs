use super::*;

async fn session_for(
    app: &Router,
    tenant: &ici_server::tenancy::registry::Tenant,
    user: Uuid,
) -> TestResult<(String, String)> {
    let token = crypto::token();
    let csrf = crypto::token();
    sqlx::query("INSERT INTO sessions (token_hash,user_id,csrf_hash,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')")
        .bind(crypto::digest(&token)).bind(user).bind(crypto::digest(&csrf)).execute(&tenant.pool).await?;
    let cookie = format!("ici_session={token}");
    let response = call(
        app,
        "GET",
        "/api/auth/session",
        &format!("{}.{ROOT}", tenant.slug),
        None,
        &[("cookie", &cookie)],
    )
    .await?;
    assert_eq!(response.status(), StatusCode::OK);
    Ok((cookie, csrf))
}
async fn token(pool: &PgPool, key: &[u8], subject: &str) -> TestResult<String> {
    queued_token(pool, key, subject).await
}
async fn request(
    app: &Router,
    host: &str,
    credentials: (&str, &str),
    method: &str,
    path: &str,
    body: Option<Value>,
    expected: StatusCode,
) -> TestResult<Value> {
    let (cookie, csrf) = credentials;
    let response = call(
        app,
        method,
        path,
        host,
        body,
        &[("cookie", cookie), ("x-csrf-token", csrf)],
    )
    .await?;
    assert_eq!(
        response.status(),
        expected,
        "{method} {path}: {}",
        data(response).await?
    );
    Ok(Value::Null)
}
async fn ok(
    app: &Router,
    host: &str,
    credentials: (&str, &str),
    method: &str,
    path: &str,
    body: Option<Value>,
) -> TestResult<Value> {
    let (cookie, csrf) = credentials;
    let response = call(
        app,
        method,
        path,
        host,
        body,
        &[("cookie", cookie), ("x-csrf-token", csrf)],
    )
    .await?;
    let status = response.status();
    let body = data(response).await?;
    assert_eq!(status, StatusCode::OK, "{method} {path}: {body}");
    Ok(body)
}
pub(super) async fn lifecycle(
    state: &State,
    app: &Router,
    tenant: &ici_server::tenancy::registry::Tenant,
    other: &ici_server::tenancy::registry::Tenant,
    admin: &PgPool,
    admin_url: &str,
) -> TestResult {
    sqlx::query("DELETE FROM rate_limits")
        .execute(admin)
        .await?;
    // Apply the upgrade over the previous schema and preserve an existing administrator.
    let options: sqlx::postgres::PgConnectOptions = admin_url.parse()?;
    let upgrade = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(options.database(&format!("ici_t_{}", tenant.id.simple())))
        .await?;
    sqlx::raw_sql("CREATE SCHEMA upgrade_contract; SET search_path TO upgrade_contract;")
        .execute(&upgrade)
        .await?;
    sqlx::raw_sql(include_str!("../../migrations/tenant/0001_identity.sql"))
        .execute(&upgrade)
        .await?;
    sqlx::query("INSERT INTO users (id,email,first_name,last_name,password_hash,role) VALUES ($1,'existing@example.com','Existing','Owner','hash','admin')").bind(tenant.id).execute(&upgrade).await?;
    sqlx::raw_sql(include_str!(
        "../../migrations/tenant/0002_organization.sql"
    ))
    .execute(&upgrade)
    .await?;
    let upgraded = sqlx::query("SELECT status,role,team_id,location_id FROM users")
        .fetch_one(&upgrade)
        .await?;
    assert_eq!(upgraded.get::<String, _>("status"), "active");
    assert_eq!(upgraded.get::<String, _>("role"), "admin");
    assert!(upgraded.get::<Option<Uuid>, _>("team_id").is_none());
    assert!(upgraded.get::<Option<Uuid>, _>("location_id").is_none());
    sqlx::raw_sql("SET search_path TO public; DROP SCHEMA upgrade_contract CASCADE;")
        .execute(&upgrade)
        .await?;
    upgrade.close().await;
    let host = format!("{}.{ROOT}", tenant.slug);
    let (cookie, csrf) = session_for(app, tenant, tenant.id).await?;
    let headers = [("cookie", cookie.as_str()), ("x-csrf-token", csrf.as_str())];
    assert_eq!(
        call(app, "GET", "/api/locations", &host, None, &[])
            .await?
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            app,
            "POST",
            "/api/teams",
            &host,
            Some(json!({"name":"Engineering"})),
            &[("cookie", &cookie)]
        )
        .await?
        .status(),
        StatusCode::FORBIDDEN
    );
    let mut blocker = tenant.pool.begin().await?;
    sqlx::query("SELECT id FROM company FOR UPDATE")
        .execute(&mut *blocker)
        .await?;
    let blocked = call(
        app,
        "POST",
        "/api/teams",
        &host,
        Some(json!({"name":"Serialized"})),
        &headers,
    );
    tokio::pin!(blocked);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(150), &mut blocked)
            .await
            .is_err(),
        "Organization writes must wait for the company lock"
    );
    blocker.rollback().await?;
    let response = blocked.await?;
    assert_eq!(response.status(), StatusCode::OK);
    let serialized = data(response).await?["id"]
        .as_str()
        .ok_or("serialized team")?
        .to_owned();
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "DELETE",
        &format!("/api/teams/{serialized}"),
        None,
    )
    .await?;
    for invalid in [
        json!({"name":"","code":"PA"}),
        json!({"name":"Paris","code":"P1"}),
        json!({"name":"Paris","code":"PARI"}),
        json!({"name":"Paris","code":"PA","city":"a\nb"}),
    ] {
        request(
            app,
            &host,
            (&cookie, &csrf),
            "POST",
            "/api/locations",
            Some(invalid),
            StatusCode::UNPROCESSABLE_ENTITY,
        )
        .await?;
    }
    let location = ok(
        app,
        &host,
        (&cookie, &csrf),
        "POST",
        "/api/locations",
        Some(json!({"name":" Paris ","code":"par","city":"Paris","address":"12 rue de Paris"})),
    )
    .await?;
    let lid = location["id"].as_str().ok_or("location id")?;
    let team = ok(
        app,
        &host,
        (&cookie, &csrf),
        "POST",
        "/api/teams",
        Some(json!({"name":"Engineering"})),
    )
    .await?;
    let tid = team["id"].as_str().ok_or("team id")?;
    request(
        app,
        &host,
        (&cookie, &csrf),
        "POST",
        "/api/teams",
        Some(json!({"name":" engineering "})),
        StatusCode::CONFLICT,
    )
    .await?;
    let profile = json!({"first_name":"Alice","last_name":"Martin","email":"alice@example.com","role":"collaborator","team_id":tid,"location_id":lid});
    for (field, value) in [
        ("first_name", json!("")),
        ("last_name", json!("")),
        ("email", json!("invalid")),
        ("role", json!("owner")),
        ("status", json!("unknown")),
        ("status", json!("active")),
        ("team_id", json!("bad-id")),
        ("location_id", json!("bad-id")),
        ("team_id", json!(Uuid::new_v4().to_string())),
        ("location_id", json!(Uuid::new_v4().to_string())),
    ] {
        let mut invalid = profile.clone();
        invalid[field] = value;
        request(
            app,
            &host,
            (&cookie, &csrf),
            "POST",
            "/api/users",
            Some(invalid),
            StatusCode::UNPROCESSABLE_ENTITY,
        )
        .await?;
    }
    request(
        app,
        &host,
        (&cookie, &csrf),
        "POST",
        "/api/teams",
        Some(json!({"name":""})),
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await?;
    request(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        "/api/teams/malformed",
        Some(json!({"name":"Valid"})),
        StatusCode::NOT_FOUND,
    )
    .await?;
    request(
        app,
        &host,
        (&cookie, "wrong"),
        "POST",
        "/api/teams",
        Some(json!({"name":"Valid"})),
        StatusCode::FORBIDDEN,
    )
    .await?;
    let user = ok(
        app,
        &host,
        (&cookie, &csrf),
        "POST",
        "/api/users",
        Some(profile.clone()),
    )
    .await?;
    let uid = user["id"].as_str().ok_or("user id")?;
    request(
        app,
        &host,
        (&cookie, &csrf),
        "POST",
        "/api/users",
        Some(profile.clone()),
        StatusCode::CONFLICT,
    )
    .await?;
    for path in [format!("/api/teams/{tid}"), format!("/api/locations/{lid}")] {
        request(
            app,
            &host,
            (&cookie, &csrf),
            "DELETE",
            &path,
            None,
            StatusCode::CONFLICT,
        )
        .await?;
    }
    let first = token(&tenant.pool, &state.config.encryption_key, "Invitation").await?;
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "POST",
        &format!("/api/users/{uid}/invitation"),
        Some(json!({})),
    )
    .await?;
    let latest: String = sqlx::query_scalar("SELECT token_hash FROM invitations WHERE user_id=$1")
        .bind(Uuid::parse_str(uid)?)
        .fetch_one(&tenant.pool)
        .await?;
    assert_ne!(latest, crypto::digest(&first));
    let mut invitation = String::new();
    for row in sqlx::query("SELECT payload FROM outbox")
        .fetch_all(&tenant.pool)
        .await?
    {
        let payload: Value = serde_json::from_str(&crypto::decrypt(
            &state.config.encryption_key,
            &row.get::<String, _>("payload"),
        )?)?;
        if let Some(candidate) = payload["body"]
            .as_str()
            .and_then(|body| body.split("#token=").nth(1))
            .and_then(|tail| tail.split_whitespace().next())
            && crypto::digest(candidate) == latest
        {
            invitation = candidate.into();
        }
    }
    assert!(!invitation.is_empty());
    for bad in [&first, "missing"] {
        request(app,&host,("",""),"POST","/api/auth/accept-invitation",Some(json!({"token":bad,"password":PASSWORD,"accepted_terms":true,"terms_version":ici_server::identity::TERMS_VERSION})),StatusCode::UNPROCESSABLE_ENTITY).await?;
    }
    let acceptance = json!({"token":invitation,"password":PASSWORD,"accepted_terms":true,"terms_version":ici_server::identity::TERMS_VERSION});
    let mut refused = acceptance.clone();
    refused["accepted_terms"] = json!(false);
    request(
        app,
        &host,
        ("", ""),
        "POST",
        "/api/auth/accept-invitation",
        Some(refused),
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await?;
    ok(
        app,
        &host,
        ("", ""),
        "POST",
        "/api/auth/accept-invitation",
        Some(acceptance.clone()),
    )
    .await?;
    request(
        app,
        &host,
        ("", ""),
        "POST",
        "/api/auth/accept-invitation",
        Some(acceptance),
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM consents WHERE user_id=$1")
            .bind(Uuid::parse_str(uid)?)
            .fetch_one(&tenant.pool)
            .await?,
        1
    );
    let (collab, collab_csrf) = session_for(app, tenant, Uuid::parse_str(uid)?).await?;
    ok(
        app,
        &host,
        (&collab, &collab_csrf),
        "GET",
        "/api/locations",
        None,
    )
    .await?;
    for path in ["/api/teams", "/api/users"] {
        request(
            app,
            &host,
            (&collab, &collab_csrf),
            "GET",
            path,
            None,
            StatusCode::FORBIDDEN,
        )
        .await?;
    }
    request(
        app,
        &host,
        (&collab, &collab_csrf),
        "POST",
        "/api/locations",
        Some(json!({"name":"Office","code":"OF"})),
        StatusCode::FORBIDDEN,
    )
    .await?;
    let (other_cookie, other_csrf) = session_for(app, other, other.id).await?;
    request(
        app,
        &format!("{}.{ROOT}", other.slug),
        (&other_cookie, &other_csrf),
        "PATCH",
        &format!("/api/teams/{tid}"),
        Some(json!({"name":"Other"})),
        StatusCode::NOT_FOUND,
    )
    .await?;
    let mut changed = profile.clone();
    changed["email"] = json!("new-alice@example.com");
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &format!("/api/users/{uid}"),
        Some(changed.clone()),
    )
    .await?;
    assert!(
        !sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT FROM invitations WHERE user_id=$1)")
            .bind(Uuid::parse_str(uid)?)
            .fetch_one(&tenant.pool)
            .await?
    );
    let email_token = token(
        &tenant.pool,
        &state.config.encryption_key,
        "nouvelle adresse",
    )
    .await?;
    let email_mail_count: i64 = sqlx::query_scalar("SELECT count(*) FROM outbox")
        .fetch_one(&tenant.pool)
        .await?;
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &format!("/api/users/{uid}"),
        Some(changed.clone()),
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT token_hash FROM email_changes WHERE user_id=$1")
            .bind(Uuid::parse_str(uid)?)
            .fetch_one(&tenant.pool)
            .await?,
        crypto::digest(&email_token)
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM outbox")
            .fetch_one(&tenant.pool)
            .await?,
        email_mail_count
    );
    let users = ok(app, &host, (&cookie, &csrf), "GET", "/api/users", None).await?;
    let alice = users["users"]
        .as_array()
        .ok_or("users")?
        .iter()
        .find(|user| user["id"] == uid)
        .ok_or("alice")?;
    assert_eq!(alice["email"], "alice@example.com");
    assert_eq!(alice["pending_email"], "new-alice@example.com");
    request(
        app,
        &host,
        (&cookie, &csrf),
        "POST",
        "/api/users",
        Some(changed.clone()),
        StatusCode::CONFLICT,
    )
    .await?;
    ok(
        app,
        &host,
        ("", ""),
        "POST",
        "/api/auth/confirm-email",
        Some(json!({"token":email_token})),
    )
    .await?;
    request(
        app,
        &host,
        ("", ""),
        "POST",
        "/api/auth/confirm-email",
        Some(json!({"token":email_token})),
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await?;
    request(
        app,
        &host,
        (&collab, &collab_csrf),
        "GET",
        "/api/locations",
        None,
        StatusCode::UNAUTHORIZED,
    )
    .await?;
    let mut next_email = changed.clone();
    next_email["email"] = json!("next-alice@example.com");
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &format!("/api/users/{uid}"),
        Some(next_email),
    )
    .await?;
    let cancelled_token: String =
        sqlx::query_scalar("SELECT token_hash FROM email_changes WHERE user_id=$1")
            .bind(Uuid::parse_str(uid)?)
            .fetch_one(&tenant.pool)
            .await?;
    assert!(!cancelled_token.is_empty());
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &format!("/api/users/{uid}"),
        Some(changed.clone()),
    )
    .await?;
    assert!(
        !sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT FROM email_changes WHERE user_id=$1)")
            .bind(Uuid::parse_str(uid)?)
            .fetch_one(&tenant.pool)
            .await?
    );
    let mut cannot_reinvite = changed.clone();
    cannot_reinvite["status"] = json!("pending");
    request(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &format!("/api/users/{uid}"),
        Some(cannot_reinvite),
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await?;
    let login = ok(
        app,
        &host,
        ("", ""),
        "POST",
        "/api/auth/login",
        Some(json!({"email":"new-alice@example.com","password":PASSWORD})),
    )
    .await?;
    let transfer = login["code"].as_str().ok_or("code")?;
    changed["status"] = json!("inactive");
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &format!("/api/users/{uid}"),
        Some(changed.clone()),
    )
    .await?;
    assert_eq!(
        handoff(app, &tenant.slug, transfer).await?.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    request(
        app,
        &host,
        ("", ""),
        "POST",
        "/api/auth/login",
        Some(json!({"email":"new-alice@example.com","password":PASSWORD})),
        StatusCode::UNAUTHORIZED,
    )
    .await?;
    let mut inactive_email = changed.clone();
    inactive_email["email"] = json!("inactive@example.com");
    request(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &format!("/api/users/{uid}"),
        Some(inactive_email),
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await?;
    changed["status"] = json!("active");
    changed["team_id"] = Value::Null;
    changed["location_id"] = Value::Null;
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &format!("/api/users/{uid}"),
        Some(changed.clone()),
    )
    .await?;
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &format!("/api/teams/{tid}"),
        Some(json!({"name":"Product"})),
    )
    .await?;
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &format!("/api/locations/{lid}"),
        Some(json!({"name":"Bordeaux","code":"BDX"})),
    )
    .await?;
    for path in [format!("/api/teams/{tid}"), format!("/api/locations/{lid}")] {
        ok(app, &host, (&cookie, &csrf), "DELETE", &path, None).await?;
        request(
            app,
            &host,
            (&cookie, &csrf),
            "DELETE",
            &path,
            None,
            StatusCode::NOT_FOUND,
        )
        .await?;
    }
    // Pending accounts remain inaccessible; disable/re-enable rotates their invitation.
    let pending_profile = json!({"first_name":"Bob","last_name":"Petit","email":"bob@example.com","role":"collaborator"});
    let bob = ok(
        app,
        &host,
        (&cookie, &csrf),
        "POST",
        "/api/users",
        Some(pending_profile.clone()),
    )
    .await?;
    let bob_id = bob["id"].as_str().ok_or("bob id")?;
    let bob_key = Uuid::parse_str(bob_id)?;
    let bob_path = format!("/api/users/{bob_id}");
    let invitation_path = format!("{bob_path}/invitation");
    let reset_count: i64 = sqlx::query_scalar("SELECT count(*) FROM resets")
        .fetch_one(&tenant.pool)
        .await?;
    ok(
        app,
        &host,
        ("", ""),
        "POST",
        "/api/auth/forgot-password",
        Some(json!({"email":"bob@example.com"})),
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM resets")
            .fetch_one(&tenant.pool)
            .await?,
        reset_count
    );
    let bob_token = token(&tenant.pool, &state.config.encryption_key, "Invitation").await?;
    sqlx::query("UPDATE invitations SET expires_at=now()-interval '1 second' WHERE user_id=$1")
        .bind(bob_key)
        .execute(&tenant.pool)
        .await?;
    let expired_hash = crypto::digest(&bob_token);
    let bob_acceptance = json!({"token":bob_token,"password":PASSWORD,"accepted_terms":true,"terms_version":ici_server::identity::TERMS_VERSION});
    request(
        app,
        &host,
        ("", ""),
        "POST",
        "/api/auth/accept-invitation",
        Some(bob_acceptance),
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await?;
    let mut pending_change = pending_profile.clone();
    pending_change["email"] = json!("bob.new@example.com");
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &bob_path,
        Some(pending_change.clone()),
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT email FROM users WHERE id=$1")
            .bind(bob_key)
            .fetch_one(&tenant.pool)
            .await?,
        "bob.new@example.com"
    );
    let before_disable: String =
        sqlx::query_scalar("SELECT token_hash FROM invitations WHERE user_id=$1")
            .bind(bob_key)
            .fetch_one(&tenant.pool)
            .await?;
    assert_ne!(before_disable, expired_hash);
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT expires_at>now() FROM invitations WHERE user_id=$1")
            .bind(bob_key)
            .fetch_one(&tenant.pool)
            .await?
    );
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &bob_path,
        Some(pending_change.clone()),
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT token_hash FROM invitations WHERE user_id=$1")
            .bind(bob_key)
            .fetch_one(&tenant.pool)
            .await?,
        before_disable
    );
    pending_change["status"] = json!("inactive");
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &bob_path,
        Some(pending_change.clone()),
    )
    .await?;
    request(
        app,
        &host,
        (&cookie, &csrf),
        "POST",
        &invitation_path,
        Some(json!({})),
        StatusCode::NOT_FOUND,
    )
    .await?;
    assert!(
        !sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT FROM invitations WHERE user_id=$1)")
            .bind(bob_key)
            .fetch_one(&tenant.pool)
            .await?
    );
    pending_change["status"] = json!("active");
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &bob_path,
        Some(pending_change),
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM users WHERE id=$1")
            .bind(bob_key)
            .fetch_one(&tenant.pool)
            .await?,
        "pending"
    );
    assert_ne!(
        sqlx::query_scalar::<_, String>("SELECT token_hash FROM invitations WHERE user_id=$1")
            .bind(bob_key)
            .fetch_one(&tenant.pool)
            .await?,
        before_disable
    );
    let owner = ok(app, &host, (&cookie, &csrf), "GET", "/api/users", None).await?["users"]
        .as_array()
        .ok_or("users")?
        .iter()
        .find(|user| user["id"] == tenant.id.to_string())
        .ok_or("owner")?
        .clone();
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &format!("/api/users/{}", tenant.id),
        Some(owner.clone()),
    )
    .await?;
    let mut disabled_owner = owner.clone();
    disabled_owner["status"] = json!("inactive");
    request(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &format!("/api/users/{}", tenant.id),
        Some(disabled_owner),
        StatusCode::CONFLICT,
    )
    .await?;
    let mut demoted = owner.clone();
    demoted["role"] = json!("collaborator");
    request(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &format!("/api/users/{}", tenant.id),
        Some(demoted.clone()),
        StatusCode::CONFLICT,
    )
    .await?;
    // Concurrent demotions of the only two active administrators leave exactly one.
    changed["role"] = json!("admin");
    ok(
        app,
        &host,
        (&cookie, &csrf),
        "PATCH",
        &format!("/api/users/{uid}"),
        Some(changed.clone()),
    )
    .await?;
    let (alice_admin, alice_csrf) = session_for(app, tenant, Uuid::parse_str(uid)?).await?;
    changed["role"] = json!("collaborator");
    let alice_path = format!("/api/users/{uid}");
    let owner_path = format!("/api/users/{}", tenant.id);
    let alice_headers = [
        ("cookie", alice_admin.as_str()),
        ("x-csrf-token", alice_csrf.as_str()),
    ];
    let (left, right) = tokio::join!(
        call(app, "PATCH", &owner_path, &host, Some(demoted), &headers),
        call(
            app,
            "PATCH",
            &alice_path,
            &host,
            Some(changed),
            &alice_headers
        )
    );
    let statuses = [left?.status(), right?.status()];
    assert!(statuses.contains(&StatusCode::OK));
    assert!(statuses.contains(&StatusCode::CONFLICT));
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM users WHERE role='admin' AND status='active'"
        )
        .fetch_one(&tenant.pool)
        .await?,
        1
    );
    // Worker retries tenant mail durably through the same SMTP adapter as registry mail.
    let failed_delivery = std::process::Command::new(env!("CARGO_BIN_EXE_ici-worker"))
        .arg("--migrate-tenants")
        .env("ROOT_DOMAIN", &state.config.root_domain)
        .env("PUBLIC_ORIGIN", &state.config.public_origin)
        .env("CENTRAL_DATABASE_URL", &state.config.central_url)
        .env("REGISTRY_KEY", hex::encode(&state.config.encryption_key))
        .env("PROVISIONER_DATABASE_URL", admin_url)
        .env("SMTP_PORT", "1")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()?;
    assert!(failed_delivery.success());
    assert!(
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT FROM outbox WHERE attempts>0 AND retry_at>now())"
        )
        .fetch_one(&tenant.pool)
        .await?
    );
    sqlx::query("UPDATE outbox SET retry_at=now()")
        .execute(&tenant.pool)
        .await?;
    worker::tick(state, admin, admin_url, false).await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM outbox")
            .fetch_one(&tenant.pool)
            .await?,
        0
    );
    Ok(())
}
