//! Account validation and session policy.
pub const TERMS_VERSION: &str = "2026-10-draft";
pub const RESET_SECONDS: i64 = 30 * 60;
pub const HANDOFF_SECONDS: i64 = 60;

pub fn valid_password(value: &str) -> bool {
    (15..=128).contains(&value.chars().count())
}
pub fn normalize_email(value: &str) -> Option<String> {
    let value = value.trim().to_lowercase();
    let (local, domain) = value.split_once('@')?;
    if value.len() > 254
        || local.is_empty()
        || !domain.contains('.')
        || domain.starts_with('.')
        || domain.ends_with('.')
        || value.chars().any(char::is_whitespace)
        || domain.contains('@')
    {
        return None;
    }
    Some(value)
}
pub fn valid_name(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= 100 && !value.chars().any(char::is_control)
}
pub fn session_seconds(remember: bool) -> i64 {
    if remember {
        30 * 24 * 60 * 60
    } else {
        12 * 60 * 60
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn password_length_counts_characters() {
        for length in [15, 128] {
            assert!(valid_password(&"é".repeat(length)));
        }
        for length in [0, 14, 129] {
            assert!(!valid_password(&"a".repeat(length)));
        }
        assert!(valid_password("a long pass phrase"));
    }
    #[test]
    fn account_fields() {
        assert_eq!(
            normalize_email(" USER@Example.com "),
            Some("user@example.com".into())
        );
        for value in [
            "",
            "a",
            "@example.com",
            "a@b",
            "a@b@c.d",
            "a b@c.d",
            "a@.b",
            "a@b.",
        ] {
            assert_eq!(normalize_email(value), None);
        }
        let maximum = format!(
            "{}@{}.{}.{}",
            "a".repeat(64),
            "b".repeat(63),
            "c".repeat(63),
            "d".repeat(61)
        );
        assert_eq!(maximum.len(), 254);
        assert_eq!(normalize_email(&maximum), Some(maximum.clone()));
        assert_eq!(normalize_email(&format!("x{maximum}")), None);
        assert!(valid_name(&"a".repeat(100)));
        assert!(valid_name("Émilie"));
        for value in ["", " ", "a\nb"] {
            assert!(!valid_name(value));
        }
        assert!(!valid_name(&"a".repeat(101)));
        assert_eq!(session_seconds(false), 43200);
        assert_eq!(session_seconds(true), 2592000);
    }
}
