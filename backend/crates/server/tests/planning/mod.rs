use super::*;
async fn send(
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
    let status = response.status();
    let body = data(response).await?;
    assert_eq!(status, expected, "{method} {path}: {body}");
    Ok(body)
}
async fn credentials(
    tenant: &ici_server::tenancy::registry::Tenant,
    user: Uuid,
) -> TestResult<(String, String)> {
    let token = crypto::token();
    let csrf = crypto::token();
    sqlx::query("INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')").bind(crypto::digest(&token)).bind(user).bind(crypto::digest(&csrf)).execute(&tenant.pool).await?;
    Ok((format!("ici_session={token}"), csrf))
}
pub(super) async fn lifecycle(
    app: &Router,
    tenant: &ici_server::tenancy::registry::Tenant,
    other: &ici_server::tenancy::registry::Tenant,
) -> TestResult {
    let host = format!("{}.{ROOT}", tenant.slug);
    let (cookie, csrf) = credentials(tenant, tenant.id).await?;
    let collaborator = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id,email,first_name,last_name,password_hash,role) VALUES ($1,'planner@example.com','Plan','User','hash','collaborator')").bind(collaborator).execute(&tenant.pool).await?;
    let (cc, ct) = credentials(tenant, collaborator).await?;
    let week = "/api/planning/week?start=2026-10-26";
    let result = send(
        app,
        &host,
        (&cookie, &csrf),
        "GET",
        week,
        None,
        StatusCode::OK,
    )
    .await?;
    assert_eq!(result["work_days"], json!([0, 1, 2, 3, 4]));
    assert_eq!(result["entries"], json!([]));
    assert!(result["users"][0].get("email").is_none());
    send(
        app,
        &host,
        (&cookie, &csrf),
        "GET",
        "/api/planning/week?start=2026-10-27",
        None,
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await?;
    send(
        app,
        &host,
        (&cookie, &csrf),
        "GET",
        "/api/planning/week",
        None,
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await?;
    send(
        app,
        &host,
        ("", &csrf),
        "GET",
        week,
        None,
        StatusCode::UNAUTHORIZED,
    )
    .await?;
    for work_days in [json!([]), json!([0, 0]), json!([7]), json!([2, 1])] {
        send(
            app,
            &host,
            (&cookie, &csrf),
            "PUT",
            "/api/planning/settings",
            Some(json!({"work_days":work_days})),
            StatusCode::UNPROCESSABLE_ENTITY,
        )
        .await?;
    }
    send(
        app,
        &host,
        (&cc, &ct),
        "PUT",
        "/api/planning/settings",
        Some(json!({"work_days":[0]})),
        StatusCode::FORBIDDEN,
    )
    .await?;
    send(
        app,
        &host,
        (&cookie, "wrong"),
        "PUT",
        "/api/planning/settings",
        Some(json!({"work_days":[0]})),
        StatusCode::FORBIDDEN,
    )
    .await?;
    send(
        app,
        &host,
        (&cookie, &csrf),
        "PUT",
        "/api/planning/settings",
        Some(json!({"work_days":[0,5,6]})),
        StatusCode::OK,
    )
    .await?;
    assert_eq!(
        send(
            app,
            &host,
            (&cc, &ct),
            "GET",
            "/api/planning/settings",
            None,
            StatusCode::OK
        )
        .await?["work_days"],
        json!([0, 5, 6])
    );
    let location = Uuid::new_v4();
    sqlx::query("INSERT INTO locations(id,name,code) VALUES ($1,'Planning office','PO')")
        .bind(location)
        .execute(&tenant.pool)
        .await?;
    let mut body = json!({"user_id":collaborator,"entries":[{"date":"2026-10-26","half":"am","status":"office","location_id":location,"note":"Client"},{"date":"2026-10-26","half":"pm","status":"remote","location_id":null,"note":""}]});
    send(
        app,
        &host,
        (&cc, &ct),
        "PUT",
        "/api/planning/entries",
        Some(body.clone()),
        StatusCode::OK,
    )
    .await?;
    let result = send(app, &host, (&cc, &ct), "GET", week, None, StatusCode::OK).await?;
    assert_eq!(result["entries"][0]["note"], "Client");
    assert_eq!(result["entries"].as_array().ok_or("entries")?.len(), 2);
    body["user_id"] = json!(tenant.id);
    send(
        app,
        &host,
        (&cc, &ct),
        "PUT",
        "/api/planning/entries",
        Some(body.clone()),
        StatusCode::FORBIDDEN,
    )
    .await?;
    body["user_id"] = json!(collaborator);
    let other_host = format!("{}.{ROOT}", other.slug);
    send(
        app,
        &other_host,
        (&cc, &ct),
        "GET",
        week,
        None,
        StatusCode::UNAUTHORIZED,
    )
    .await?;
    let (oc, ot) = credentials(other, other.id).await?;
    send(
        app,
        &other_host,
        (&oc, &ot),
        "PUT",
        "/api/planning/entries",
        Some(body.clone()),
        StatusCode::NOT_FOUND,
    )
    .await?;
    // Any invalid item leaves all existing entries untouched.
    for (field, value) in [
        ("status", json!("unknown")),
        ("location_id", json!(Uuid::new_v4())),
        ("half", json!("night")),
        ("date", json!("2026-02-30")),
        ("note", json!("x".repeat(501))),
    ] {
        let mut invalid = body.clone();
        invalid["entries"][0]["note"] = json!("Must roll back");
        invalid["entries"][1][field] = value;
        send(
            app,
            &host,
            (&cookie, &csrf),
            "PUT",
            "/api/planning/entries",
            Some(invalid),
            StatusCode::UNPROCESSABLE_ENTITY,
        )
        .await?;
        assert_eq!(
            send(
                app,
                &host,
                (&cookie, &csrf),
                "GET",
                week,
                None,
                StatusCode::OK
            )
            .await?["entries"][0]["note"],
            "Client"
        );
    }
    let template = json!({"entries":[{"weekday":0,"half":"am","status":"office","location_id":location},{"weekday":5,"half":"pm","status":"travel","location_id":null}]});
    send(
        app,
        &host,
        (&cc, &ct),
        "PUT",
        "/api/planning/template",
        Some(template),
        StatusCode::OK,
    )
    .await?;
    assert_eq!(
        send(
            app,
            &host,
            (&cc, &ct),
            "GET",
            "/api/planning/template",
            None,
            StatusCode::OK
        )
        .await?["entries"]
            .as_array()
            .ok_or("template")?
            .len(),
        2
    );
    send(
        app,
        &host,
        (&cookie, &csrf),
        "DELETE",
        &format!("/api/locations/{location}"),
        None,
        StatusCode::CONFLICT,
    )
    .await?;
    for weeks in [0, 2, 5] {
        send(
            app,
            &host,
            (&cc, &ct),
            "POST",
            "/api/planning/template/apply",
            Some(json!({"start":"2026-10-26","weeks":weeks})),
            StatusCode::UNPROCESSABLE_ENTITY,
        )
        .await?;
    }
    send(
        app,
        &host,
        (&cc, &ct),
        "POST",
        "/api/planning/template/apply",
        Some(json!({"start":"2026-10-26","weeks":4})),
        StatusCode::OK,
    )
    .await?;
    for start in ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"] {
        let result = send(
            app,
            &host,
            (&cc, &ct),
            "GET",
            &format!("/api/planning/week?start={start}"),
            None,
            StatusCode::OK,
        )
        .await?;
        assert_eq!(result["entries"].as_array().ok_or("entries")?.len(), 2);
        assert_eq!(result["entries"][0]["note"], "");
        assert_eq!(result["entries"][1]["status"], "travel");
    }
    // Clearing a slot and editing another user as an administrator.
    body["entries"] = json!([{"date":"2026-10-26","half":"am","status":"none","location_id":null}]);
    send(
        app,
        &host,
        (&cookie, &csrf),
        "PUT",
        "/api/planning/entries",
        Some(body.clone()),
        StatusCode::OK,
    )
    .await?;
    assert_eq!(
        send(app, &host, (&cc, &ct), "GET", week, None, StatusCode::OK).await?["entries"]
            .as_array()
            .ok_or("entries")?
            .len(),
        1
    );
    sqlx::query("UPDATE users SET status='inactive' WHERE id=$1")
        .bind(collaborator)
        .execute(&tenant.pool)
        .await?;
    send(
        app,
        &host,
        (&cc, &ct),
        "GET",
        week,
        None,
        StatusCode::UNAUTHORIZED,
    )
    .await?;
    send(
        app,
        &host,
        (&cookie, &csrf),
        "PUT",
        "/api/planning/entries",
        Some(body),
        StatusCode::NOT_FOUND,
    )
    .await?;
    assert_eq!(
        send(
            app,
            &host,
            (&cookie, &csrf),
            "GET",
            week,
            None,
            StatusCode::OK
        )
        .await?["entries"],
        json!([])
    );
    // Batch limits are inclusive, and the whole range must fit in 28 civil days.
    let target = tenant.id;
    let slots: Vec<_> = (0..28).flat_map(|offset| ["am", "pm"].map(move |half| json!({"date": if offset < 6 { format!("2026-10-{:02}", 26 + offset) } else { format!("2026-11-{:02}", offset - 5) }, "half":half,"status":"remote","location_id":null}))).collect();
    send(
        app,
        &host,
        (&cookie, &csrf),
        "PUT",
        "/api/planning/entries",
        Some(json!({"user_id":target,"entries":slots})),
        StatusCode::OK,
    )
    .await?;
    for entries in [
        json!([]),
        json!([slots[0].clone(), slots[0].clone()]),
        json!([slots[0].clone(), {"date":"2026-11-23","half":"pm","status":"remote","location_id":null}]),
        json!((0..57).map(|_| slots[0].clone()).collect::<Vec<_>>()),
    ] {
        let result = send(
            app,
            &host,
            (&cookie, &csrf),
            "PUT",
            "/api/planning/entries",
            Some(json!({"user_id":target,"entries":entries})),
            StatusCode::UNPROCESSABLE_ENTITY,
        )
        .await?;
        assert!(result["fields"].get("entries").is_some());
    }
    // Fourteen template slots are accepted; oversize or duplicate replacements are rejected.
    let template_slots: Vec<_> = (0..7).flat_map(|weekday| ["am","pm"].map(move |half| json!({"weekday":weekday,"half":half,"status":"remote","location_id":null}))).collect();
    send(
        app,
        &host,
        (&cookie, &csrf),
        "PUT",
        "/api/planning/template",
        Some(json!({"entries":template_slots})),
        StatusCode::OK,
    )
    .await?;
    for entries in [
        json!(
            (0..15)
                .map(|_| template_slots[0].clone())
                .collect::<Vec<_>>()
        ),
        json!([template_slots[0].clone(), template_slots[0].clone()]),
        json!([{"weekday":7,"half":"am","status":"remote","location_id":null}]),
    ] {
        send(
            app,
            &host,
            (&cookie, &csrf),
            "PUT",
            "/api/planning/template",
            Some(json!({"entries":entries})),
            StatusCode::UNPROCESSABLE_ENTITY,
        )
        .await?;
    }
    send(
        app,
        &host,
        (&cookie, &csrf),
        "POST",
        "/api/planning/template/apply",
        Some(json!({"start":"9999-12-27","weeks":1})),
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await?;
    // Restore baseline for the organization lifecycle, retaining no test references.
    sqlx::query("DELETE FROM presence_entries")
        .execute(&tenant.pool)
        .await?;
    sqlx::query("DELETE FROM presence_templates")
        .execute(&tenant.pool)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id=$1")
        .bind(collaborator)
        .execute(&tenant.pool)
        .await?;
    sqlx::query("DELETE FROM users WHERE id=$1")
        .bind(collaborator)
        .execute(&tenant.pool)
        .await?;
    sqlx::query("DELETE FROM locations WHERE id=$1")
        .bind(location)
        .execute(&tenant.pool)
        .await?;
    send(
        app,
        &host,
        (&cookie, &csrf),
        "PUT",
        "/api/planning/settings",
        Some(json!({"work_days":[0,1,2,3,4]})),
        StatusCode::OK,
    )
    .await?;
    Ok(())
}
