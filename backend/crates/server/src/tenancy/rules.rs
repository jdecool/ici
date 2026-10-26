//! Tenant naming and host isolation rules, independent of transport and storage.

/// Normalize a public workspace name, rejecting reserved infrastructure names.
pub fn normalize_slug(value: &str) -> Option<String> {
    let slug = value.to_ascii_lowercase();
    if !(3..=63).contains(&slug.len())
        || !slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        || slug.starts_with('-')
        || slug.ends_with('-')
        || [
            "www",
            "api",
            "admin",
            "mail",
            "support",
            "smtp",
            "status",
            "static",
            "assets",
            "localhost",
        ]
        .contains(&slug.as_str())
    {
        return None;
    }
    Some(slug)
}

/// Resolve exactly one tenant label under a configured root. The caller removes the port.
pub fn tenant_from_host(host: &str, root: &str) -> Result<Option<String>, InvalidHost> {
    let host = host.to_ascii_lowercase();
    if host == root {
        return Ok(None);
    }
    let prefix = host.strip_suffix(&format!(".{root}")).ok_or(InvalidHost)?;
    normalize_slug(prefix).map(Some).ok_or(InvalidHost)
}

#[derive(Debug, PartialEq, Eq)]
pub struct InvalidHost;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workspace_names() {
        assert_eq!(normalize_slug("Acme-42"), Some("acme-42".into()));
        for invalid in [
            "ab", "-abc", "abc-", "équipe", "a.b", "api", "WWW", "admin", "mail", "support",
            " space",
        ] {
            assert_eq!(normalize_slug(invalid), None, "{invalid}");
        }
        assert!(normalize_slug(&"a".repeat(63)).is_some());
        assert!(normalize_slug(&"a".repeat(64)).is_none());
    }
    #[test]
    fn host_boundaries() {
        assert_eq!(tenant_from_host("ici.localhost", "ici.localhost"), Ok(None));
        assert_eq!(
            tenant_from_host("Acme.ici.localhost", "ici.localhost"),
            Ok(Some("acme".into()))
        );
        for host in [
            "ici.localhost.evil.com",
            "evilici.localhost",
            "a.acme.ici.localhost",
            "ici.localhost.",
            "api.ici.localhost",
        ] {
            assert_eq!(tenant_from_host(host, "ici.localhost"), Err(InvalidHost));
        }
    }
}
