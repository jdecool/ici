//! Real-database fixture replacement contract in the isolated tools stack.
use ici_server::{
    config::Config,
    identity::crypto,
    tenancy::{fixtures, registry::State, worker},
};
use sqlx::Row;
use uuid::Uuid;

#[tokio::test]
async fn replaces_only_acme_with_usable_accounts_and_current_planning()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    assert_eq!(std::env::var("ICI_TEST_DATABASE")?, "1");
    let admin_url = std::env::var("TEST_DATABASE_URL")?;
    let config = Config {
        root_domain: "ici.localhost".into(),
        public_origin: "http://ici.localhost:5173".into(),
        secure: false,
        trust_proxy: false,
        central_url: admin_url.replace(
            "postgres:local-provisioner-only",
            "ici_registry:local-registry-only",
        ),
        encryption_key: vec![7; 32],
    };
    let admin = worker::initialize(&config, &admin_url).await?;
    let state = State::connect(config).await?;
    let other = Uuid::new_v4();
    sqlx::query("INSERT INTO tenants(id,slug,state,terms_version,receipt_hash) VALUES ($1,$2,'pending','test',$2)").bind(other).bind(format!("other-{}",other.simple())).execute(&admin).await?;
    fixtures::load(&state, &admin, &admin_url).await?;
    let tenant = state.tenant("acme").await?;
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT name FROM company")
            .fetch_one(&tenant.pool)
            .await?,
        "ACME"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM users WHERE status='active'")
            .fetch_one(&tenant.pool)
            .await?,
        10
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM locations")
            .fetch_one(&tenant.pool)
            .await?,
        3
    );
    for (email, role) in [
        ("admin@example.com", "admin"),
        ("user@example.com", "collaborator"),
    ] {
        let row = sqlx::query("SELECT role,password_hash FROM users WHERE email=$1")
            .bind(email)
            .fetch_one(&tenant.pool)
            .await?;
        assert_eq!(row.get::<String, _>("role"), role);
        assert!(crypto::verify_password("password".into(), row.get("password_hash")).await?);
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM presence_entries")
            .fetch_one(&tenant.pool)
            .await?,
        500
    );
    for comparison in ["<", ">"] {
        assert!(sqlx::query_scalar::<_,i64>(&format!("SELECT count(*) FROM presence_entries WHERE date {comparison} (now() AT TIME ZONE 'Europe/Paris')::date")).fetch_one(&tenant.pool).await? > 0);
    }
    sqlx::query("UPDATE company SET name='Changed'")
        .execute(&tenant.pool)
        .await?;
    fixtures::load(&state, &admin, &admin_url).await?;
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT name FROM company")
            .fetch_one(&tenant.pool)
            .await?,
        "ACME"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM users")
            .fetch_one(&tenant.pool)
            .await?,
        10
    );
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT FROM tenants WHERE id=$1)")
            .bind(other)
            .fetch_one(&admin)
            .await?
    );
    sqlx::query("DELETE FROM tenants WHERE id=$1")
        .bind(other)
        .execute(&admin)
        .await?;
    Ok(())
}
