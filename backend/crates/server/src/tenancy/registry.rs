use crate::{
    config::Config,
    identity::{Error, crypto},
};
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone)]
pub struct State {
    pub config: Arc<Config>,
    pub central: PgPool,
    pools: Arc<Mutex<HashMap<Uuid, CachedPool>>>,
    pub dummy_hash: String,
}
struct CachedPool {
    pool: PgPool,
    last_used: Instant,
}
pub struct Tenant {
    pub id: Uuid,
    pub slug: String,
    pub pool: PgPool,
}
impl State {
    pub async fn connect(config: Config) -> Result<Self, Error> {
        let central = PgPoolOptions::new()
            .max_connections(8)
            .connect(&config.central_url)
            .await?;
        Ok(Self {
            config: Arc::new(config),
            central,
            pools: Arc::default(),
            dummy_hash: crypto::hash_password(crypto::token()).await?,
        })
    }
    pub async fn tenant(&self, slug: &str) -> Result<Tenant, Error> {
        let row =
            sqlx::query("SELECT id, database_secret FROM tenants WHERE slug=$1 AND state='active'")
                .bind(slug)
                .fetch_optional(&self.central)
                .await?
                .ok_or_else(|| Error::new(axum::http::StatusCode::NOT_FOUND, "unknown_tenant"))?;
        let id: Uuid = row.get("id");
        let mut pools = self.pools.lock().await;
        let now = Instant::now();
        prune_idle(&mut pools, now).await;
        if let Some(cached) = pools.get_mut(&id) {
            cached.last_used = now;
            return Ok(Tenant {
                id,
                slug: slug.into(),
                pool: cached.pool.clone(),
            });
        }
        make_room(&mut pools).await;
        let secret: String = row.get("database_secret");
        let url = crypto::decrypt(&self.config.encryption_key, &secret)?;
        let pool = PgPoolOptions::new()
            .max_connections(4)
            .idle_timeout(Duration::from_secs(60))
            .connect(&url)
            .await?;
        pools.insert(
            id,
            CachedPool {
                pool: pool.clone(),
                last_used: now,
            },
        );
        Ok(Tenant {
            id,
            slug: slug.into(),
            pool,
        })
    }
    pub async fn limit(&self, key: &str, maximum: i32) -> Result<(), Error> {
        let count: i32 = sqlx::query_scalar("INSERT INTO rate_limits (key) VALUES ($1) ON CONFLICT (key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at < now() THEN 1 ELSE rate_limits.count+1 END, expires_at=CASE WHEN rate_limits.expires_at < now() THEN now()+interval '15 minutes' ELSE rate_limits.expires_at END RETURNING count")
            .bind(crypto::digest(key)).fetch_one(&self.central).await?;
        if count > maximum {
            return Err(Error::new(
                axum::http::StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
            ));
        }
        Ok(())
    }
}

pub async fn enqueue(
    connection: &mut sqlx::PgConnection,
    state: &State,
    email: &str,
    subject: &str,
    body: &str,
) -> Result<(), Error> {
    let payload = serde_json::json!({"email": email, "subject": subject, "body": body}).to_string();
    let encrypted = crypto::encrypt(&state.config.encryption_key, &payload)?;
    sqlx::query("INSERT INTO outbox (id,payload) VALUES ($1,$2)")
        .bind(Uuid::new_v4())
        .bind(encrypted)
        .execute(connection)
        .await?;
    Ok(())
}

async fn prune_idle(pools: &mut HashMap<Uuid, CachedPool>, now: Instant) {
    let stale: Vec<_> = pools
        .iter()
        .filter(|(_, cached)| now.duration_since(cached.last_used) >= Duration::from_secs(300))
        .map(|(id, _)| *id)
        .collect();
    for id in stale {
        if let Some(cached) = pools.remove(&id) {
            cached.pool.close().await;
        }
    }
}

async fn make_room(pools: &mut HashMap<Uuid, CachedPool>) {
    if pools.len() == 16 {
        let oldest = pools
            .iter()
            .min_by_key(|(_, cached)| cached.last_used)
            .map(|(id, _)| *id);
        if let Some(id) = oldest
            && let Some(cached) = pools.remove(&id)
        {
            cached.pool.close().await;
        }
    }
}

pub async fn verification_mail(
    connection: &mut sqlx::PgConnection,
    state: &State,
    email: &str,
    slug: &str,
    token: &str,
) -> Result<(), Error> {
    enqueue(connection, state, email, "Confirmez votre adresse email — Ici", &format!("Confirmez votre adresse email en ouvrant ce lien puis en activant votre entreprise « {slug} » :\n{}/verify#token={token}\nCe lien expire dans 24 heures.", state.config.public_origin)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pool() -> Result<PgPool, sqlx::Error> {
        PgPoolOptions::new().connect_lazy("postgres://unused@localhost/unused")
    }
    #[tokio::test]
    async fn closes_idle_resources_at_the_expiration_boundary() -> Result<(), sqlx::Error> {
        let now = Instant::now();
        let expired = pool()?;
        let fresh = pool()?;
        let mut pools = HashMap::from([
            (
                Uuid::new_v4(),
                CachedPool {
                    pool: expired.clone(),
                    last_used: now,
                },
            ),
            (
                Uuid::new_v4(),
                CachedPool {
                    pool: fresh.clone(),
                    last_used: now + Duration::from_secs(1),
                },
            ),
        ]);
        prune_idle(&mut pools, now + Duration::from_secs(299)).await;
        assert!(!expired.is_closed());
        assert!(!fresh.is_closed());
        prune_idle(&mut pools, now + Duration::from_secs(300)).await;
        assert!(expired.is_closed());
        assert!(!fresh.is_closed());
        prune_idle(&mut pools, now + Duration::from_secs(302)).await;
        assert!(fresh.is_closed());
        assert!(pools.is_empty());
        Ok(())
    }
    #[tokio::test]
    async fn closes_the_least_recently_used_pool_only_at_capacity() -> Result<(), sqlx::Error> {
        let now = Instant::now();
        let oldest = pool()?;
        let mut pools = HashMap::from([(
            Uuid::new_v4(),
            CachedPool {
                pool: oldest.clone(),
                last_used: now,
            },
        )]);
        make_room(&mut pools).await;
        assert!(!oldest.is_closed());
        let mut recent = Vec::new();
        for offset in 1..16 {
            let pool = pool()?;
            recent.push(pool.clone());
            pools.insert(
                Uuid::new_v4(),
                CachedPool {
                    pool,
                    last_used: now + Duration::from_secs(offset),
                },
            );
        }
        make_room(&mut pools).await;
        assert!(oldest.is_closed());
        assert!(recent.iter().all(|pool| !pool.is_closed()));
        assert_eq!(pools.len(), 15);
        Ok(())
    }
}
