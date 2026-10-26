//! Calendar and presence rules, independent of transport and persistence.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Date {
    year: u32,
    month: u32,
    day: u32,
}
fn leap(year: u32) -> bool {
    year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400))
}
fn month_days(year: u32, month: u32) -> u32 {
    match month {
        2 => {
            if leap(year) {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}
impl Date {
    pub fn parse(value: &str) -> Option<Self> {
        let bytes = value.as_bytes();
        if bytes.len() != 10
            || bytes[4] != b'-'
            || bytes[7] != b'-'
            || !bytes
                .iter()
                .enumerate()
                .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
        {
            return None;
        }
        let year = value.get(..4)?.parse().ok()?;
        let month = value.get(5..7)?.parse().ok()?;
        let day = value.get(8..)?.parse().ok()?;
        if year == 0 || !(1..=12).contains(&month) || day == 0 || day > month_days(year, month) {
            return None;
        }
        Some(Self { year, month, day })
    }
    pub fn weekday(self) -> u32 {
        let y = self.year - 1;
        (365 * y + y / 4 - y / 100
            + y / 400
            + (1..self.month)
                .map(|m| month_days(self.year, m))
                .sum::<u32>()
            + self.day
            - 1)
            % 7
    }
    pub fn plus(self, days: u32) -> Option<Self> {
        let mut result = self;
        for _ in 0..days {
            result.day += 1;
            if result.day > month_days(result.year, result.month) {
                result.day = 1;
                result.month += 1;
                if result.month > 12 {
                    result.month = 1;
                    result.year += 1;
                    if result.year > 9999 {
                        return None;
                    }
                }
            }
        }
        Some(result)
    }
    pub fn iso(self) -> String {
        format!("{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }
}
pub fn valid_days(days: &[i32]) -> bool {
    !days.is_empty()
        && days.len() <= 7
        && days.iter().all(|d| (0..=6).contains(d))
        && days.windows(2).all(|pair| pair[0] < pair[1])
}
pub fn valid_presence(status: &str, location: bool, note: &str) -> bool {
    matches!(status, "office" | "remote" | "travel" | "off" | "none")
        && (location == (status == "office"))
        && note.chars().count() <= 500
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn calendar_boundaries() -> Result<(), String> {
        for (value, days, expected) in [
            ("2024-02-28", 2, "2024-03-01"),
            ("2026-01-30", 1, "2026-01-31"),
            ("2026-11-30", 1, "2026-12-01"),
            ("9998-12-31", 1, "9999-01-01"),
            ("2025-12-29", 7, "2026-01-05"),
            ("1900-02-28", 1, "1900-03-01"),
            ("2000-02-28", 1, "2000-02-29"),
        ] {
            let date = Date::parse(value).ok_or(value)?;
            assert_eq!(date.plus(days).ok_or("overflow")?.iso(), expected);
        }
        assert_eq!(Date::parse("2026-10-26").ok_or("date")?.weekday(), 0);
        assert!(Date::parse("9999-12-31").ok_or("date")?.plus(1).is_none());
        for invalid in [
            "0000-01-01",
            "2025-02-29",
            "2026-13-01",
            "2026-01-00",
            "2026-1-01",
            "abcdefghij",
            "2026/01/01",
            "2026/01-01",
            "2026-01/01",
            "2026-01-010",
            "2026-01-01suffix",
            "2026-04-31",
        ] {
            assert!(Date::parse(invalid).is_none(), "{invalid}");
        }
        Ok(())
    }
    #[test]
    fn configuration_and_presence_contracts() {
        for days in [vec![], vec![1, 1], vec![6, 0], vec![-1], vec![7]] {
            assert!(!valid_days(&days));
        }
        assert!(valid_days(&[0, 1, 2, 3, 4, 5, 6]));
        assert!(valid_days(&[6]));
        for status in ["office", "remote", "travel", "off", "none"] {
            assert!(valid_presence(status, status == "office", &"é".repeat(500)));
            assert!(!valid_presence(status, status != "office", ""));
        }
        assert!(!valid_presence("unknown", false, ""));
        assert!(!valid_presence("remote", false, &"é".repeat(501)));
    }
}
