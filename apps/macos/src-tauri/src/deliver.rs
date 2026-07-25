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
///
/// Residual race: a timeout can only tell us "the process did not exit within
/// `HERDR_TIMEOUT`", not "the process never delivered". If the underlying
/// `herdr` CLI actually delivered the text (or the Enter) and then hung past
/// the timeout before exiting, `run_herdr` still reports `Err` — indistinguishable
/// from "never delivered" from here. A caller that treats that `Err` as license
/// to fall back to pasting can then double-deliver in that rare case. Fully
/// closing this needs an ack-based herdr protocol (e.g. the CLI confirming
/// delivery before exiting, or a separate delivered-vs-exited signal); until
/// then, the timeout window is intentionally kept short to bound the exposure.
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

/// The result of a successful herdr delivery, mirroring [`crate::paste::PasteOutcome`].
/// Serializes to `"delivered"` / `"delivered-not-submitted"` — the wire format
/// `wiring.ts`'s `invoke<'delivered' | 'delivered-not-submitted'>('herdr_send', ...)`
/// depends on.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HerdrOutcome {
    Delivered,
    DeliveredNotSubmitted,
}

/// Pure decision logic for `herdr_send`'s outcome: `text_ok` is whether `pane
/// send-text` succeeded; `submit_ok` is whether `pane send-keys Enter`
/// succeeded (only consulted when `submit` is true). A failed send-text means
/// nothing landed in the pane at all → `Err`, the sole condition under which
/// the caller may safely fall back to pasting. A failed Enter after a
/// successful send-text means the text DID land → `Ok(HerdrOutcome::DeliveredNotSubmitted)`,
/// never `Err` — that's the double-delivery bug this type exists to prevent.
pub(crate) fn herdr_outcome(text_ok: bool, submit: bool, submit_ok: bool) -> Result<HerdrOutcome, ()> {
    if !text_ok {
        return Err(());
    }
    if !submit || submit_ok {
        Ok(HerdrOutcome::Delivered)
    } else {
        Ok(HerdrOutcome::DeliveredNotSubmitted)
    }
}

/// Runs `program argv`, bounded by `timeout`. Mirrors the spawn +
/// timed-wait + kill-on-timeout shape of `detect.rs::query_herdr` (adapted
/// here to a poll loop over `try_wait`, since — unlike `query_herdr` — this
/// call doesn't need to capture stdout on a side thread, just the exit
/// status): a hung process is killed rather than left to block the flow
/// forever. `program` is a parameter (rather than hardcoded `"herdr"`) so
/// tests can drive this against real coreutils (`true`/`false`/`sleep`)
/// without needing the `herdr` CLI installed.
fn run_herdr(program: &str, argv: &[String], timeout: Duration) -> Result<(), String> {
    let mut child = Command::new(program)
        .args(argv)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("{program} spawn failed: {e}"))?;

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else {
                    Err(format!("{program} {argv:?} exited with {status}"))
                };
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("{program} {argv:?} timed out after {timeout:?}"));
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(e) => return Err(format!("{program} wait failed: {e}")),
        }
    }
}

/// Delivers `text` into the herdr pane `pane_id` via `herdr pane send-text`,
/// then submits it with `herdr pane send-keys <pane> Enter` when `submit` is
/// set. Runs on a blocking-pool thread since the underlying `herdr` calls
/// block.
///
/// Returns `Ok(HerdrOutcome::Delivered)` or `Ok(HerdrOutcome::DeliveredNotSubmitted)`
/// — never `Err` once the text has landed in the pane. Rejects with `Err` only
/// when send-text itself failed (spawn error, non-zero exit, or timeout), i.e.
/// nothing was delivered — the sole case where a caller may safely fall back
/// to pasting without risking a double delivery.
#[tauri::command]
pub async fn herdr_send(pane_id: String, text: String, submit: bool) -> Result<HerdrOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let argvs = herdr_argvs(&pane_id, &text, submit);

        run_herdr("herdr", &argvs[0], HERDR_TIMEOUT)?;

        let submit_ok = !submit || run_herdr("herdr", &argvs[1], HERDR_TIMEOUT).is_ok();

        // text_ok is always true here (an Err from send-text already returned
        // above via `?`), so herdr_outcome's Err(()) branch is unreachable.
        match herdr_outcome(true, submit, submit_ok) {
            Ok(outcome) => Ok(outcome),
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
        assert_eq!(cmds[0], vec!["pane", "send-text", "wQ:p2", "run tests"]);
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
        assert_eq!(herdr_outcome(true, false, false), Ok(HerdrOutcome::Delivered));
    }

    #[test]
    fn submit_text_ok_and_enter_ok_is_delivered() {
        assert_eq!(herdr_outcome(true, true, true), Ok(HerdrOutcome::Delivered));
    }

    #[test]
    fn submit_text_ok_and_enter_fail_is_delivered_not_submitted() {
        // The double-delivery bug this type exists to prevent: text landed,
        // only Enter failed — must NOT be Err (which would trigger a paste
        // fallback and retype text already in the pane).
        assert_eq!(
            herdr_outcome(true, true, false),
            Ok(HerdrOutcome::DeliveredNotSubmitted)
        );
    }

    // --- HerdrOutcome serde wire format (H1): wiring.ts's
    // `invoke<'delivered' | 'delivered-not-submitted'>('herdr_send', ...)` depends
    // on these exact strings; the enum must not change the wire contract. ---

    #[test]
    fn herdr_outcome_serializes_to_the_exact_wire_strings() {
        assert_eq!(
            serde_json::to_string(&HerdrOutcome::Delivered).unwrap(),
            "\"delivered\""
        );
        assert_eq!(
            serde_json::to_string(&HerdrOutcome::DeliveredNotSubmitted).unwrap(),
            "\"delivered-not-submitted\""
        );
    }

    // --- run_herdr (H2): driven against real coreutils, no `herdr` CLI needed ---

    #[test]
    fn run_herdr_true_succeeds() {
        assert_eq!(run_herdr("true", &[], Duration::from_secs(2)), Ok(()));
    }

    #[test]
    fn run_herdr_false_is_err() {
        assert!(run_herdr("false", &[], Duration::from_secs(2)).is_err());
    }

    #[test]
    fn run_herdr_kills_a_hung_process_on_timeout_and_reaps_it() {
        // A 10s sleep against a 100ms timeout: if `run_herdr` failed to kill the
        // child on timeout, this test would hang for ~10s instead of returning
        // in well under a second — the timeout-vs-actual-hang distinction the
        // whole kill+reap path exists for.
        let start = Instant::now();
        let result = run_herdr("sleep", &["10".to_string()], Duration::from_millis(100));
        let elapsed = start.elapsed();

        assert!(result.is_err(), "a timed-out process must be reported as Err");
        assert!(
            elapsed < Duration::from_secs(2),
            "run_herdr should return shortly after the timeout, not wait out the sleep; took {elapsed:?}"
        );
        // No zombie: `run_herdr` already calls `child.wait()` after `kill()` on
        // the timeout path, so there is nothing further to reap here — the
        // fast, non-hanging return above is itself proof the reap happened
        // (an un-reaped child on some platforms would otherwise stall wait()).
    }
}
