//! Tenant account and cryptographic adapters for the identity use case.
use super::crypto;
use crate::tenancy::registry::State;
use ::identity::authentication::{
    Account, AccountAccessError, Accounts, PasswordVerification, Unavailable,
};
use sqlx::Row;
use uuid::Uuid;

pub struct TenantAccounts<'a> {
    pub state: &'a State,
    pub slug: &'a str,
}
impl Accounts for TenantAccounts<'_> {
    async fn credentials(&self, email: &str) -> Result<Option<Account>, AccountAccessError> {
        self.state
            .limit(&format!("login:{}:{email}", self.slug), 10)
            .await
            .map_err(|error| {
                if error.code == "rate_limited" {
                    AccountAccessError::RateLimited
                } else {
                    AccountAccessError::Unavailable
                }
            })?;
        let tenant = match self.state.tenant(self.slug).await {
            Ok(tenant) => tenant,
            Err(error) if error.code == "unknown_tenant" => return Ok(None),
            Err(_) => return Err(AccountAccessError::Unavailable),
        };
        let row =
            sqlx::query("SELECT id,password_hash,credential_version FROM users WHERE email=$1")
                .bind(email)
                .fetch_optional(&tenant.pool)
                .await
                .map_err(|_| AccountAccessError::Unavailable)?;
        Ok(row.map(|row| Account {
            id: row.get::<Uuid, _>("id").to_string(),
            password_hash: row.get("password_hash"),
            credential_version: row.get("credential_version"),
        }))
    }
    async fn issue_transfer(
        &self,
        account: Account,
        remember: bool,
    ) -> Result<String, AccountAccessError> {
        let tenant = self
            .state
            .tenant(self.slug)
            .await
            .map_err(|_| AccountAccessError::Unavailable)?;
        let user = Uuid::parse_str(&account.id).map_err(|_| AccountAccessError::Unavailable)?;
        let code = crypto::token();
        sqlx::query("INSERT INTO handoffs (token_hash,tenant_id,user_id,remember,credential_version,expires_at) VALUES ($1,$2,$3,$4,$5,now()+make_interval(secs=>$6))")
            .bind(crypto::digest(&code)).bind(tenant.id).bind(user).bind(remember).bind(account.credential_version).bind(identity::HANDOFF_SECONDS as f64).execute(&self.state.central).await.map_err(|_|AccountAccessError::Unavailable)?;
        Ok(code)
    }
}
pub struct Passwords<'a> {
    pub state: &'a State,
}
impl PasswordVerification for Passwords<'_> {
    async fn verify(&self, password: &str, hash: Option<&str>) -> Result<bool, Unavailable> {
        crypto::verify_password(
            password.to_owned(),
            hash.unwrap_or(&self.state.dummy_hash).to_owned(),
        )
        .await
        .map_err(|_| Unavailable)
    }
}
