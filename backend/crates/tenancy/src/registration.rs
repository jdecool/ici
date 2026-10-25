//! Workspace reservation use case. The storage port reserves and queues email atomically.
use crate::normalize_slug;
use std::future::Future;

pub const RESERVATION_SECONDS: i64 = 24 * 60 * 60;
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum ReservationError {
    InvalidSlug,
    AlreadyReserved,
    Unavailable,
}
pub struct PendingReservation {
    pub slug: String,
    pub receipt: String,
}
pub trait Reservations {
    fn reserve(
        &self,
        slug: &str,
        lifetime_seconds: i64,
    ) -> impl Future<Output = Result<String, ReservationError>> + Send;
}
pub async fn register(
    slug: &str,
    reservations: &impl Reservations,
) -> Result<PendingReservation, ReservationError> {
    let slug = normalize_slug(slug).ok_or(ReservationError::InvalidSlug)?;
    let receipt = reservations.reserve(&slug, RESERVATION_SECONDS).await?;
    Ok(PendingReservation { slug, receipt })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        future::ready,
        sync::atomic::{AtomicUsize, Ordering},
        task::{Context, Poll, Waker},
    };
    struct Registry {
        error: Option<ReservationError>,
        calls: AtomicUsize,
    }
    impl Reservations for Registry {
        fn reserve(
            &self,
            slug: &str,
            lifetime_seconds: i64,
        ) -> impl Future<Output = Result<String, ReservationError>> + Send {
            assert_eq!(slug, "acme");
            assert_eq!(lifetime_seconds, 86400);
            self.calls.fetch_add(1, Ordering::SeqCst);
            ready(self.error.map_or_else(|| Ok("receipt".into()), Err))
        }
    }
    fn run<T>(future: impl Future<Output = T>) -> T {
        let mut future = std::pin::pin!(future);
        match future
            .as_mut()
            .poll(&mut Context::from_waker(Waker::noop()))
        {
            Poll::Ready(result) => result,
            Poll::Pending => panic!("Test port must complete immediately"),
        }
    }
    #[test]
    fn normalizes_names_and_preserves_atomic_reservation_failures() -> Result<(), ReservationError>
    {
        let registry = Registry {
            error: None,
            calls: AtomicUsize::new(0),
        };
        let pending = run(register("ACME", &registry))?;
        assert_eq!(pending.slug, "acme");
        assert_eq!(pending.receipt, "receipt");
        assert_eq!(registry.calls.load(Ordering::SeqCst), 1);
        for error in [
            ReservationError::AlreadyReserved,
            ReservationError::Unavailable,
        ] {
            let registry = Registry {
                error: Some(error),
                calls: AtomicUsize::new(0),
            };
            assert_eq!(run(register("acme", &registry)).err(), Some(error));
        }
        Ok(())
    }
    #[test]
    fn invalid_names_never_reach_storage() {
        let registry = Registry {
            error: None,
            calls: AtomicUsize::new(0),
        };
        assert_eq!(
            run(register("api", &registry)).err(),
            Some(ReservationError::InvalidSlug)
        );
        assert_eq!(registry.calls.load(Ordering::SeqCst), 0);
    }
}
