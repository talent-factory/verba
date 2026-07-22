//! Surface detection for agent-aware template selection. Tier 1 (herdr) is pure
//! JSON parsing over `herdr api snapshot`; tiers 2/3 (AX title, NSWorkspace) live
//! in sibling functions. Every tier degrades to a safe default — detection never
//! aborts the dictation flow.

use std::time::Duration;

pub(crate) struct HerdrAgent {
    pub agent: String,
    pub status: String,
}

/// Parses `herdr api snapshot` output; returns the agent whose pane is focused.
pub(crate) fn focused_herdr_agent_from_json(snapshot: &str) -> Option<HerdrAgent> {
    let v: serde_json::Value = serde_json::from_str(snapshot).ok()?;
    let agents = v.get("result")?.get("snapshot")?.get("agents")?.as_array()?;
    for a in agents {
        if a.get("focused").and_then(|f| f.as_bool()).unwrap_or(false) {
            let agent = a.get("agent")?.as_str()?.to_string();
            let status = a
                .get("agent_status")
                .and_then(|s| s.as_str())
                .unwrap_or("unknown")
                .to_string();
            return Some(HerdrAgent { agent, status });
        }
    }
    None
}

/// Shells out to `herdr api snapshot` and returns the focused agent, or `None`
/// when herdr is not running / the call fails / times out. Not unit-tested — it
/// touches the environment; the parsing it relies on is tested below.
pub(crate) fn query_herdr() -> Option<HerdrAgent> {
    // `std::process::Command` has no built-in timeout; herdr answers a local
    // socket in milliseconds, but guard against a hung server by waiting on a
    // short-lived thread.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let out = std::process::Command::new("herdr")
            .args(["api", "snapshot"])
            .output();
        let _ = tx.send(out);
    });
    let out = rx.recv_timeout(Duration::from_millis(500)).ok()?.ok()?;
    if !out.status.success() {
        return None;
    }
    focused_herdr_agent_from_json(&String::from_utf8_lossy(&out.stdout))
}

// ---- Tier 3: frontmost application (NSWorkspace) ----

pub(crate) struct FrontApp {
    pub bundle_id: String,
    pub pid: i32,
}

/// The frontmost application's bundle identifier + pid via NSWorkspace, or
/// `None` if there is no frontmost app / it has no bundle id.
pub(crate) fn frontmost_app() -> Option<FrontApp> {
    use objc2_app_kit::NSWorkspace;
    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication()?;
    let bundle_id = app.bundleIdentifier()?.to_string();
    let pid = app.processIdentifier();
    Some(FrontApp { bundle_id, pid })
}

// ---- Tier 2: focused-window title (Accessibility) ----

/// The title of the focused window of the app with `pid`, via the Accessibility
/// API. `None` on any AX failure (incl. the known `-25204` even when trusted,
/// apps that don't expose titles, or a sheet-only focus).
pub(crate) fn focused_window_title(pid: i32) -> Option<String> {
    use accessibility::{AXAttribute, AXUIElement};
    use core_foundation::base::CFType;
    use core_foundation::string::CFString;
    let app = AXUIElement::application(pid);
    // The crate has no typed `focused_window` accessor; build the attribute by name.
    let focused = AXAttribute::<CFType>::new(&CFString::from_static_string("AXFocusedWindow"));
    let window = app.attribute(&focused).ok()?.downcast::<AXUIElement>()?;
    let title = window.attribute(&AXAttribute::title()).ok()?;
    Some(title.to_string())
}

// ---- Orchestration ----

#[derive(serde::Serialize)]
pub struct Surface {
    pub class: String,
    pub agent: Option<String>,
    pub status: Option<String>,
}

fn generic() -> Surface {
    Surface { class: "generic".into(), agent: None, status: None }
}

/// Pure decision logic — see the "Surface-class decision" contract.
pub(crate) fn classify(
    front: Option<FrontApp>,
    herdr: Option<HerdrAgent>,
    title: Option<String>,
    markers: &[String],
    terminals: &[String],
    editors: &[String],
) -> Surface {
    let front = match front {
        Some(f) => f,
        None => return generic(),
    };
    if editors.iter().any(|e| e == &front.bundle_id) {
        return Surface { class: "editor".into(), agent: None, status: None };
    }
    if terminals.iter().any(|t| t == &front.bundle_id) {
        if let Some(h) = herdr {
            return Surface { class: "agent".into(), agent: Some(h.agent), status: Some(h.status) };
        }
        if let Some(t) = title {
            let lc = t.to_lowercase();
            if let Some(m) = markers.iter().find(|m| lc.contains(&m.to_lowercase())) {
                return Surface { class: "agent".into(), agent: Some(m.clone()), status: None };
            }
        }
        return generic();
    }
    generic()
}

/// The Tauri command: runs the three tiers off the main thread and classifies.
#[tauri::command]
pub async fn detect_surface(
    agent_markers: Vec<String>,
    terminal_apps: Vec<String>,
    editor_apps: Vec<String>,
) -> Surface {
    tauri::async_runtime::spawn_blocking(move || {
        let front = frontmost_app();
        let herdr = query_herdr();
        let title = front.as_ref().and_then(|f| focused_window_title(f.pid));
        classify(front, herdr, title, &agent_markers, &terminal_apps, &editor_apps)
    })
    .await
    .unwrap_or_else(|_| generic())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn front(bundle: &str) -> Option<FrontApp> {
        Some(FrontApp { bundle_id: bundle.into(), pid: 1 })
    }

    #[test]
    fn editor_app_is_editor() {
        let s = classify(front("com.microsoft.VSCode"), None, None,
            &["claude".into()], &["com.apple.Terminal".into()], &["com.microsoft.VSCode".into()]);
        assert_eq!(s.class, "editor");
    }

    #[test]
    fn terminal_with_herdr_agent_is_agent() {
        let herdr = Some(HerdrAgent { agent: "claude".into(), status: "working".into() });
        let s = classify(front("com.apple.Terminal"), herdr, None,
            &["claude".into()], &["com.apple.Terminal".into()], &[]);
        assert_eq!(s.class, "agent");
        assert_eq!(s.agent.as_deref(), Some("claude"));
        assert_eq!(s.status.as_deref(), Some("working"));
    }

    #[test]
    fn terminal_with_marker_in_title_is_agent() {
        let s = classify(front("com.apple.Terminal"), None, Some("~ — codex — 80x24".into()),
            &["codex".into()], &["com.apple.Terminal".into()], &[]);
        assert_eq!(s.class, "agent");
        assert_eq!(s.agent.as_deref(), Some("codex"));
    }

    #[test]
    fn plain_terminal_is_generic() {
        let s = classify(front("com.apple.Terminal"), None, Some("~ — zsh".into()),
            &["claude".into()], &["com.apple.Terminal".into()], &[]);
        assert_eq!(s.class, "generic");
    }

    #[test]
    fn unknown_app_is_generic() {
        let s = classify(front("com.tinyspeck.slackmacgap"), None, None,
            &["claude".into()], &["com.apple.Terminal".into()], &["com.microsoft.VSCode".into()]);
        assert_eq!(s.class, "generic");
    }

    #[test]
    fn no_frontmost_app_is_generic() {
        let s = classify(None, None, None, &[], &[], &[]);
        assert_eq!(s.class, "generic");
    }

    const SNAPSHOT: &str = r#"{"id":"cli:api:snapshot","result":{"snapshot":{"agents":[
        {"agent":"claude","agent_status":"idle","focused":false,"pane_id":"wP:p1"},
        {"agent":"codex","agent_status":"working","focused":true,"pane_id":"wP:p2"}
    ]}}}"#;

    #[test]
    fn returns_the_focused_agent() {
        let a = focused_herdr_agent_from_json(SNAPSHOT).expect("a focused agent");
        assert_eq!(a.agent, "codex");
        assert_eq!(a.status, "working");
    }

    #[test]
    fn returns_none_when_no_pane_is_focused() {
        let json = r#"{"result":{"snapshot":{"agents":[{"agent":"claude","agent_status":"idle","focused":false}]}}}"#;
        assert!(focused_herdr_agent_from_json(json).is_none());
    }

    #[test]
    fn returns_none_on_garbage() {
        assert!(focused_herdr_agent_from_json("not json").is_none());
    }
}
