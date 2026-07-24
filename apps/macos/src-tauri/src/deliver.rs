//! Agent-native Zustellung in eine herdr-Pane. Reihenfolge der herdr-Aufrufe
//! wird als reine argv-Liste gebaut (testbar), dann ausgeführt.

use std::process::Command;

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

/// Delivers `text` into the herdr pane `pane_id` via `herdr pane send-text`,
/// then submits it with `herdr pane send-keys <pane> Enter` when `submit` is
/// set. Runs on a blocking-pool thread since `Command::status` blocks.
#[tauri::command]
pub async fn herdr_send(pane_id: String, text: String, submit: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        for argv in herdr_argvs(&pane_id, &text, submit) {
            let status = Command::new("herdr")
                .args(&argv)
                .status()
                .map_err(|e| format!("herdr spawn failed: {e}"))?;
            if !status.success() {
                return Err(format!("herdr {argv:?} exited with {status}"));
            }
        }
        Ok::<(), String>(())
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
}
