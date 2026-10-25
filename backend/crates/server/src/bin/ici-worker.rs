use ici_server::{
    config::{Config, setting},
    tenancy::{registry::State, worker},
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt().json().init();
    let config = Config::from_env()?;
    let admin_url = setting("PROVISIONER_DATABASE_URL")?;
    let admin = worker::initialize(&config, &admin_url).await?;
    let state = State::connect(config).await?;
    let migrate_all = std::env::args().any(|argument| argument == "--migrate-tenants");
    loop {
        if let Err(error) = worker::tick(&state, &admin, &admin_url, migrate_all).await {
            tracing::error!(code = error.code, "Background cycle failed");
            if migrate_all {
                return Err(error.into());
            }
        }
        if migrate_all {
            return Ok(());
        }
        std::fs::write("/tmp/ici-worker-ready", "ready")?;
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}
