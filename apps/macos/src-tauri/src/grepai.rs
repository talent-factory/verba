//! Native grepai scope resolution: shells out to the `grepai` CLI in a target
//! repo, mirroring the VS Code `GrepaiProvider` (spawn `grepai search <query>
//! --limit N` with cwd=<repo>, parse `file:line: content`). Follows the spawn +
//! timed-wait + kill-on-timeout shape of `deliver.rs::run_herdr`, but captures
//! stdout on a side thread (like `detect.rs::query_herdr`) since we need the
//! output. Every failure degrades to an empty result — scope resolution never
//! aborts the dictation flow (TF-531 AC6).

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Duration;

/// Upper bound on a single grepai search. A hung `grepai` must not freeze cleanup.
const GREPAI_TIMEOUT: Duration = Duration::from_secs(30);

/// Parses grepai's `file:line: content` output into `// file: <path>\n<lines>`
/// snippets, grouped by file in first-seen order. Mirrors VS Code's
/// `parseGrepaiOutput` + `ContextProvider` formatting so both hosts feed
/// `CleanupService` the same `<context>` shape.
pub(crate) fn parse_grepai_output(output: &str) -> Vec<String> {
    let mut order: Vec<String> = Vec::new();
    let mut by_file: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for line in output.lines() {
        if line.trim().is_empty() {
            continue;
        }
        // `file:line: content` — split on the first two colons.
        let Some((file, rest)) = line.split_once(':') else {
            continue;
        };
        let Some((num, content)) = rest.split_once(':') else {
            continue;
        };
        if num.trim().parse::<u64>().is_err() {
            continue; // not a line-numbered grep line
        }
        let file = file.to_string();
        if !by_file.contains_key(&file) {
            order.push(file.clone());
        }
        by_file.entry(file).or_default().push(content.trim().to_string());
    }
    order
        .into_iter()
        .map(|file| format!("// file: {file}\n{}", by_file.remove(&file).unwrap().join("\n")))
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
        "--".into(),
        query.to_string(),
    ]
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
    fn groups_lines_by_file_in_first_seen_order() {
        let out = "src/session/SessionManager.ts:12: class SessionManager {\n\
                   src/session/SessionManager.ts:40:   flushCache() {\n\
                   src/session/SessionCache.ts:5: export class SessionCache {";
        let snippets = parse_grepai_output(out);
        assert_eq!(snippets.len(), 2);
        assert_eq!(
            snippets[0],
            "// file: src/session/SessionManager.ts\nclass SessionManager {\nflushCache() {"
        );
        assert_eq!(
            snippets[1],
            "// file: src/session/SessionCache.ts\nexport class SessionCache {"
        );
    }

    #[test]
    fn ignores_non_matching_lines_and_blanks() {
        let out = "\nnot a grep line\nsrc/a.ts:1: ok\n";
        let snippets = parse_grepai_output(out);
        assert_eq!(snippets, vec!["// file: src/a.ts\nok".to_string()]);
    }

    #[test]
    fn empty_output_is_no_snippets() {
        assert!(parse_grepai_output("").is_empty());
    }

    #[test]
    fn argv_puts_flags_first_then_double_dash_then_query() {
        assert_eq!(
            grepai_argv("fix the cache", 5),
            vec!["search", "--limit", "5", "--", "fix the cache"]
        );
    }

    #[test]
    fn argv_double_dash_prevents_flag_smuggling() {
        // A transcript starting with '-' must land as a positional after `--`,
        // never be parsed as a grepai flag.
        let argv = grepai_argv("--output=/etc/passwd", 3);
        assert_eq!(argv, vec!["search", "--limit", "3", "--", "--output=/etc/passwd"]);
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
}
