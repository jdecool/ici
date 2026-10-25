use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub(crate) struct GreetingResponse {
    message: &'static str,
}

pub(crate) async fn hello() -> Json<GreetingResponse> {
    Json(GreetingResponse {
        message: greeting::hello(),
    })
}
