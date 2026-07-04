//! Reads environment variables for the frontend, so API keys can be sourced
//! from the shell environment before falling back to the Keychain.
//!
//! NOTE: a process only inherits shell env vars when launched from a shell
//! (e.g. `just macos-dev`). A Finder-launched `.app` bundle does not — there,
//! the Keychain / prompt path applies.

/// Returns the value of the named environment variable, or `None` if it is
/// unset or blank (whitespace-only).
#[tauri::command]
pub fn env_var(name: String) -> Option<String> {
    std::env::var(&name).ok().filter(|v| !v.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_none_for_an_unset_variable() {
        assert_eq!(env_var("VERBA_DEFINITELY_UNSET_ENV_VAR_XYZ".to_string()), None);
    }
}
