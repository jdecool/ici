//! Organization naming and location rules, independent of transport and persistence.
pub fn valid_name(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= 100 && !value.chars().any(char::is_control)
}
pub fn valid_code(value: &str) -> bool {
    (2..=3).contains(&value.len()) && value.bytes().all(|letter| letter.is_ascii_uppercase())
}
pub fn valid_detail(value: &str) -> bool {
    value.chars().count() <= 500 && !value.chars().any(char::is_control)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_names_codes_and_optional_details() {
        for name in ["Paris", " Équipe ", &"é".repeat(100)] {
            assert!(valid_name(name));
        }
        for name in ["", "  ", "a\n", &"a".repeat(101)] {
            assert!(!valid_name(name));
        }
        for code in ["PA", "BDX"] {
            assert!(valid_code(code));
        }
        for code in ["", "P", "PARI", "Pa", "12", "ÉT"] {
            assert!(!valid_code(code));
        }
        for detail in ["", "12 rue de Paris", &"é".repeat(500)] {
            assert!(valid_detail(detail));
        }
        for detail in ["a\n", &"a".repeat(501)] {
            assert!(!valid_detail(detail));
        }
    }
}
