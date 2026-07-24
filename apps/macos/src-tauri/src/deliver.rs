//! Agent-native Zustellung in eine herdr-Pane. Reihenfolge der herdr-Aufrufe
//! wird als reine argv-Liste gebaut (testbar), dann ausgeführt.
//!
//! `herdr_send` reports which step succeeded (see `herdr_outcome`) rather than
//! collapsing any failure into a single `Err`: a caller (the TS `deliver()`
//! router) that treats every rejection as "nothing landed" and falls back to
//! pasting would double-deliver the text whenever send-text had already
//! succeeded and only the trailing Enter failed. See the "Shared contract
//! decision" in the PR #47 fix plan.

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Upper bound on a single herdr subprocess call (send-text or send-keys). A
/// hung `herdr` binary must not freeze the delivery flow indefinitely.
const HERDR_TIMEOUT: Duration = Duration::from_millis(3000);

/// Baut die herdr-Subcommand-Argumente für eine Zustellung.
/// Insert → nur `pane send-text`. Submit → zusätzlich `pane send-keys <pane> Enter`.
pub(crate) fn herdr_argvs(pane_id: &str, text: &str, submit: bool) -> Vec<Vec<String>> {
    let mut cmds = vec![vec![
        "pane".into(),
        "send-text".into(),
        pane_id.to_string(),
        text.to_string(),
    ]];
    if submit {
        cmds.push(vec![
            "pane".into(),
            "send-keys".into(),
            pane_id.to_string(),
            "Enter".into(),
        ]);
    }
    cmds
}

/// Pure decision logic for `herdr_send`'s outcome: `text_ok` is whether `pane
/// send-text` succeeded; `submit_ok` is whether `pane send-keys Enter`
/// succeeded (only consulted when `submit` is true). A failed send-text means
/// nothing landed in the pane at all → `Err`, the sole condition under which
/// the caller may safely fall back to pasting. A failed Enter after a
/// successful send-text means the text DID land → `Ok("delivered-not-submitted")`,
/// never `Err` — that's the double-delivery bug this type exists to prevent.
pub(crate) fn herdr_outcome(text_ok: bool, submit: bool, submit_ok: bool) -> Result<&'static str, ()> {
    if !text_ok {
        return Err(());
    }
    if !submit || submit_ok {
        Ok("delivered")
    } else {
        Ok("delivered-not-submitted")
    }
}

/// Runs a single herdr subcommand, bounded by `timeout`. Mirrors the
/// spawn + timed-wait + kill-on-timeout shape of `detect.rs::query_herdr`
/// (adapted here to a poll loop over `try_wait`, since — unlike
/// `query_herdr` — this call doesn't need to capture stdout on a side
/// thread, just the exit status): a hung `herdr` process is killed rather
/// than left to block the flow forever.
fn run_herdr(argv: &[String], timeout: Duration) -> Result<(), String> {
    let mut child = Command::new("herdr")
        .args(argv)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("herdr spawn failed: {e}"))?;

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else {
                    Err(format!("herdr {argv:?} exited with {status}"))
                };
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("herdr {argv:?} timed out after {timeout:?}"));
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(e) => return Err(format!("herdr wait failed: {e}")),
        }
    }
}

/// Delivers `text` into the herdr pane `pane_id` via `herdr pane send-text`,
/// then submits it with `herdr pane send-keys <pane> Enter` when `submit` is
/// set. Runs on a blocking-pool thread since the underlying `herdr` calls
/// block.
///
/// Returns `Ok("delivered")` or `Ok("delivered-not-submitted")` — never `Err`
/// once the text has landed in the pane. Rejects with `Err` only when
/// send-text itself failed (spawn error, non-zero exit, or timeout), i.e.
/// nothing was delivered — the sole case where a caller may safely fall back
/// to pasting without risking a double delivery.
#[tauri::command]
pub async fn herdr_send(pane_id: String, text: String, submit: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let argvs = herdr_argvs(&pane_id, &text, submit);

        run_herdr(&argvs[0], HERDR_TIMEOUT)?;

        let submit_ok = !submit || run_herdr(&argvs[1], HERDR_TIMEOUT).is_ok();

        // text_ok is always true here (an Err from send-text already returned
        // above via `?`), so herdr_outcome's Err(()) branch is unreachable.
        match herdr_outcome(true, submit, submit_ok) {
            Ok(outcome) => Ok(outcome.to_string()),
            Err(()) => unreachable!("send-text already verified ok above"),
        }
    })
    .await
    .map_err(|e| format!("herdr_send join failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_builds_only_send_text() {
        let cmds = herdr_argvs("wQ:p2", "hello", false);
        assert_eq!(cmds, vec![vec!["pane", "send-text", "wQ:p2", "hello"]]);
    }

    #[test]
    fn submit_appends_send_keys_enter() {
        let cmds = herdr_argvs("wQ:p2", "run tests", true);
        assert_eq!(cmds.len(), 2);
        assert_eq!(cmds[1], vec!["pane", "send-keys", "wQ:p2", "Enter"]);
    }

    // --- herdr_outcome: pure decision logic (see the "Shared contract decision") ---

    #[test]
    fn text_fail_is_err_regardless_of_submit() {
        assert_eq!(herdr_outcome(false, false, false), Err(()));
        assert_eq!(herdr_outcome(false, true, true), Err(()));
        assert_eq!(herdr_outcome(false, true, false), Err(()));
    }

    #[test]
    fn insert_text_ok_is_delivered() {
        assert_eq!(herdr_outcome(true, false, false), Ok("delivered"));
    }

    #[test]
    fn submit_text_ok_and_enter_ok_is_delivered() {
        assert_eq!(herdr_outcome(true, true, true), Ok("delivered"));
    }

    #[test]
    fn submit_text_ok_and_enter_fail_is_delivered_not_submitted() {
        // The double-delivery bug this type exists to prevent: text landed,
        // only Enter failed — must NOT be Err (which would trigger a paste
        // fallback and retype text already in the pane).
        assert_eq!(herdr_outcome(true, true, false), Ok("delivered-not-submitted"));
    }
}
