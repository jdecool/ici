//! Runtime configuration. Secrets may be supplied using *_FILE paths.
use std::env;
use url::Url;

#[derive(Clone)]
pub struct Config {
    pub root_domain: String,
    pub public_origin: String,
    pub secure: bool,
    pub trust_proxy: bool,
    pub central_url: String,
    pub encryption_key: Vec<u8>,
}

pub fn setting(name: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    if let Ok(path) = env::var(format!("{name}_FILE")) {
        return Ok(std::fs::read_to_string(path)?.trim().to_owned());
    }
    Ok(env::var(name)?)
}

impl Config {
    pub fn from_env() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let mut config = Self::parse(
            &setting("ROOT_DOMAIN")?,
            &setting("PUBLIC_ORIGIN")?,
            &setting("REGISTRY_KEY")?,
            &setting("CENTRAL_DATABASE_URL")?,
        )?;
        config.trust_proxy = setting("TRUST_PROXY").is_ok_and(trusted_proxy);
        Ok(config)
    }
    pub fn parse(
        root: &str,
        origin: &str,
        key: &str,
        central_url: &str,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let public = Url::parse(origin)?;
        let root_domain = root.to_ascii_lowercase();
        if public.host_str() != Some(root_domain.as_str())
            || !["http", "https"].contains(&public.scheme())
            || public.path() != "/"
            || public.query().is_some()
            || public.fragment().is_some()
            || !public.username().is_empty()
            || public.password().is_some()
        {
            return Err("PUBLIC_ORIGIN must be the root domain origin".into());
        }
        let encryption_key = hex::decode(key)?;
        if encryption_key.len() != 32 {
            return Err("REGISTRY_KEY must contain 32 hex-encoded bytes".into());
        }
        Ok(Self {
            root_domain,
            public_origin: public.origin().ascii_serialization(),
            secure: public.scheme() == "https",
            trust_proxy: false,
            central_url: central_url.into(),
            encryption_key,
        })
    }
    pub fn tenant_origin(&self, slug: &str) -> String {
        let scheme = if self.secure { "https" } else { "http" };
        let port = Url::parse(&self.public_origin)
            .ok()
            .and_then(|url| url.port())
            .map(|port| format!(":{port}"))
            .unwrap_or_default();
        format!("{scheme}://{slug}.{}{port}", self.root_domain)
    }
}

fn trusted_proxy(value: String) -> bool {
    value == "true"
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configured_origin_boundaries() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        assert!(trusted_proxy("true".into()));
        assert!(!trusted_proxy("false".into()));
        assert!(!trusted_proxy("".into()));
        let key = "01".repeat(32);
        let config = Config::parse(
            "EXAMPLE.COM",
            "https://example.com",
            &key,
            "postgres://db/ici",
        )?;
        assert!(config.secure);
        assert_eq!(config.tenant_origin("acme"), "https://acme.example.com");
        for origin in [
            "ftp://example.com",
            "https://evil.example",
            "https://example.com/path",
            "https://example.com?query",
            "https://example.com#fragment",
            "https://user@example.com",
            "https://user:pass@example.com",
            "invalid",
        ] {
            assert!(
                Config::parse("example.com", origin, &key, "postgres://db/ici").is_err(),
                "{origin}"
            );
        }
        assert!(
            Config::parse(
                "example.com",
                "https://example.com",
                "00",
                "postgres://db/ici"
            )
            .is_err()
        );
        assert!(
            Config::parse(
                "example.com",
                "https://example.com",
                "zz",
                "postgres://db/ici"
            )
            .is_err()
        );
        assert_eq!(
            Config::parse(
                "example.com",
                "http://example.com:8080",
                &key,
                "postgres://db/ici"
            )?
            .tenant_origin("acme"),
            "http://acme.example.com:8080"
        );
        assert!(setting("ICI_NONEXISTENT_TEST_SETTING").is_err());
        Ok(())
    }
}
