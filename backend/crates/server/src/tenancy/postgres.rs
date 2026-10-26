//! Atomic PostgreSQL reservation and encrypted outbox adapter.
use super::registry::{State, verification_mail};
use crate::identity::{Error, crypto};
use crate::tenancy::registration::{ReservationError, Reservations};
use uuid::Uuid;

pub struct Registration<'a> {
    pub state: &'a State,
    pub first_name: &'a str,
    pub last_name: &'a str,
    pub email: &'a str,
    pub password_hash: &'a str,
}
impl Reservations for Registration<'_> {
    async fn reserve(&self, slug: &str, lifetime_seconds: i64) -> Result<String, ReservationError> {
        self.persist(slug, lifetime_seconds).await.map_err(|error| {
            if error.code == "slug_unavailable" {
                ReservationError::AlreadyReserved
            } else {
                ReservationError::Unavailable
            }
        })
    }
}
impl Registration<'_> {
    async fn persist(&self, slug: &str, lifetime_seconds: i64) -> Result<String, Error> {
        let receipt = crypto::token();
        let verification = crypto::token();
        let mut transaction = self.state.central.begin().await?;
        sqlx::query("DELETE FROM tenants WHERE slug=$1 AND state='pending' AND expires_at<=now()")
            .bind(slug)
            .execute(&mut *transaction)
            .await?;
        let result=sqlx::query("INSERT INTO tenants (id,slug,state,first_name,last_name,email,password_hash,terms_version,verification_hash,receipt_hash,expires_at) VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,now()+make_interval(secs=>$10))")
            .bind(Uuid::new_v4()).bind(slug).bind(self.first_name.trim()).bind(self.last_name.trim()).bind(self.email).bind(self.password_hash).bind(crate::identity::rules::TERMS_VERSION).bind(crypto::digest(&verification)).bind(crypto::digest(&receipt)).bind(lifetime_seconds as f64).execute(&mut *transaction).await;
        if let Err(error) = result {
            if error
                .as_database_error()
                .is_some_and(|error| error.is_unique_violation())
            {
                return Err(Error::new(
                    axum::http::StatusCode::CONFLICT,
                    "slug_unavailable",
                ));
            }
            return Err(error.into());
        }
        verification_mail(
            &mut transaction,
            self.state,
            self.email,
            slug,
            &verification,
        )
        .await?;
        transaction.commit().await?;
        Ok(receipt)
    }
}
