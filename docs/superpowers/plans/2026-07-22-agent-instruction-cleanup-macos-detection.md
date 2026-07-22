# Agent-Instruction Cleanup — macOS Native Surface Detection (Plan 2B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On macOS, detect the dictation target surface (agent terminal / editor / other) and auto-select the "Agent Instruction" template when an AI agent is the focused target — using a tiered, deterministic-first detector (`herdr api snapshot` → AX window-title markers → NSWorkspace bundle-id).

**Architecture:** A new Rust `detect.rs` exposes one `detect_surface` Tauri command. It combines three tiers, best→floor, and returns a small `{ class, agent, status }` result. Tier 1 shells out to `herdr api snapshot` (no FFI, deterministic, survives SSH). Tiers 3/2 use `objc2-app-kit` (frontmost app bundle-id + pid) and `axuielement` (focused-window title). The frontend passes the configurable marker/app lists as command args (Rust stays config-agnostic, matching `config.rs`'s dumb-reader design), and a wiring-level helper maps the returned surface class to the active template — the macOS `controller.ts` is left unchanged.

**Tech Stack:** Rust (Tauri v2, `objc2`/`objc2-app-kit`/`objc2-foundation`, `axuielement`, `serde_json`), TypeScript (strict), Mocha + Sinon, `cargo test`.

**Depends on:** Plan 1 (the "Agent Instruction" template + `outputLanguage`) and Plan 2A (the `outputLanguage` host wiring + `AGENT_INSTRUCTION_TEMPLATE_NAME`/`chooseAutoTemplate`). Execute 2A before 2B, or in one branch after both are reviewed.

## Global Constraints

- The bundled agent template's name is exactly `"Agent Instruction"`. On the TS side reference the Plan-2A constant; on the Rust side use a single `const AGENT_INSTRUCTION_TEMPLATE_NAME: &str = "Agent Instruction";`.
- New Rust deps (Cargo.toml, `apps/macos/src-tauri`): `objc2 = "0.6"`, `objc2-app-kit = { version = "0.3", features = ["NSWorkspace", "NSRunningApplication"] }`, `objc2-foundation = "0.3"`, `axuielement = "0.1"`. Verify exact current versions/method names against docs.rs during implementation — objc2/axuielement APIs shift across minor versions; treat the code below as the shape, and let `cargo build` be the source of truth.
- All blocking native/shell work runs off Tauri's main thread via `tauri::async_runtime::spawn_blocking` (the `paste.rs:68-73` pattern).
- Detection must **never throw into the dictation flow**: every tier degrades to a sane default. A total detection failure returns `class: "generic"` (prose default), never an error that aborts cleanup.
- Accessibility permission is already required for paste; `AXIsProcessTrusted()` may be true while an AX read still fails with `-25204` — treat any AX read failure as "no title" and fall through, do not surface an error.
- Config parsing stays in `@verba/core`/frontend; `config.rs` stays a dumb reader. The Rust detector receives marker/app lists as command arguments.
- Rust tests: `cargo test --manifest-path apps/macos/src-tauri/Cargo.toml`. macOS TS tests: `npm --workspace apps/macos run test:unit`. Core tests: `npm run test:core`. Remember (from Plan 1) the Rust suite is NOT part of the npm suites — run it explicitly.
- Commits go through `/git-workflow:commit` (German, emoji conventional, no auto-signatures). Never raw `git commit`.

## Surface-class decision (the contract every task shares)

`detect_surface` returns `{ class: "agent" | "editor" | "generic", agent: string | null, status: string | null }`:

1. Frontmost bundle-id ∈ `editorApps` → `editor` (agent=null).
2. Frontmost bundle-id ∈ `terminalApps`:
   a. `herdr api snapshot` reports a `focused: true` pane with an agent → `agent` (agent=name, status=agent_status).
   b. else focused-window AX title contains any `agentMarkers` token (case-insensitive) → `agent` (agent=matched marker, status=null).
   c. else → `generic` (a plain shell — conservative; the user can still pick the template manually).
3. Frontmost bundle-id in neither list → `generic`.

Rationale for 2c returning `generic` (not the spec's "terminal→agent floor"): the user explicitly chose process/title-level detection to avoid treating a plain shell as an agent surface. Manual template selection remains the override.

---

### Task 1: Detection config schema in `@verba/core`

**Files:**
- Modify: `packages/core/src/config.ts` (`VerbaConfig`, `ResolvedConfig`, `resolveConfig`)
- Test: `packages/core/src/test/unit/config.test.ts`

**Interfaces:**
- Produces on `ResolvedConfig`: `agentMarkers: string[]`, `terminalApps: string[]`, `editorApps: string[]`, each defaulting to a bundled list when the config omits or malforms them (reuse the existing `resolveStringArray` helper).

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/test/unit/config.test.ts`:

```typescript
suite('detection config', () => {
	test('resolveConfig supplies default agent markers and app lists', () => {
		const cfg = resolveConfig({ get: <T>(_k: string, d: T) => d });
		assert.ok(cfg.agentMarkers.includes('claude'), 'default markers include claude');
		assert.ok(cfg.agentMarkers.includes('herdr'), 'default markers include herdr');
		assert.ok(cfg.terminalApps.includes('com.googlecode.iterm2'), 'default terminals include iTerm2');
		assert.ok(cfg.editorApps.includes('com.microsoft.VSCode'), 'default editors include VS Code');
	});

	test('resolveConfig honors user-provided lists', () => {
		const provider = { get: <T>(k: string, d: T): T => (k === 'agentMarkers' ? (['xyz'] as unknown as T) : d) };
		const cfg = resolveConfig(provider);
		assert.deepStrictEqual(cfg.agentMarkers, ['xyz']);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:core`
Expected: FAIL — `cfg.agentMarkers` is `undefined` (property does not exist yet).

- [ ] **Step 3: Add the fields, defaults, and resolution**

In `packages/core/src/config.ts`:
- Add to the `VerbaConfig` interface: `agentMarkers?: string[]; terminalApps?: string[]; editorApps?: string[];`
- Add to the `ResolvedConfig` interface: `agentMarkers: string[]; terminalApps: string[]; editorApps: string[];`
- Add the default constants near the other module-level defaults:

```typescript
const DEFAULT_AGENT_MARKERS = ['claude', 'herdr', 'codex', 'aider', 'cursor'];
const DEFAULT_TERMINAL_APPS = [
	'com.apple.Terminal', 'com.googlecode.iterm2', 'com.mitchellh.ghostty',
	'com.github.wez.wezterm', 'net.kovidgoyal.kitty', 'org.alacritty', 'dev.warp.Warp-Stable',
];
const DEFAULT_EDITOR_APPS = ['com.microsoft.VSCode', 'com.todesktop.230313mzl4w4u92', 'dev.zed.Zed'];
```
- In `resolveConfig`, add three resolutions following the existing `resolveStringArray(provider.get('glossary', []))` pattern, each falling back to its default when the provided value is empty/invalid:

```typescript
	const agentMarkers = resolveStringArray(provider.get<unknown>('agentMarkers', DEFAULT_AGENT_MARKERS));
	const terminalApps = resolveStringArray(provider.get<unknown>('terminalApps', DEFAULT_TERMINAL_APPS));
	const editorApps = resolveStringArray(provider.get<unknown>('editorApps', DEFAULT_EDITOR_APPS));
```
Then include `agentMarkers: agentMarkers.length ? agentMarkers : DEFAULT_AGENT_MARKERS,` (and likewise for the other two) in the returned object, so an empty user array still yields usable defaults.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:core`
Expected: PASS. Then `npm run compile:core` (exits 0) so both hosts' `dist/` carries the new `ResolvedConfig` fields.

- [ ] **Step 5: Guard the other DEFAULT-count consumers**

The `ResolvedConfig` shape changed. Run the parity/count sentinels to confirm nothing broke:
Run: `npm run test:unit` (VS Code + core) and `npm --workspace apps/macos run test:unit`
Expected: PASS both. (These fields are additive; no count assertion covers them. This step exists because Plan 1 taught that `ResolvedConfig`/`DEFAULT_TEMPLATES` changes have multiple host consumers.)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config.ts packages/core/src/test/unit/config.test.ts
```
Commit via `/git-workflow:commit`. Suggested: `✨ feat(core): Detection-Config (agentMarkers, terminalApps, editorApps) mit Defaults`

---

### Task 2: Rust tier 1 — herdr snapshot parsing

**Files:**
- Create: `apps/macos/src-tauri/src/detect.rs`
- Modify: `apps/macos/src-tauri/src/lib.rs:1-11` (add `mod detect;`)

**Interfaces:**
- Produces: `pub(crate) struct HerdrAgent { pub agent: String, pub status: String }` and `pub(crate) fn focused_herdr_agent_from_json(snapshot: &str) -> Option<HerdrAgent>` — parses a `herdr api snapshot` JSON string, returns the agent of the `focused: true` entry, or `None`. A separate `pub(crate) fn query_herdr() -> Option<HerdrAgent>` shells out with a timeout (untested — it touches the environment) and delegates parsing to the pure function.

- [ ] **Step 1: Write the failing pure-parse test**

Create `apps/macos/src-tauri/src/detect.rs` with only the test (so it compiles to a failing/red state referencing an undefined fn):

```rust
//! Surface detection for agent-aware template selection. Tier 1 (herdr) is pure
//! JSON parsing over `herdr api snapshot`; tiers 2/3 (AX title, NSWorkspace) live
//! in sibling functions. Every tier degrades to a safe default — detection never
//! aborts the dictation flow.

#[cfg(test)]
mod tests {
    use super::*;

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
```
Add `mod detect;` to `apps/macos/src-tauri/src/lib.rs` alongside the other `mod` lines (~line 1-11).

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --manifest-path apps/macos/src-tauri/Cargo.toml detect`
Expected: FAIL to compile — `focused_herdr_agent_from_json` is undefined.

- [ ] **Step 3: Implement the pure parser + the (untested) shell-out**

Prepend to `detect.rs` (above the test module):

```rust
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
            let status = a.get("agent_status").and_then(|s| s.as_str()).unwrap_or("unknown").to_string();
            return Some(HerdrAgent { agent, status });
        }
    }
    None
}

/// Shells out to `herdr api snapshot` and returns the focused agent, or `None`
/// when herdr is not running / the call fails / times out. Not unit-tested — it
/// touches the environment; the parsing it relies on is tested above.
pub(crate) fn query_herdr() -> Option<HerdrAgent> {
    // `std::process::Command` has no built-in timeout; herdr answers a local
    // socket in milliseconds, but guard against a hung server by spawning and
    // waiting on a short-lived thread.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let out = std::process::Command::new("herdr").args(["api", "snapshot"]).output();
        let _ = tx.send(out);
    });
    let out = rx.recv_timeout(Duration::from_millis(500)).ok()?.ok()?;
    if !out.status.success() {
        return None;
    }
    focused_herdr_agent_from_json(&String::from_utf8_lossy(out.stdout.as_slice()))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --manifest-path apps/macos/src-tauri/Cargo.toml detect`
Expected: PASS (3 parse tests).

- [ ] **Step 5: Commit**

```bash
git add apps/macos/src-tauri/src/detect.rs apps/macos/src-tauri/src/lib.rs
```
Commit via `/git-workflow:commit`. Suggested: `✨ feat(macos): herdr-Snapshot-Parsing (Tier 1 der Oberflächen-Erkennung)`

---

### Task 3: Rust tiers 3 + 2 — NSWorkspace frontmost app and AX window title

**Files:**
- Modify: `apps/macos/src-tauri/Cargo.toml` (add deps)
- Modify: `apps/macos/src-tauri/src/detect.rs` (add `frontmost_app()` and `focused_window_title(pid)`)

**Interfaces:**
- Produces: `pub(crate) struct FrontApp { pub bundle_id: String, pub pid: i32 }`, `pub(crate) fn frontmost_app() -> Option<FrontApp>` (NSWorkspace), and `pub(crate) fn focused_window_title(pid: i32) -> Option<String>` (AX). Both return `None` on any failure — never panic.

- [ ] **Step 1: Add the dependencies**

In `apps/macos/src-tauri/Cargo.toml` under `[dependencies]`, append:

```toml
# Surface detection (frontmost app + AX window title) for agent-aware templates.
objc2 = "0.6"
objc2-app-kit = { version = "0.3", features = ["NSWorkspace", "NSRunningApplication"] }
objc2-foundation = "0.3"
axuielement = "0.1"
```

Run: `cargo build --manifest-path apps/macos/src-tauri/Cargo.toml`
Expected: exits 0 (deps resolve/compile). If a version is yanked/mismatched, pick the current one from docs.rs and re-run.

- [ ] **Step 2: Implement `frontmost_app()` (NSWorkspace, tier 3)**

Append to `detect.rs`. Verify method names against `docs.rs/objc2-app-kit` — the shape:

```rust
use objc2_app_kit::NSWorkspace;

pub(crate) struct FrontApp {
    pub bundle_id: String,
    pub pid: i32,
}

/// The frontmost application's bundle identifier + pid via NSWorkspace, or
/// `None` if there is no frontmost app / it has no bundle id.
pub(crate) fn frontmost_app() -> Option<FrontApp> {
    // SAFETY: standard AppKit main-actor calls; we only read immutable properties.
    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let app = workspace.frontmostApplication()?;
        let bundle_id = app.bundleIdentifier()?.to_string();
        let pid = app.processIdentifier();
        Some(FrontApp { bundle_id, pid })
    }
}
```

- [ ] **Step 3: Implement `focused_window_title(pid)` (AX, tier 2)**

Append to `detect.rs`. Verify against `docs.rs/axuielement` (method names differ across versions — adapt to the compiler):

```rust
use axuielement::AXUIElement;

/// The title of the focused window of the app with `pid`, via the Accessibility
/// API. `None` on any AX failure (incl. the known `-25204` even when trusted,
/// apps that don't expose titles, or a sheet-only focus).
pub(crate) fn focused_window_title(pid: i32) -> Option<String> {
    let app = AXUIElement::application(pid);
    let window = app.attribute(&"AXFocusedWindow".into()).ok()?.downcast_into::<AXUIElement>()?;
    let title = window.attribute(&"AXTitle".into()).ok()?;
    title.downcast_into::<axuielement::CFString>().map(|s| s.to_string())
}
```

- [ ] **Step 4: Build to verify the FFI compiles**

Run: `cargo build --manifest-path apps/macos/src-tauri/Cargo.toml`
Expected: exits 0. This is an FFI build-verify loop: if the exact `axuielement`/`objc2` method names differ from the sketch, fix them against the docs until it compiles. These two functions have no unit tests (they read live OS state); their correctness is exercised in Task 4's orchestration and by manual QA.

- [ ] **Step 5: Commit**

```bash
git add apps/macos/src-tauri/Cargo.toml apps/macos/src-tauri/Cargo.lock apps/macos/src-tauri/src/detect.rs
```
Commit via `/git-workflow:commit`. Suggested: `✨ feat(macos): NSWorkspace-Frontmost + AX-Fenstertitel (Tier 3+2)`

---

### Task 4: Rust orchestration — `detect_surface` command

**Files:**
- Modify: `apps/macos/src-tauri/src/detect.rs` (add the classifier + `#[tauri::command]`)
- Modify: `apps/macos/src-tauri/src/lib.rs:30-47` (register the command)

**Interfaces:**
- Produces: `#[derive(serde::Serialize)] pub struct Surface { pub class: String, pub agent: Option<String>, pub status: Option<String> }` and `#[tauri::command] pub async fn detect_surface(agent_markers: Vec<String>, terminal_apps: Vec<String>, editor_apps: Vec<String>) -> Surface`. A pure `classify(front, herdr, title, &markers, &terminals, &editors) -> Surface` holds the decision logic (unit-tested); the command wires the real tier calls into it via `spawn_blocking`.

- [ ] **Step 1: Write the failing classifier tests**

Add to `detect.rs`'s test module:

```rust
    fn front(bundle: &str) -> Option<FrontApp> { Some(FrontApp { bundle_id: bundle.into(), pid: 1 }) }

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --manifest-path apps/macos/src-tauri/Cargo.toml detect`
Expected: FAIL to compile — `classify` and `Surface` undefined.

- [ ] **Step 3: Implement the classifier + command**

Append to `detect.rs` (above the tests):

```rust
const AGENT_MARKER_SEP: char = ' '; // titles are matched by substring, not tokenization

#[derive(serde::Serialize)]
pub struct Surface {
    pub class: String,
    pub agent: Option<String>,
    pub status: Option<String>,
}

fn generic() -> Surface { Surface { class: "generic".into(), agent: None, status: None } }

/// Pure decision logic — see the "Surface-class decision" contract in the plan.
pub(crate) fn classify(
    front: Option<FrontApp>,
    herdr: Option<HerdrAgent>,
    title: Option<String>,
    markers: &[String],
    terminals: &[String],
    editors: &[String],
) -> Surface {
    let front = match front { Some(f) => f, None => return generic() };
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
```
(Remove the unused `AGENT_MARKER_SEP` const if the compiler flags it — it documents the substring-match choice; delete rather than keep dead.)

Register in `apps/macos/src-tauri/src/lib.rs` inside `tauri::generate_handler![...]` (append after `paste::paste_text,`):

```rust
        detect::detect_surface,
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --manifest-path apps/macos/src-tauri/Cargo.toml detect`
Expected: PASS (6 classifier tests + the 3 tier-1 tests). Then `cargo build --manifest-path apps/macos/src-tauri/Cargo.toml` exits 0 (command registered, no warnings).

- [ ] **Step 5: Commit**

```bash
git add apps/macos/src-tauri/src/detect.rs apps/macos/src-tauri/src/lib.rs
```
Commit via `/git-workflow:commit`. Suggested: `✨ feat(macos): detect_surface-Command — Tier-Orchestrierung + Klassifikation`

---

### Task 5: macOS host wiring — surface → template override

**Files:**
- Modify: `apps/macos/src/config/verbaConfig.ts` (`cleanupContextFor` gains a template override; new `templateForSurface` helper)
- Modify: `apps/macos/src/wiring.ts:86-87` (detect surface, pick template, pass override)
- Test: `apps/macos/src/test/unit/verbaConfig.test.ts`

**Interfaces:**
- Consumes: the `Surface` shape from `detect_surface` (`{ class, agent, status }`), `ResolvedConfig`, the Plan-2A `outputLanguage` wiring already in `cleanupContextFor`.
- Produces:
  - `export function templateForSurface(config: ResolvedConfig, surfaceClass: string): Template` — returns the `"Agent Instruction"` template (from `config.templates`) when `surfaceClass === 'agent'` and it exists, else `config.activeTemplate`.
  - `cleanupContextFor(config, context?, templateOverride?)` — uses `templateOverride ?? config.activeTemplate` for `templatePrompt`/`outputLanguage`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/macos/src/test/unit/verbaConfig.test.ts` (reuse the `baseConfig` helper from Plan 2A's suite, or redefine a local one):

```typescript
suite('templateForSurface + override', () => {
	const agent: Template = { name: 'Agent Instruction', prompt: 'AGENT' };
	const active: Template = { name: 'Freitext', prompt: 'FREE' };
	function cfg(): ResolvedConfig {
		return {
			language: 'auto', transcriptionLanguage: 'multi', provider: 'deepgram', localModel: 'base',
			glossary: [], expansions: [], templates: [active, agent], activeTemplate: active,
			agentMarkers: [], terminalApps: [], editorApps: [],
		};
	}

	test('agent surface selects the Agent Instruction template', () => {
		assert.strictEqual(templateForSurface(cfg(), 'agent').name, 'Agent Instruction');
	});
	test('non-agent surface keeps the active template', () => {
		assert.strictEqual(templateForSurface(cfg(), 'generic').name, 'Freitext');
	});
	test('agent surface falls back to active when no Agent Instruction template exists', () => {
		const c = cfg(); c.templates = [active];
		assert.strictEqual(templateForSurface(c, 'agent').name, 'Freitext');
	});
	test('cleanupContextFor uses the override prompt', () => {
		const ctx = cleanupContextFor(cfg(), undefined, agent);
		assert.strictEqual(ctx.templatePrompt, 'AGENT');
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --workspace apps/macos run test:unit`
Expected: FAIL — `templateForSurface` undefined; `cleanupContextFor` ignores a third argument.

- [ ] **Step 3: Implement the helper + override**

In `apps/macos/src/config/verbaConfig.ts`:

```typescript
export function templateForSurface(config: ResolvedConfig, surfaceClass: string): Template {
	if (surfaceClass === 'agent') {
		const agent = config.templates.find(t => t.name === 'Agent Instruction');
		if (agent) { return agent; }
	}
	return config.activeTemplate;
}
```
And change `cleanupContextFor` to accept an override:

```typescript
export function cleanupContextFor(config: ResolvedConfig, context?: PipelineContext, templateOverride?: Template): PipelineContext {
	const template = templateOverride ?? config.activeTemplate;
	const merged: PipelineContext = { ...context, templatePrompt: template.prompt };
	if (config.language !== 'auto') {
		merged.detectedLanguage = config.language;
	}
	if (template.outputLanguage) {
		merged.outputLanguage = template.outputLanguage;
	}
	return merged;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --workspace apps/macos run test:unit`
Expected: PASS (all `templateForSurface + override` tests, plus the Plan-2A `cleanupContextFor outputLanguage` suite still green since `templateOverride` is optional).

- [ ] **Step 5: Wire detection into the cleanup call in `wiring.ts`**

In `apps/macos/src/wiring.ts`, replace the `process` wrapper (lines ~86-87):

```typescript
			process: (transcript, context, signal) =>
				cleanup.process(transcript, cleanupContextFor(configState.current, context), signal),
```

with a version that detects the surface and picks the template (add `templateForSurface` to the `verbaConfig` import, and a `Surface` type inline):

```typescript
			process: async (transcript, context, signal) => {
				const cfg = configState.current;
				let surfaceClass = 'generic';
				try {
					const surface = await invoke<{ class: string }>('detect_surface', {
						agentMarkers: cfg.agentMarkers,
						terminalApps: cfg.terminalApps,
						editorApps: cfg.editorApps,
					});
					surfaceClass = surface.class;
				} catch (err) {
					console.warn('[Verba] surface detection failed, using active template:', err);
				}
				const template = templateForSurface(cfg, surfaceClass);
				return cleanup.process(transcript, cleanupContextFor(cfg, context, template), signal);
			},
```
Confirm `invoke` is already in scope in `wiring.ts` (it wires other commands); if not, import it the same way the file already imports Tauri IPC.

- [ ] **Step 6: Verify the full macOS + core suites**

Run: `npm --workspace apps/macos run test:unit` and `npm run test:core`
Expected: PASS both. Then `npm run compile` (VS Code) exits 0 to confirm no cross-host type breakage from the `ResolvedConfig` additions.

- [ ] **Step 7: Commit**

```bash
git add apps/macos/src/config/verbaConfig.ts apps/macos/src/wiring.ts apps/macos/src/test/unit/verbaConfig.test.ts
```
Commit via `/git-workflow:commit`. Suggested: `✨ feat(macos): Oberflächen-Erkennung wählt Agent-Instruction-Template automatisch`

---

## Manual QA (not automatable)

The AX/NSWorkspace tiers read live OS state and cannot be unit-tested. After Task 5, verify by hand:
1. Focus a terminal running `herdr` with a focused agent pane → dictate → cleaned text is an agent instruction (Agent Instruction template active).
2. Focus a plain shell (no agent) in the same terminal app → dictate → prose default (generic).
3. Focus a standalone `claude`/`codex` in a terminal without herdr (title shows the tool) → agent instruction.
4. Focus Slack/Mail → prose default.
5. Revoke Accessibility permission → detection degrades to `generic`, dictation still works (no crash).

## Self-Review

**Spec coverage (Plan-2B slice):**
- Tiered macOS detection (herdr → AX title → NSWorkspace), agent-state-aware via herdr `agent_status` → Tasks 2-4. ✅
- Detection config schema (markers, terminal/editor apps), user-overridable → Task 1. ✅
- macOS per-dictation template override by surface, controller unchanged → Task 5. ✅
- Graceful degradation (any tier / total failure → `generic`, never aborts) → `query_herdr` timeout+None, AX `.ok()?`, `detect_surface` `unwrap_or_else(generic)`, `wiring.ts` try/catch. ✅
- Manual override preserved: surface only overrides to Agent Instruction on positive agent detection; otherwise the configured `activeTemplate` (which the user set) wins. ✅
- Fast-follow (out of scope, noted): routing the cleaned instruction to the focused `herdr` pane via the socket; standalone-agent detection inside VS Code's integrated terminal.

**Placeholder scan:** No TBD/TODO. FFI steps are explicit build-verify loops with the researched code as the starting point and `cargo build` as the gate — this is honest for FFI whose exact method names shift across crate versions, not a placeholder. Every command has an expected result. ✅

**Type consistency:** `Surface { class, agent, status }` is identical in the Rust `Serialize` struct, the `detect_surface` return, and the TS `invoke<{ class: string }>` read (TS reads only `class`). `templateForSurface(config, surfaceClass: string)` and `cleanupContextFor(config, context?, templateOverride?)` signatures match across definition, tests, and the `wiring.ts` call site. The command arg names `agentMarkers`/`terminalApps`/`editorApps` (camelCase, Tauri auto-converts to the Rust snake_case params `agent_markers`/`terminal_apps`/`editor_apps`) match the `ResolvedConfig` field names from Task 1. ✅
