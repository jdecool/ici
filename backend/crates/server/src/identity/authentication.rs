//! Tenant-scoped authentication use case and its outgoing ports.
use super::rules::normalize_email;
use std::future::Future;

pub struct Account {
    pub id: String,
    pub password_hash: String,
    pub credential_version: i32,
}
#[derive(Debug, PartialEq, Eq)]
pub struct Unavailable;
#[derive(Debug, PartialEq, Eq)]
pub enum LoginError {
    InvalidEmail,
    InvalidCredentials,
    Unavailable,
    RateLimited,
}
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum AccountAccessError {
    Unavailable,
    RateLimited,
}
impl From<AccountAccessError> for LoginError {
    fn from(error: AccountAccessError) -> Self {
        match error {
            AccountAccessError::Unavailable => Self::Unavailable,
            AccountAccessError::RateLimited => Self::RateLimited,
        }
    }
}
impl From<Unavailable> for LoginError {
    fn from(_: Unavailable) -> Self {
        Self::Unavailable
    }
}

/// One tenant's account lookup and atomic, short-lived transfer creation.
pub trait Accounts {
    fn credentials(
        &self,
        email: &str,
    ) -> impl Future<Output = Result<Option<Account>, AccountAccessError>> + Send;
    fn issue_transfer(
        &self,
        account: Account,
        remember: bool,
    ) -> impl Future<Output = Result<String, AccountAccessError>> + Send;
}
/// Password verification includes dummy work for unknown accounts.
pub trait PasswordVerification {
    fn verify(
        &self,
        password: &str,
        hash: Option<&str>,
    ) -> impl Future<Output = Result<bool, Unavailable>> + Send;
}

pub async fn login(
    accounts: &impl Accounts,
    passwords: &impl PasswordVerification,
    email: &str,
    password: &str,
    remember: bool,
) -> Result<String, LoginError> {
    let email = normalize_email(email).ok_or(LoginError::InvalidEmail)?;
    let account = accounts.credentials(&email).await?;
    let verified = passwords
        .verify(
            password,
            account
                .as_ref()
                .map(|account| account.password_hash.as_str()),
        )
        .await?;
    if !verified {
        return Err(LoginError::InvalidCredentials);
    }
    let account = account.ok_or(LoginError::InvalidCredentials)?;
    Ok(accounts.issue_transfer(account, remember).await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        future::ready,
        sync::atomic::{AtomicUsize, Ordering},
        task::{Context, Poll, Waker},
    };
    fn run<T>(future: impl Future<Output = T>) -> T {
        let mut future = std::pin::pin!(future);
        match future
            .as_mut()
            .poll(&mut Context::from_waker(Waker::noop()))
        {
            Poll::Ready(result) => result,
            Poll::Pending => panic!("Test ports must complete immediately"),
        }
    }
    struct Store {
        missing: bool,
        fail_lookup: bool,
        fail_issue: bool,
        calls: AtomicUsize,
    }
    impl Accounts for Store {
        fn credentials(
            &self,
            email: &str,
        ) -> impl Future<Output = Result<Option<Account>, AccountAccessError>> + Send {
            assert_eq!(email, "owner@example.com");
            self.calls.fetch_add(1, Ordering::SeqCst);
            ready(if self.fail_lookup {
                Err(AccountAccessError::Unavailable)
            } else if self.missing {
                Ok(None)
            } else {
                Ok(Some(Account {
                    id: "account".into(),
                    password_hash: "stored-hash".into(),
                    credential_version: 4,
                }))
            })
        }
        fn issue_transfer(
            &self,
            account: Account,
            remember: bool,
        ) -> impl Future<Output = Result<String, AccountAccessError>> + Send {
            assert_eq!(account.id, "account");
            assert_eq!(account.credential_version, 4);
            assert_eq!(account.password_hash, "stored-hash");
            assert!(remember);
            self.calls.fetch_add(1, Ordering::SeqCst);
            ready(if self.fail_issue {
                Err(AccountAccessError::Unavailable)
            } else {
                Ok("one-use-transfer".into())
            })
        }
    }
    struct Passwords {
        verified: bool,
        fail: bool,
        calls: AtomicUsize,
        missing: bool,
    }
    impl PasswordVerification for Passwords {
        fn verify(
            &self,
            password: &str,
            hash: Option<&str>,
        ) -> impl Future<Output = Result<bool, Unavailable>> + Send {
            assert_eq!(password, "a secure pass phrase");
            assert_eq!(
                hash,
                if self.missing {
                    None
                } else {
                    Some("stored-hash")
                }
            );
            self.calls.fetch_add(1, Ordering::SeqCst);
            ready(if self.fail {
                Err(Unavailable)
            } else {
                Ok(self.verified)
            })
        }
    }
    #[test]
    fn authenticates_only_verified_accounts_and_propagates_outages() {
        for (missing, verified, fail_lookup, fail_verify, fail_issue, result) in [
            (
                false,
                true,
                false,
                false,
                false,
                Ok("one-use-transfer".into()),
            ),
            (
                false,
                false,
                false,
                false,
                false,
                Err(LoginError::InvalidCredentials),
            ),
            (
                true,
                false,
                false,
                false,
                false,
                Err(LoginError::InvalidCredentials),
            ),
            (
                true,
                true,
                false,
                false,
                false,
                Err(LoginError::InvalidCredentials),
            ),
            (
                false,
                true,
                true,
                false,
                false,
                Err(LoginError::Unavailable),
            ),
            (
                false,
                true,
                false,
                true,
                false,
                Err(LoginError::Unavailable),
            ),
            (
                false,
                true,
                false,
                false,
                true,
                Err(LoginError::Unavailable),
            ),
        ] {
            let store = Store {
                missing,
                fail_lookup,
                fail_issue,
                calls: AtomicUsize::new(0),
            };
            let passwords = Passwords {
                verified,
                fail: fail_verify,
                calls: AtomicUsize::new(0),
                missing,
            };
            assert_eq!(
                run(login(
                    &store,
                    &passwords,
                    " OWNER@Example.com ",
                    "a secure pass phrase",
                    true
                )),
                result
            );
            assert_eq!(
                passwords.calls.load(Ordering::SeqCst),
                usize::from(!fail_lookup)
            );
        }
    }
    #[test]
    fn rejects_invalid_email_before_accessing_accounts() {
        let store = Store {
            missing: false,
            fail_lookup: false,
            fail_issue: false,
            calls: AtomicUsize::new(0),
        };
        let passwords = Passwords {
            verified: true,
            fail: false,
            calls: AtomicUsize::new(0),
            missing: false,
        };
        assert_eq!(
            run(login(
                &store,
                &passwords,
                "invalid",
                "a secure pass phrase",
                true
            )),
            Err(LoginError::InvalidEmail)
        );
        assert_eq!(store.calls.load(Ordering::SeqCst), 0);
        assert_eq!(passwords.calls.load(Ordering::SeqCst), 0);
    }
}
