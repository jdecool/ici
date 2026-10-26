use crate::{
    identity::Error,
    tenancy::{http::Context, registry::State},
};
use axum::{
    extract::{ConnectInfo, Request, State as ExtractState},
    http::{HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::net::SocketAddr;

pub async fn guard(
    ExtractState(state): ExtractState<State>,
    request: Request,
    next: Next,
) -> Response {
    let (mut parts, body) = request.into_parts();
    let result = validate(&state, &parts).await;
    let mut response = match result {
        Ok(context) => {
            parts.extensions.insert(context);
            next.run(Request::from_parts(parts, body)).await
        }
        Err(error) => error.into_response(),
    };
    response
        .headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-store"));
    response
        .headers_mut()
        .insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    response.headers_mut().insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    response
}
async fn validate(state: &State, request: &axum::http::request::Parts) -> Result<Context, Error> {
    let host = request
        .headers
        .get("host")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| Error::new(StatusCode::BAD_REQUEST, "invalid_host"))?;
    let authority: axum::http::uri::Authority = host
        .parse()
        .map_err(|_| Error::new(StatusCode::BAD_REQUEST, "invalid_host"))?;
    let canonical = match authority.port_u16() {
        Some(port) => format!("{}:{port}", authority.host()),
        None => authority.host().to_owned(),
    };
    if !host.eq_ignore_ascii_case(&canonical) {
        return Err(Error::new(StatusCode::BAD_REQUEST, "invalid_host"));
    }
    let expected = url::Url::parse(&state.config.public_origin).map_err(Error::internal_from)?;
    if authority
        .port_u16()
        .unwrap_or(if state.config.secure { 443 } else { 80 })
        != expected
            .port_or_known_default()
            .ok_or_else(Error::internal)?
    {
        return Err(Error::new(StatusCode::BAD_REQUEST, "invalid_host"));
    }
    let slug = crate::tenancy::rules::tenant_from_host(authority.host(), &state.config.root_domain)
        .map_err(|_| Error::new(StatusCode::BAD_REQUEST, "invalid_host"))?;
    if let Some(slug) = &slug {
        state.tenant(slug).await?;
    }
    let path = request.uri.path();
    if (path.starts_with("/api/registrations") || path.starts_with("/api/tenants"))
        && slug.is_some()
    {
        return Err(Error::new(StatusCode::NOT_FOUND, "root_origin_required"));
    }
    if request.method != Method::GET && request.method != Method::HEAD {
        let origin = request
            .headers
            .get("origin")
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| Error::new(StatusCode::FORBIDDEN, "invalid_origin"))?;
        let allowed = slug
            .as_deref()
            .map(|slug| state.config.tenant_origin(slug))
            .unwrap_or_else(|| state.config.public_origin.clone());
        if origin != allowed
            && !(path == "/api/auth/handoff" && origin == state.config.public_origin)
        {
            return Err(Error::new(StatusCode::FORBIDDEN, "invalid_origin"));
        }
        let ip = client_ip(request, state.config.trust_proxy);
        state.limit(&format!("ip:{ip}"), 100).await?;
        if let Some(slug) = &slug {
            state.limit(&format!("tenant:{slug}"), 500).await?;
        }
    }
    Ok(Context { slug })
}

fn client_ip(request: &axum::http::request::Parts, trust_proxy: bool) -> String {
    if trust_proxy
        && let Some(ip) = request
            .headers
            .get("x-real-ip")
            .and_then(|header| header.to_str().ok())
            .and_then(|value| value.parse::<std::net::IpAddr>().ok())
    {
        return ip.to_string();
    }
    request
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|connection| connection.0.ip().to_string())
        .unwrap_or_else(|| "unknown".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_forwarded_addresses_only_from_configured_proxy()
    -> Result<(), Box<dyn std::error::Error>> {
        let (mut parts, _) = Request::builder()
            .header("x-real-ip", "192.0.2.1")
            .body(axum::body::Body::empty())?
            .into_parts();
        parts
            .extensions
            .insert(ConnectInfo("127.0.0.1:1234".parse::<SocketAddr>()?));
        assert_eq!(client_ip(&parts, true), "192.0.2.1");
        assert_eq!(client_ip(&parts, false), "127.0.0.1");
        parts
            .headers
            .insert("x-real-ip", HeaderValue::from_static("invalid"));
        assert_eq!(client_ip(&parts, true), "127.0.0.1");
        parts.extensions.clear();
        assert_eq!(client_ip(&parts, false), "unknown");
        Ok(())
    }
}
