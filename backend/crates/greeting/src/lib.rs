//! Greeting capability. No transport, runtime, or persistence dependencies.

/// Return the application's welcome message.
#[must_use]
pub fn hello() -> &'static str {
    "Hello World"
}

#[cfg(test)]
mod tests {
    #[test]
    fn welcomes_the_world() {
        assert_eq!(super::hello(), "Hello World");
    }
}
