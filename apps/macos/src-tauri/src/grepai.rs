//! Native grepai scope resolution: shells out to the `grepai` CLI in a target
//! repo (`grepai search <query> --limit N --json` with cwd=<repo>) and parses its
//! JSON output. `--json` is grepai's machine-readable mode ("for AI agents"); the
//! human box format (`Found N results …`) is NOT parseable and was the reason
//! scope resolution silently returned nothing. Follows the spawn + timed-wait +
//! kill-on-timeout shape of `deliver.rs::run_herdr`, but captures stdout on a side
//! thread (like `detect.rs::query_herdr`) since we need the output. Every failure
//! degrades to an empty result — scope resolution never aborts the dictation flow
//! (TF-531 AC6).

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Duration;

/// Upper bound on a single grepai search. Deliberately well under the cleanup
/// timeout budget (controller.ts `DEFAULT_CLEANUP_TIMEOUT_MS` = 30s): this search
/// runs *inside* that budget, before the Anthropic call, so a slow/hung grepai
/// must not eat the whole budget and starve the actual cleanup (which would drop
/// the user to the raw transcript and misreport it as a Claude outage). A grepai
/// miss here just degrades to no `## Scope` (TF-531 AC6).
const GREPAI_TIMEOUT: Duration = Duration::from_secs(5);

/// Parses grepai's `--json` output — an array of
/// `{file_path, start_line, end_line, score, content}` — into
/// `// file: <path> (lines a-b)\n<code>` snippets, the `<context>` shape
/// `CleanupService` expects. grepai's `content` already starts with a redundant
/// `File: <path>\n\n` header (its own), which is stripped. Any parse failure
/// (human box output, non-array JSON, wrong shape) yields no snippets.
pub(crate) fn parse_grepai_output(output: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(output) else {
        return Vec::new();
    };
    let Some(results) = value.as_array() else {
        return Vec::new();
    };
    results
        .iter()
        .filter_map(|r| {
            let file = r.get("file_path")?.as_str()?;
            let content = r.get("content").and_then(|c| c.as_str()).unwrap_or("");
            let code = content
                .strip_prefix(&format!("File: {file}\n\n"))
                .unwrap_or(content);
            let loc = match (
                r.get("start_line").and_then(|n| n.as_u64()),
                r.get("end_line").and_then(|n| n.as_u64()),
            ) {
                (Some(s), Some(e)) => format!(" (lines {s}-{e})"),
                _ => String::new(),
            };
            Some(format!("// file: {file}{loc}\n{code}"))
        })
        .collect()
}

/// Builds the grepai argv. `--limit` stays before the query as a real flag, then
/// a `--` terminator ensures the query is always parsed as a positional — a
/// transcript that happens to start with `-` (e.g. "--output …") can't be
/// smuggled in as a grepai flag (argv flag injection). Pure/testable, mirroring
/// `deliver.rs::herdr_argvs`.
pub(crate) fn grepai_argv(query: &str, limit: u32) -> Vec<String> {
    vec![
        "search".into(),
        "--limit".into(),
        limit.to_string(),
        "--json".into(),
        "--".into(),
        query.to_string(),
    ]
}

/// True when `cwd` has a grepai index (`.grepai/`), mirroring the VS Code
/// `GrepaiProvider.isAvailable` guard. Without an index, `grepai search` is a
/// wasted spawn (or a slow failure) on every agent dictation — skip it.
pub(crate) fn repo_has_grepai_index(cwd: &str) -> bool {
    std::path::Path::new(cwd).join(".grepai").is_dir()
}

/// Runs `program search --limit <limit> -- <query>` in `cwd`, bounded by
/// `timeout`, and returns captured stdout. `program` is a parameter so tests can
/// drive it against coreutils (`true`/`false`) without the `grepai` CLI installed.
fn run_grepai(program: &str, query: &str, cwd: &str, limit: u32, timeout: Duration) -> Result<String, String> {
    let mut child = Command::new(program)
        .args(grepai_argv(query, limit))
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("{program} spawn failed: {e}"))?;

    let mut stdout = child.stdout.take().ok_or("no stdout pipe")?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        let _ = tx.send(buf);
    });

    match rx.recv_timeout(timeout) {
        Ok(out) => match child.wait() {
            Ok(status) if status.success() => Ok(out),
            Ok(status) => Err(format!("{program} search exited with {status}")),
            Err(e) => Err(format!("{program} wait failed: {e}")),
        },
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(format!("{program} search timed out after {timeout:?}"))
        }
    }
}

/// Resolves scope for `query` against the repo at `cwd` via the `grepai` CLI.
/// Returns formatted `// file: …` snippets, or `[]` on any failure (grepai not
/// installed, no `.grepai/` index, non-zero exit, timeout) — the caller degrades
/// to a prompt without `## Scope`. Runs on the blocking pool (grepai blocks).
#[tauri::command]
pub async fn grepai_search(query: String, cwd: String, limit: u32) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Skip the spawn entirely when the target repo has no grepai index —
        // parity with the VS Code provider, and avoids a per-dictation cost/stall
        // in un-indexed repos.
        if !repo_has_grepai_index(&cwd) {
            return Vec::new();
        }
        match run_grepai("grepai", &query, &cwd, limit, GREPAI_TIMEOUT) {
            Ok(out) => parse_grepai_output(&out),
            Err(e) => {
                eprintln!("[Verba] grepai scope resolution failed ({e}); no ## Scope");
                Vec::new()
            }
        }
    })
    .await
    .unwrap_or_else(|e| {
        eprintln!("[Verba] grepai_search task panicked: {e}");
        Vec::new()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn parses_json_results_into_file_snippets() {
        let out = r#"[
            {"file_path":"src/session/SessionCache.ts","start_line":5,"end_line":7,"score":0.6,"content":"File: src/session/SessionCache.ts\n\nexport class SessionCache {\n  flush() {}\n}"},
            {"file_path":"src/a.ts","start_line":1,"end_line":1,"score":0.5,"content":"const a = 1;"}
        ]"#;
        let snippets = parse_grepai_output(out);
        assert_eq!(snippets.len(), 2);
        // grepai's redundant "File: <path>\n\n" header is stripped; line range kept.
        assert_eq!(
            snippets[0],
            "// file: src/session/SessionCache.ts (lines 5-7)\nexport class SessionCache {\n  flush() {}\n}"
        );
        // content without a "File:" header is used verbatim.
        assert_eq!(snippets[1], "// file: src/a.ts (lines 1-1)\nconst a = 1;");
    }

    #[test]
    fn non_json_or_empty_output_is_no_snippets() {
        assert!(parse_grepai_output("").is_empty());
        // the human box format is not JSON → nothing (the bug this fix addresses).
        assert!(parse_grepai_output("Found 3 results for: \"x\"\n─── Result 1 ───").is_empty());
        assert!(parse_grepai_output("[]").is_empty());
        assert!(parse_grepai_output("{\"not\":\"an array\"}").is_empty());
    }

    #[test]
    fn argv_puts_flags_first_then_double_dash_then_query() {
        assert_eq!(
            grepai_argv("fix the cache", 5),
            vec!["search", "--limit", "5", "--json", "--", "fix the cache"]
        );
    }

    #[test]
    fn argv_double_dash_prevents_flag_smuggling() {
        // A transcript starting with '-' must land as a positional after `--`,
        // never be parsed as a grepai flag.
        let argv = grepai_argv("--output=/etc/passwd", 3);
        assert_eq!(argv, vec!["search", "--limit", "3", "--json", "--", "--output=/etc/passwd"]);
        let dd = argv.iter().position(|a| a == "--").expect("has a -- terminator");
        assert_eq!(argv[dd + 1], "--output=/etc/passwd", "query sits after the -- terminator");
    }

    // run_grepai driven against real coreutils, no grepai CLI needed:
    #[test]
    fn run_grepai_true_yields_empty_ok() {
        // `true` ignores args, exits 0, emits nothing -> Ok("").
        assert_eq!(run_grepai("true", "q", ".", 5, Duration::from_secs(2)), Ok(String::new()));
    }

    #[test]
    fn run_grepai_false_is_err() {
        assert!(run_grepai("false", "q", ".", 5, Duration::from_secs(2)).is_err());
    }

    #[test]
    fn run_grepai_missing_binary_is_err() {
        assert!(run_grepai("definitely-not-a-real-binary-xyz", "q", ".", 5, Duration::from_secs(2)).is_err());
    }

    #[test]
    fn missing_grepai_index_is_not_available() {
        assert!(!repo_has_grepai_index("/nonexistent/path/does-not-exist-xyz"));
    }

    #[test]
    fn present_grepai_index_is_available() {
        let dir = std::env::temp_dir().join(format!("verba_grepai_idx_{}", std::process::id()));
        let idx = dir.join(".grepai");
        std::fs::create_dir_all(&idx).expect("create temp .grepai");
        assert!(repo_has_grepai_index(dir.to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
