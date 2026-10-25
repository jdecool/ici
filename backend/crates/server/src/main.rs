use std::{env, net::SocketAddr};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let filter = match env::var("RUST_LOG") {
        Ok(value) => EnvFilter::try_new(value)?,
        Err(env::VarError::NotPresent) => EnvFilter::new("info,tower_http=debug"),
        Err(error) => return Err(error.into()),
    };
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .json()
        .init();
    let address: SocketAddr = match env::var("BIND_ADDRESS") {
        Ok(value) => value.parse()?,
        Err(env::VarError::NotPresent) => "0.0.0.0:3000".parse()?,
        Err(error) => return Err(error.into()),
    };
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(%address, "HTTP server listening");
    axum::serve(listener, ici_server::router())
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

async fn shutdown() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        match signal(SignalKind::terminate()) {
            Ok(mut terminate) => tokio::select! {
                result = tokio::signal::ctrl_c() => {
                    if let Err(error) = result { tracing::error!(%error, "Signal handler failed"); }
                }
                _ = terminate.recv() => {}
            },
            Err(error) => tracing::error!(%error, "Cannot install termination handler"),
        }
    }
    #[cfg(not(unix))]
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::error!(%error, "Signal handler failed");
    }
}
