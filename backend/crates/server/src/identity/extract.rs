//! Keep malformed transport input on the same stable JSON error contract.
use super::Error;
use axum::{
    Form, Json,
    extract::{FromRequest, Request},
};
use serde::de::DeserializeOwned;

pub struct JsonBody<T>(pub T);
impl<S, T> FromRequest<S> for JsonBody<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = Error;
    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        Json::<T>::from_request(request, state)
            .await
            .map(|Json(value)| Self(value))
            .map_err(|_| Error::field("body"))
    }
}
pub struct FormBody<T>(pub T);
impl<S, T> FromRequest<S> for FormBody<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = Error;
    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        Form::<T>::from_request(request, state)
            .await
            .map(|Form(value)| Self(value))
            .map_err(|_| Error::field("body"))
    }
}
