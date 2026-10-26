use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::json;
use tower::ServiceExt;

type TestResult = Result<(), Box<dyn std::error::Error>>;

#[tokio::test]
async fn health_contract() -> TestResult {
    let response = ici_server::router()
        .oneshot(Request::builder().uri("/health").body(Body::empty())?)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "application/json");
    let body = response.into_body().collect().await?.to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body)?,
        json!({"status": "ok"})
    );
    Ok(())
}

#[tokio::test]
async fn unknown_routes_are_not_found() -> TestResult {
    let response = ici_server::router()
        .oneshot(Request::builder().uri("/missing").body(Body::empty())?)
        .await?;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    Ok(())
}
