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
    // socket in milliseconds. Spawn with a piped stdout, read it on a short-lived
    // thread, and bound the wait — so a hung herdr can be killed rather than left
    // to linger. Every distinguishable failure is logged, matching the eprintln!
    // convention of the sibling modules (transcribe.rs, store.rs); only "herdr not
    // installed" stays silent, since that is the common, benign case.
    let mut child = match std::process::Command::new("herdr")
        .args(["api", "snapshot"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            if err.kind() != std::io::ErrorKind::NotFound {
                eprintln!("[Verba] herdr invocation failed: {err}");
            }
            return None;
        }
    };

    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = String::new();
        let result = stdout.read_to_string(&mut buf).map(|_| buf);
        let _ = tx.send(result);
    });

    match rx.recv_timeout(Duration::from_millis(500)) {
        Ok(Ok(stdout)) => {
            // A non-zero exit is an actionable "herdr present but broken" signal
            // (distinct from "not installed"), so surface it.
            if let Ok(status) = child.wait() {
                if !status.success() {
                    eprintln!("[Verba] herdr api snapshot exited with {status}; treating as no agent");
                }
            }
            let parsed = focused_herdr_agent_from_json(&stdout);
            // JSON that parsed but yielded no focused agent when it *looks* like a
            // herdr envelope is a possible schema drift — surface it rather than
            // silently reporting "no agent".
            if parsed.is_none() && stdout.trim_start().starts_with('{') {
                eprintln!("[Verba] herdr snapshot parsed but no focused agent was found (possible schema drift)");
            }
            parsed
        }
        Ok(Err(err)) => {
            let _ = child.wait();
            eprintln!("[Verba] reading herdr snapshot failed: {err}");
            None
        }
        Err(_) => {
            eprintln!("[Verba] herdr api snapshot timed out after 500ms; killing it and treating as no agent");
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
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

/// The detected surface, serialized to the frontend as `{ "class": "...", ... }`.
/// A tagged enum makes illegal states unrepresentable (no `agent` payload on a
/// non-agent surface, no `agent` variant without an agent name) and gives
/// `classify` compiler-checked exhaustiveness. The `#[serde(tag = "class")]`
/// shape is wire-compatible with the `DetectedSurface` type the TS host reads.
#[derive(serde::Serialize, Debug, PartialEq, Eq)]
#[serde(tag = "class", rename_all = "lowercase")]
pub enum Surface {
    Generic,
    Editor,
    Agent {
        agent: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<String>,
    },
}

fn generic() -> Surface {
    Surface::Generic
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
        return Surface::Editor;
    }
    if terminals.iter().any(|t| t == &front.bundle_id) {
        if let Some(h) = herdr {
            return Surface::Agent { agent: h.agent, status: Some(h.status) };
        }
        if let Some(t) = title {
            let lc = t.to_lowercase();
            if let Some(m) = markers.iter().find(|m| lc.contains(&m.to_lowercase())) {
                return Surface::Agent { agent: m.clone(), status: None };
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
        // The costly tiers (herdr shell-out, AX title lookup) only matter for a
        // focused terminal — the sole surface classify() can turn into "agent".
        // Skip them for editors and unknown apps, avoiding a per-dictation herdr
        // call and an unnecessary Accessibility touch. This reuses classify()'s
        // exact terminal predicate, so the shortcut can never change the outcome.
        let is_terminal = front
            .as_ref()
            .is_some_and(|f| terminal_apps.iter().any(|t| t == &f.bundle_id));
        let (herdr, title) = if is_terminal {
            (query_herdr(), front.as_ref().and_then(|f| focused_window_title(f.pid)))
        } else {
            (None, None)
        };
        classify(front, herdr, title, &agent_markers, &terminal_apps, &editor_apps)
    })
    .await
    .unwrap_or_else(|err| {
        // A JoinError here means a tier panicked (e.g. an AX/objc2 nil). Degrade to
        // generic — but log it, so a recurring panic isn't invisibly silent.
        eprintln!("[Verba] detect_surface task panicked: {err}");
        generic()
    })
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
        assert_eq!(s, Surface::Editor);
    }

    #[test]
    fn terminal_with_herdr_agent_is_agent() {
        let herdr = Some(HerdrAgent { agent: "claude".into(), status: "working".into() });
        let s = classify(front("com.apple.Terminal"), herdr, None,
            &["claude".into()], &["com.apple.Terminal".into()], &[]);
        assert_eq!(s, Surface::Agent { agent: "claude".into(), status: Some("working".into()) });
    }

    #[test]
    fn terminal_with_marker_in_title_is_agent() {
        let s = classify(front("com.apple.Terminal"), None, Some("~ — codex — 80x24".into()),
            &["codex".into()], &["com.apple.Terminal".into()], &[]);
        assert_eq!(s, Surface::Agent { agent: "codex".into(), status: None });
    }

    #[test]
    fn marker_matching_is_case_insensitive_on_both_sides() {
        // Mixed-case marker vs. upper-case title: exercises the double `to_lowercase`.
        let s = classify(front("com.apple.Terminal"), None, Some("session: CLAUDE".into()),
            &["Claude".into()], &["com.apple.Terminal".into()], &[]);
        assert_eq!(s, Surface::Agent { agent: "Claude".into(), status: None });
    }

    #[test]
    fn plain_terminal_is_generic() {
        let s = classify(front("com.apple.Terminal"), None, Some("~ — zsh".into()),
            &["claude".into()], &["com.apple.Terminal".into()], &[]);
        assert_eq!(s, Surface::Generic);
    }

    #[test]
    fn unknown_app_is_generic() {
        let s = classify(front("com.tinyspeck.slackmacgap"), None, None,
            &["claude".into()], &["com.apple.Terminal".into()], &["com.microsoft.VSCode".into()]);
        assert_eq!(s, Surface::Generic);
    }

    #[test]
    fn no_frontmost_app_is_generic() {
        let s = classify(None, None, None, &[], &[], &[]);
        assert_eq!(s, Surface::Generic);
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
