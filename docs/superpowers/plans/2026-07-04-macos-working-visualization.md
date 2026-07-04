# macOS Working-State Visualization (Sub-Project C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show dictation state on two always-visible surfaces — a state-swapping menu-bar (tray) icon with tooltip/title, and a focus-safe floating HUD pill — driven by one discrete state from the controller.

**Architecture:** A pure `presentationFor(state)` maps `idle|recording|transcribing|processing` to tray + HUD presentation. A frontend `visualization` adapter calls two Rust commands (`set_tray_state`, `set_hud_state`); Rust owns all window/tray manipulation so the HUD never takes focus. The controller emits the state via a new `ui.setState` seam.

**Tech Stack:** TypeScript (Vite/Tauri), Rust (Tauri v2 commands, tray, second window), mocha (TDD) + sinon, Pillow (icon generation).

## Global Constraints

- Scope `apps/macos` only. `packages/core` and the VS Code extension untouched.
- States: `idle | recording | transcribing | processing`.
- **The HUD window MUST never take keyboard focus** (`focus:false`, non-activating, `set_ignore_cursor_events(true)`, shown via `.show()` WITHOUT `.set_focus()`). Gating check: paste still works while the HUD is visible.
- Every visualization call is best-effort: errors are caught and logged, never propagated (must never break the dictation flow).
- Presentation copy (German tooltip/title/label per state) lives in exactly ONE place: `statePresentation.ts`. Rust selects only the icon asset by state key.
- Tests: mocha TDD ui (`suite`/`test`/`setup`), sinon, `assert`; files in `apps/macos/src/test/unit/*.test.ts`; run `cd apps/macos && npm run test:unit`. Rust changes verified via `cd apps/macos/src-tauri && cargo build`.

---

## File Structure

- Create `apps/macos/src/visualization/statePresentation.ts` — `DictationState` type + pure `presentationFor` (Task 1).
- Create `apps/macos/src/test/unit/statePresentation.test.ts` — mapping tests (Task 1).
- Create `apps/macos/scripts/gen_state_icons.py` + `apps/macos/src-tauri/icons/state/{idle,recording,transcribing,processing}.png` — tray icons (Task 2).
- Create `apps/macos/src-tauri/src/tray.rs` — `set_tray_state` command (Task 2).
- Create `apps/macos/src-tauri/src/hud.rs` — `set_hud_state` command (Task 3).
- Create `apps/macos/hud.html` + `apps/macos/src/hud/hud.ts` — HUD page (Task 3).
- Modify `apps/macos/vite.config.ts` (2nd input), `apps/macos/src-tauri/tauri.conf.json` (hud window + macOSPrivateApi), `apps/macos/src-tauri/Cargo.toml` (macos-private-api feature), `apps/macos/src-tauri/capabilities/default.json` (hud window + events), `apps/macos/src-tauri/src/lib.rs` (register modules/commands) (Tasks 2–3).
- Create `apps/macos/src/visualization/visualization.ts` + test — adapter (Task 4).
- Modify `apps/macos/src/controller.ts` + `apps/macos/src/test/unit/controller.test.ts` + `apps/macos/src/wiring.ts` — state seam + wiring (Task 5).

---

### Task 1: `DictationState` + pure `presentationFor` (TypeScript, TDD)

**Files:**
- Create: `apps/macos/src/visualization/statePresentation.ts`
- Test: `apps/macos/src/test/unit/statePresentation.test.ts`

**Interfaces:**
- Produces: `export type DictationState = 'idle' | 'recording' | 'transcribing' | 'processing';` and `export interface Presentation { hudVisible: boolean; hudIcon: string; hudLabel: string; hudAccent: string; trayTooltip: string; trayTitle: string; }` and `export function presentationFor(state: DictationState): Presentation`.

- [ ] **Step 1: Write the failing tests**

Create `apps/macos/src/test/unit/statePresentation.test.ts`:

```ts
import * as assert from 'assert';

import { presentationFor } from '../../visualization/statePresentation';

suite('presentationFor', () => {
	test('idle → HUD hidden, idle tooltip, empty title', () => {
		const p = presentationFor('idle');
		assert.strictEqual(p.hudVisible, false);
		assert.strictEqual(p.trayTooltip, 'Verba — bereit');
		assert.strictEqual(p.trayTitle, '');
	});

	test('recording → HUD visible, red accent, mic icon', () => {
		const p = presentationFor('recording');
		assert.strictEqual(p.hudVisible, true);
		assert.strictEqual(p.hudIcon, '🎙');
		assert.strictEqual(p.hudLabel, 'Aufnahme …');
		assert.strictEqual(p.hudAccent, '#e5484d');
		assert.strictEqual(p.trayTooltip, 'Verba — Aufnahme');
		assert.strictEqual(p.trayTitle, '●');
	});

	test('transcribing → amber accent, record icon', () => {
		const p = presentationFor('transcribing');
		assert.strictEqual(p.hudVisible, true);
		assert.strictEqual(p.hudIcon, '⏺');
		assert.strictEqual(p.hudLabel, 'Transkribiere …');
		assert.strictEqual(p.hudAccent, '#f5a623');
		assert.strictEqual(p.trayTooltip, 'Verba — Transkribiere');
		assert.strictEqual(p.trayTitle, '…');
	});

	test('processing → blue accent, gear icon', () => {
		const p = presentationFor('processing');
		assert.strictEqual(p.hudVisible, true);
		assert.strictEqual(p.hudIcon, '⚙');
		assert.strictEqual(p.hudLabel, 'Verarbeite mit Claude …');
		assert.strictEqual(p.hudAccent, '#3b82f6');
		assert.strictEqual(p.trayTooltip, 'Verba — Verarbeite');
		assert.strictEqual(p.trayTitle, '…');
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/macos && npm run test:unit -- --grep presentationFor`
Expected: FAIL — cannot find module `../../visualization/statePresentation`.

- [ ] **Step 3: Write the implementation**

Create `apps/macos/src/visualization/statePresentation.ts`:

```ts
/** The discrete dictation-flow state that drives both visualization surfaces. */
export type DictationState = 'idle' | 'recording' | 'transcribing' | 'processing';

/** Everything the tray adapter and the HUD need to render a given state. */
export interface Presentation {
	hudVisible: boolean;
	hudIcon: string;
	hudLabel: string;
	hudAccent: string;
	trayTooltip: string;
	trayTitle: string;
}

const TABLE: Record<DictationState, Presentation> = {
	idle: {
		hudVisible: false, hudIcon: '', hudLabel: '', hudAccent: '',
		trayTooltip: 'Verba — bereit', trayTitle: '',
	},
	recording: {
		hudVisible: true, hudIcon: '🎙', hudLabel: 'Aufnahme …', hudAccent: '#e5484d',
		trayTooltip: 'Verba — Aufnahme', trayTitle: '●',
	},
	transcribing: {
		hudVisible: true, hudIcon: '⏺', hudLabel: 'Transkribiere …', hudAccent: '#f5a623',
		trayTooltip: 'Verba — Transkribiere', trayTitle: '…',
	},
	processing: {
		hudVisible: true, hudIcon: '⚙', hudLabel: 'Verarbeite mit Claude …', hudAccent: '#3b82f6',
		trayTooltip: 'Verba — Verarbeite', trayTitle: '…',
	},
};

/** Pure state → presentation mapping. The single source of the German copy. */
export function presentationFor(state: DictationState): Presentation {
	return TABLE[state];
}
```

- [ ] **Step 4: Run to verify they pass** — `cd apps/macos && npm run test:unit -- --grep presentationFor` → 4 passing.
- [ ] **Step 5: Typecheck** — `cd apps/macos && npm run typecheck` → clean.
- [ ] **Step 6: Commit**

```bash
git add apps/macos/src/visualization/statePresentation.ts apps/macos/src/test/unit/statePresentation.test.ts
git commit -m "✨ feat(macos): DictationState + presentationFor (Zustands-Mapping)"
```

---

### Task 2: Tray state icons + `set_tray_state` (Rust)

**Files:**
- Create: `apps/macos/scripts/gen_state_icons.py`, `apps/macos/src-tauri/icons/state/{idle,recording,transcribing,processing}.png`
- Create: `apps/macos/src-tauri/src/tray.rs`
- Modify: `apps/macos/src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `#[tauri::command] pub fn set_tray_state(app: AppHandle, state: String, tooltip: String, title: String) -> Result<(), String>` — swaps the tray icon by `state`, sets tooltip and (macOS) title.

- [ ] **Step 1: Write the icon generator and generate the PNGs**

Create `apps/macos/scripts/gen_state_icons.py`:

```python
"""Generates the four monochrome menu-bar state icons (template images).
Run once: `python3 apps/macos/scripts/gen_state_icons.py`. Commit the PNGs."""
import os
from PIL import Image, ImageDraw

SIZE = 44
OUT = os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'icons', 'state')
os.makedirs(OUT, exist_ok=True)
BLACK = (0, 0, 0, 255)

def canvas():
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)

img, d = canvas()                       # idle: ring
d.ellipse([10, 10, 34, 34], outline=BLACK, width=4)
img.save(os.path.join(OUT, 'idle.png'))

img, d = canvas()                       # recording: filled disc
d.ellipse([10, 10, 34, 34], fill=BLACK)
img.save(os.path.join(OUT, 'recording.png'))

img, d = canvas()                       # transcribing: three dots
for cx in (13, 22, 31):
    d.ellipse([cx - 3, 19, cx + 3, 25], fill=BLACK)
img.save(os.path.join(OUT, 'transcribing.png'))

img, d = canvas()                       # processing: rounded square
d.rounded_rectangle([12, 12, 32, 32], radius=5, fill=BLACK)
img.save(os.path.join(OUT, 'processing.png'))

print('wrote 4 state icons to', os.path.normpath(OUT))
```

Run: `cd /Users/daniel/GitRepository/verba && python3 apps/macos/scripts/gen_state_icons.py`
Expected: `wrote 4 state icons to …/src-tauri/icons/state` and four PNGs exist (`ls apps/macos/src-tauri/icons/state`).

- [ ] **Step 2: Write `tray.rs`**

Create `apps/macos/src-tauri/src/tray.rs`:

```rust
//! Menu-bar (tray) state feedback: swaps the tray icon and sets tooltip/title
//! to reflect the current dictation state. The tooltip/title strings come from
//! the frontend (single source: `statePresentation.ts`); the icon asset is
//! selected here by state key.

use tauri::image::Image;
use tauri::{AppHandle, Manager};

const IDLE_ICON: &[u8] = include_bytes!("../icons/state/idle.png");
const RECORDING_ICON: &[u8] = include_bytes!("../icons/state/recording.png");
const TRANSCRIBING_ICON: &[u8] = include_bytes!("../icons/state/transcribing.png");
const PROCESSING_ICON: &[u8] = include_bytes!("../icons/state/processing.png");

fn icon_bytes(state: &str) -> &'static [u8] {
    match state {
        "recording" => RECORDING_ICON,
        "transcribing" => TRANSCRIBING_ICON,
        "processing" => PROCESSING_ICON,
        _ => IDLE_ICON,
    }
}

/// Updates the tray icon, tooltip, and (macOS) title for `state`. Best-effort:
/// if the tray is not yet available it returns Ok without error.
#[tauri::command]
pub fn set_tray_state(
    app: AppHandle,
    state: String,
    tooltip: String,
    title: String,
) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("verba-tray") else {
        return Ok(());
    };
    let image = Image::from_bytes(icon_bytes(&state)).map_err(|e| e.to_string())?;
    tray.set_icon(Some(image)).map_err(|e| e.to_string())?;
    tray.set_icon_as_template(true).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(&tooltip)).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    tray.set_title(Some(&title)).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = &title;
    Ok(())
}
```

- [ ] **Step 3: Register in `lib.rs`**

Add `mod tray;` to the module list (keep sorted: after `mod store;`, before `mod transcribe;` → actually alphabetical places `tray` after `transcribe`; use: `mod store; mod transcribe; mod tray;`). Add `tray::set_tray_state,` to the `generate_handler!` list.

- [ ] **Step 4: Build**

Run: `cd apps/macos/src-tauri && cargo build 2>&1 | tail -12`
Expected: `Finished`, no errors, no warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/macos/scripts/gen_state_icons.py apps/macos/src-tauri/icons/state apps/macos/src-tauri/src/tray.rs apps/macos/src-tauri/src/lib.rs
git commit -m "✨ feat(macos): Tray-Icon-States + set_tray_state (Icon-Swap, Tooltip, Title)"
```

---

### Task 3: HUD window + `set_hud_state` (Rust + frontend page + config)

**Files:**
- Create: `apps/macos/hud.html`, `apps/macos/src/hud/hud.ts`, `apps/macos/src-tauri/src/hud.rs`
- Modify: `apps/macos/vite.config.ts`, `apps/macos/src-tauri/tauri.conf.json`, `apps/macos/src-tauri/Cargo.toml`, `apps/macos/src-tauri/capabilities/default.json`, `apps/macos/src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `#[tauri::command] pub fn set_hud_state(app, state: String, label: String, icon: String, accent: String) -> Result<(), String>` — `idle` hides the HUD; otherwise emits `hud:state` `{label,icon,accent}` to the hud webview, positions bottom-center, and shows it without focus.

- [ ] **Step 1: Add the second Vite input**

In `apps/macos/vite.config.ts`, change the `build` block to add rollup inputs:

```ts
	build: {
		outDir: 'dist',
		target: 'es2022',
		rollupOptions: {
			input: {
				main: 'index.html',
				hud: 'hud.html',
			},
		},
	},
```

- [ ] **Step 2: Create the HUD page**

Create `apps/macos/hud.html`:

```html
<!doctype html>
<html lang="de">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Verba HUD</title>
		<style>
			html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
			#pill {
				--accent: #888;
				display: flex; align-items: center; gap: 10px;
				height: 40px; margin: 8px; padding: 0 16px;
				border-radius: 20px;
				background: rgba(28, 28, 30, 0.92);
				border: 1px solid var(--accent);
				box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
				color: #f2f2f7; font: 500 13px -apple-system, system-ui, sans-serif;
				white-space: nowrap;
			}
			#icon { font-size: 15px; }
			#dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
			@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
		</style>
	</head>
	<body>
		<div id="pill">
			<span id="dot"></span>
			<span id="icon"></span>
			<span id="label"></span>
		</div>
		<script type="module" src="/src/hud/hud.ts"></script>
	</body>
</html>
```

Create `apps/macos/src/hud/hud.ts`:

```ts
import { listen } from '@tauri-apps/api/event';

interface HudPayload { label: string; icon: string; accent: string; }

/** Renders the pill from a pushed state payload. */
function render(p: HudPayload): void {
	const icon = document.getElementById('icon');
	const label = document.getElementById('label');
	const pill = document.getElementById('pill');
	if (icon) { icon.textContent = p.icon; }
	if (label) { label.textContent = p.label; }
	if (pill && p.accent) { pill.style.setProperty('--accent', p.accent); }
}

void listen<HudPayload>('hud:state', (event) => render(event.payload));
```

- [ ] **Step 3: Declare the HUD window + enable transparency**

In `apps/macos/src-tauri/tauri.conf.json`, in the `app` object add `"macOSPrivateApi": true` and add the `hud` window to the `windows` array (keep the existing `main` window unchanged):

```json
	"app": {
		"macOSPrivateApi": true,
		"withGlobalTauri": false,
		"windows": [
			{ "label": "main", "title": "Verba", "width": 480, "height": 320, "visible": false, "resizable": true },
			{
				"label": "hud",
				"url": "hud.html",
				"width": 300,
				"height": 56,
				"transparent": true,
				"decorations": false,
				"alwaysOnTop": true,
				"focus": false,
				"skipTaskbar": true,
				"shadow": false,
				"resizable": false,
				"visible": false
			}
		],
		"security": { "csp": null }
	}
```

In `apps/macos/src-tauri/Cargo.toml`, add the `macos-private-api` feature to the tauri dependency:

```toml
tauri = { version = "2", features = ["tray-icon", "macos-private-api"] }
```

- [ ] **Step 4: Allow the hud window + events in capabilities**

In `apps/macos/src-tauri/capabilities/default.json`, add `"hud"` to `windows` and add `"core:event:default"` to `permissions`:

```json
	"windows": ["main", "hud"],
	"permissions": [
		"core:default",
		"core:window:allow-show",
		"core:window:allow-hide",
		"core:window:allow-set-focus",
		"core:event:default",
		"global-shortcut:allow-register",
		"global-shortcut:allow-unregister",
		"global-shortcut:allow-is-registered",
		"notification:default"
	]
```

- [ ] **Step 5: Write `hud.rs`**

Create `apps/macos/src-tauri/src/hud.rs`:

```rust
//! The floating HUD window. Rust owns show/hide/position so the window is
//! never focused — critical: a focused HUD would steal focus and the paste's
//! synthetic ⌘V would land in Verba instead of the user's frontmost app.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

#[derive(Clone, Serialize)]
struct HudPayload {
    label: String,
    icon: String,
    accent: String,
}

/// `idle` hides the HUD; any other state pushes content to the hud webview,
/// positions it bottom-center, and shows it WITHOUT focus. Best-effort.
#[tauri::command]
pub fn set_hud_state(
    app: AppHandle,
    state: String,
    label: String,
    icon: String,
    accent: String,
) -> Result<(), String> {
    let Some(win) = app.get_webview_window("hud") else {
        return Ok(());
    };
    if state == "idle" {
        let _ = win.hide();
        return Ok(());
    }
    let _ = app.emit_to("hud", "hud:state", HudPayload { label, icon, accent });
    position_bottom_center(&win);
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.set_always_on_top(true);
    let _ = win.show(); // deliberately NOT set_focus — must not steal focus
    Ok(())
}

fn position_bottom_center(win: &WebviewWindow) {
    let Ok(Some(monitor)) = win.primary_monitor() else {
        return;
    };
    let Ok(size) = win.outer_size() else {
        return;
    };
    let m_pos = monitor.position();
    let m_size = monitor.size();
    let margin: i32 = 80;
    let x = m_pos.x + (m_size.width as i32 - size.width as i32) / 2;
    let y = m_pos.y + m_size.height as i32 - size.height as i32 - margin;
    let _ = win.set_position(PhysicalPosition::new(x, y));
}
```

- [ ] **Step 6: Register in `lib.rs`**

Add `mod hud;` to the module list (keep sorted). Add `hud::set_hud_state,` to the `generate_handler!` list.

- [ ] **Step 7: Build**

Run: `cd apps/macos/src-tauri && cargo build 2>&1 | tail -15`
Expected: `Finished`, no errors. (A first build after adding `macos-private-api` recompiles tauri — may take a while.)

Run (frontend build sanity, ensures the 2nd Vite entry resolves): `cd apps/macos && npm run typecheck 2>&1 | tail -8`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/macos/hud.html apps/macos/src/hud/hud.ts apps/macos/src-tauri/src/hud.rs apps/macos/vite.config.ts apps/macos/src-tauri/tauri.conf.json apps/macos/src-tauri/Cargo.toml apps/macos/src-tauri/Cargo.lock apps/macos/src-tauri/capabilities/default.json apps/macos/src-tauri/src/lib.rs
git commit -m "✨ feat(macos): fokus-sichere HUD-Pille (Fenster, set_hud_state, Page)"
```

---

### Task 4: Visualization adapter (TypeScript, TDD)

**Files:**
- Create: `apps/macos/src/visualization/visualization.ts`
- Test: `apps/macos/src/test/unit/visualization.test.ts`

**Interfaces:**
- Consumes: `presentationFor` + `DictationState` (Task 1); the `set_tray_state` and `set_hud_state` commands (Tasks 2–3).
- Produces: `export function createVisualization(invoke?): { setState(state: DictationState): void }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/macos/src/test/unit/visualization.test.ts`:

```ts
import * as assert from 'assert';
import * as sinon from 'sinon';

import { createVisualization } from '../../visualization/visualization';

suite('createVisualization', () => {
	test('setState invokes both tray and hud commands with mapped values', () => {
		const invoke = sinon.stub().resolves(undefined);
		createVisualization(invoke).setState('recording');

		const tray = invoke.getCalls().find((c) => c.args[0] === 'set_tray_state');
		const hud = invoke.getCalls().find((c) => c.args[0] === 'set_hud_state');
		assert.ok(tray, 'set_tray_state called');
		assert.ok(hud, 'set_hud_state called');
		assert.deepStrictEqual(tray!.args[1], { state: 'recording', tooltip: 'Verba — Aufnahme', title: '●' });
		assert.deepStrictEqual(hud!.args[1], { state: 'recording', label: 'Aufnahme …', icon: '🎙', accent: '#e5484d' });
	});

	test('setState for idle still calls set_hud_state (so the HUD hides)', () => {
		const invoke = sinon.stub().resolves(undefined);
		createVisualization(invoke).setState('idle');
		assert.ok(invoke.getCalls().some((c) => c.args[0] === 'set_hud_state' && c.args[1].state === 'idle'));
	});

	test('is best-effort: a rejecting invoke does not throw', () => {
		const invoke = sinon.stub().rejects(new Error('ipc down'));
		assert.doesNotThrow(() => createVisualization(invoke).setState('processing'));
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/macos && npm run test:unit -- --grep createVisualization`
Expected: FAIL — cannot find module `../../visualization/visualization`.

- [ ] **Step 3: Write the implementation**

Create `apps/macos/src/visualization/visualization.ts`:

```ts
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { presentationFor, type DictationState } from './statePresentation';

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * Drives the two visualization surfaces (tray + HUD) from a dictation state.
 * All calls are best-effort — a failed IPC is logged and swallowed so the
 * dictation flow is never affected.
 */
export function createVisualization(invoke: Invoke = tauriInvoke): { setState(state: DictationState): void } {
	return {
		setState(state: DictationState): void {
			const p = presentationFor(state);
			void invoke('set_tray_state', { state, tooltip: p.trayTooltip, title: p.trayTitle })
				.catch((err) => console.warn('[Verba] set_tray_state failed:', err));
			void invoke('set_hud_state', { state, label: p.hudLabel, icon: p.hudIcon, accent: p.hudAccent })
				.catch((err) => console.warn('[Verba] set_hud_state failed:', err));
		},
	};
}
```

- [ ] **Step 4: Run to verify they pass** — `cd apps/macos && npm run test:unit -- --grep createVisualization` → 3 passing.
- [ ] **Step 5: Typecheck** — `cd apps/macos && npm run typecheck` → clean.
- [ ] **Step 6: Commit**

```bash
git add apps/macos/src/visualization/visualization.ts apps/macos/src/test/unit/visualization.test.ts
git commit -m "✨ feat(macos): Visualization-Adapter (setState → Tray + HUD)"
```

---

### Task 5: State seam in controller + wiring

**Files:**
- Modify: `apps/macos/src/controller.ts`
- Modify: `apps/macos/src/test/unit/controller.test.ts`
- Modify: `apps/macos/src/wiring.ts`

**Interfaces:**
- Consumes: `DictationState` (Task 1), `createVisualization` (Task 4).
- Produces: `ControllerUi.setState(state: DictationState): void`; the controller calls it at its four transitions.

- [ ] **Step 1: Add `setState` to the fake UI and assert calls (failing test)**

In `apps/macos/src/test/unit/controller.test.ts`, find where the fake `ui` object is built (it has `setPhase`, `showTranscript`, `showAccessibilityOnboarding`). Add a `setState: sinon.stub()` to it. Then add this test inside the suite (it will fail to compile until the interface + calls exist):

```ts
	test('emits setState across the dictation lifecycle', async () => {
		invoke.withArgs('stop_capture').resolves('/tmp/rec.wav');
		invoke.withArgs('has_accessibility_permission').resolves(true);
		invoke.withArgs('paste_text').resolves(undefined);
		deepgram.transcribe.resolves({ text: 'hallo', detectedLanguage: 'de' });
		cleanup.process.resolves('hallo');

		await controller.handleHotkey(); // start → recording
		await controller.handleHotkey(); // stop → transcribing → processing → idle

		const states = (ui.setState as sinon.SinonStub).getCalls().map((c) => c.args[0]);
		assert.deepStrictEqual(states, ['recording', 'transcribing', 'processing', 'idle']);
	});
```

(Adjust the stub names — `invoke`, `deepgram`, `cleanup`, `ui`, `controller` — to match the identifiers already used in this test file's `setup`. Read the file first.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/macos && npm run test:unit -- --grep "setState across"`
Expected: FAIL (compile error: `setState` not on `ControllerUi`, or assertion fails).

- [ ] **Step 3: Add `setState` to `ControllerUi` and call it at the transitions**

In `apps/macos/src/controller.ts`:

Add the import at the top:

```ts
import type { DictationState } from './visualization/statePresentation';
```

Add `setState` to the `ControllerUi` interface (next to `setPhase`):

```ts
	setPhase(text: string): void;
	setState(state: DictationState): void;
```

In `startRecording`, after `this.deps.ui.setPhase('Recording… press the hotkey again to stop.');` add:

```ts
			this.deps.ui.setState('recording');
```

In `stopAndTranscribe`, after `this.deps.ui.setPhase('Transcribing…');` add:

```ts
			this.deps.ui.setState('transcribing');
```

after `this.deps.ui.setPhase('Processing…');` add:

```ts
				this.deps.ui.setState('processing');
```

and change the `finally` block of `stopAndTranscribe` from:

```ts
		} finally {
			this.working = false;
		}
```

to:

```ts
		} finally {
			this.working = false;
			this.deps.ui.setState('idle');
		}
```

(The `finally` guarantees `idle` on every exit — success, paste-failure, accessibility-onboarding return, or error.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/macos && npm run test:unit -- --grep "setState across"`
Expected: PASS.

- [ ] **Step 5: Wire the real visualization into `wiring.ts`**

In `apps/macos/src/wiring.ts`, add the import:

```ts
import { createVisualization } from './visualization/visualization';
```

Inside `createDictationController`, before the `return new DictationController({`, add:

```ts
	const visualization = createVisualization(invoke);
```

and add `setState` to the `ui` object in the deps:

```ts
		ui: { setPhase, showTranscript, showAccessibilityOnboarding, setState: visualization.setState },
```

- [ ] **Step 6: Typecheck + full suite**

Run: `cd apps/macos && npm run typecheck` → clean.
Run: `cd apps/macos && npm run test:unit 2>&1 | tail -20` → all suites pass (statePresentation, visualization, controller incl. the new setState test, plus the existing loadConfig/EnvAwareSecretStore/DeepgramTauriProvider suites).

- [ ] **Step 7: Commit**

```bash
git add apps/macos/src/controller.ts apps/macos/src/test/unit/controller.test.ts apps/macos/src/wiring.ts
git commit -m "✨ feat(macos): Controller emittiert DictationState, Visualization verdrahtet"
```

---

## Manual verification (after all tasks — done with the user)

1. `just macos-dev`, dictate → the tray icon swaps idle→recording→transcribing→processing→idle, with matching tooltip/title; the HUD pill appears bottom-center with the right icon/color/label and hides at the end.
2. **Focus safety (gating):** with the HUD visible, dictate into Sublime → the cleaned text still pastes into Sublime. If it pastes into nothing/Verba, the HUD stole focus — investigate the `hud` window flags (`focus:false`, no `set_focus`).
3. Click where the HUD sits → the window beneath receives the click (click-through via `set_ignore_cursor_events`).
