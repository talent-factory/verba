//! Reads environment variables for the frontend, so API keys can be sourced
//! from the shell environment before falling back to the Keychain.
//!
//! NOTE: a process only inherits shell env vars when launched from a shell
//! (e.g. `just macos-dev`). A Finder-launched `.app` bundle does not — there,
//! the Keychain / prompt path applies.

/// Environment variable names this command is permitted to read.
///
/// This command is exposed over Tauri IPC to the WebView, so it must never
/// act as a general-purpose environment reader — that would let a
/// compromised/injected WebView exfiltrate the entire process environment
/// (AWS creds, tokens, etc.). Only the API-key names the frontend actually
/// needs are allowed.
///
/// These mirror the map in
/// `apps/macos/src/adapters/envAwareSecretStore.ts` (`ENV_NAMES`) and must
/// stay in sync with it.
const ALLOWED: [&str; 4] = [
    "VERBA_ANTHROPIC_API_KEY",
    "ANTHROPIC_API_KEY",
    "VERBA_DEEPGRAM_API_KEY",
    "DEEPGRAM_API_KEY",
];

/// Returns the value of the named environment variable, or `None` if `name`
/// is not on the [`ALLOWED`] list, or the variable is unset or blank
/// (whitespace-only). The returned value is trimmed.
#[tauri::command]
pub fn env_var(name: String) -> Option<String> {
    env_var_with(&name, |n| std::env::var(n).ok())
}

/// The allowlist + trim/blank logic, with the environment read injected. Split
/// out so tests can exercise the positive path (allowlisted name → trimmed
/// value) and the blank filter without mutating the process environment — a
/// concurrent `setenv`/`getenv` across test threads aborts on macOS.
fn env_var_with(name: &str, read: impl Fn(&str) -> Option<String>) -> Option<String> {
    if !ALLOWED.contains(&name) {
        return None;
    }
    read(name)
        .filter(|v| !v.trim().is_empty())
        .map(|v| v.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_none_for_an_unset_variable() {
        assert_eq!(env_var("VERBA_DEFINITELY_UNSET_ENV_VAR_XYZ".to_string()), None);
    }

    #[test]
    fn returns_none_for_a_set_but_non_allowlisted_variable() {
        // PATH is virtually always set in the test environment, but it is
        // not on the allowlist. This proves the allowlist check gates
        // access before `std::env::var` is ever called.
        assert_eq!(env_var("PATH".to_string()), None);
    }

    #[test]
    fn non_allowlisted_name_is_rejected_before_the_reader_runs() {
        // The reader panics if called — proving the allowlist gates access first.
        let result = env_var_with("SOME_SECRET", |_| panic!("reader must not run"));
        assert_eq!(result, None);
    }

    #[test]
    fn returns_the_trimmed_value_for_an_allowlisted_set_variable() {
        // The positive path: an allowlisted name resolves and is trimmed. Without
        // this, an `env_var` that always returned `None` would pass every other
        // test in this module.
        let result = env_var_with("VERBA_ANTHROPIC_API_KEY", |_| Some("  sk-ant-test  ".to_string()));
        assert_eq!(result, Some("sk-ant-test".to_string()));
    }

    #[test]
    fn returns_none_for_an_allowlisted_but_whitespace_only_value() {
        let result = env_var_with("VERBA_DEEPGRAM_API_KEY", |_| Some("   ".to_string()));
        assert_eq!(result, None);
    }

    #[test]
    fn returns_none_for_an_allowlisted_but_unset_variable() {
        let result = env_var_with("DEEPGRAM_API_KEY", |_| None);
        assert_eq!(result, None);
    }
}
