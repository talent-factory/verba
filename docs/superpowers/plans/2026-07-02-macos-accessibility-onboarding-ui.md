# macOS Accessibility Onboarding UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Accessibility-permission detection and an in-window onboarding UI (message + System-Settings deep-link button) to the macOS app, wired into the existing dictation flow — without yet implementing the real paste mechanism.

**Architecture:** A new Rust module (`paste.rs`) exposes two Tauri commands: a passive `AXIsProcessTrusted()` check and an `open`-based deep-link to the Accessibility settings pane. `controller.ts`'s `stopAndTranscribe()` calls the check after each transcription and, when ungranted, shows a new onboarding UI (`ui.ts`) before falling through to the existing `showTranscript()` display. Real paste (`paste_text`) and `CleanupService` wiring are a separate, higher-risk follow-up slice — see `docs/development/phase-1-macos-app.md`, M3 entry.

**Tech Stack:** Rust (`tauri::command`, raw `extern "C"` FFI to the `ApplicationServices` framework — no new crates), TypeScript (`@tauri-apps/api` `invoke`, vanilla DOM, no framework).

## Global Constraints

- Platform is macOS only — the whole app already targets macOS exclusively (`Cargo.toml`, `tauri.conf.json`); no `#[cfg(target_os = "macos")]` guards needed, matching `audio.rs`/`secret.rs`/`store.rs`.
- No new Tauri capability/ACL entries required — custom `#[tauri::command]`s aren't gated by `capabilities/default.json` (confirmed during the M2 PR review).
- UI copy is English, matching every existing string in `ui.ts`/`controller.ts`. Git commit messages are German (project convention — use `/git-workflow:commit`).
- Out of scope for this slice, deferred to a follow-up: `paste_text` (real paste mechanism — AX insertion vs. clipboard+⌘V spike) and `CleanupService.process()` wiring.
- `apps/macos` has no TS test harness (no vitest/jest configured) and, before this plan, no Rust `#[cfg(test)]` tests anywhere in `src-tauri`. This plan does not add TS test infrastructure — TS tasks are verified via `npm run typecheck` plus the manual QA in Task 4, mirroring M1/M2's actual verification bar. It does add the crate's first Rust unit tests, kept narrowly to what's deterministically testable (a constant, and "the FFI call doesn't panic") rather than real OS permission state, which no test can control.
- Verified already (during planning, on this machine): the `AXIsProcessTrusted()` FFI call via `#[link(name = "ApplicationServices", kind = "framework")]` compiles, links, and runs (`cargo run` printed `false`, correctly, for the unprivileged calling process). **Not** verified: actually opening System Settings via the `x-apple.systempreferences:` URL (deliberately not exercised during planning to avoid popping a live System Settings window) — this is why Task 4 includes a manual click-through.

---

### Task 1: Rust — Accessibility permission check + settings deep-link

**Files:**
- Create: `apps/macos/src-tauri/src/paste.rs`
- Modify: `apps/macos/src-tauri/src/lib.rs:1-3` (add `mod paste;`)
- Modify: `apps/macos/src-tauri/src/lib.rs:24-33` (register the two new commands)

**Interfaces:**
- Produces: `pub fn has_accessibility_permission() -> bool` (Tauri command, invoked from TS as `'has_accessibility_permission'`, no args, returns `boolean`).
- Produces: `pub fn open_accessibility_settings() -> Result<(), String>` (Tauri command, invoked from TS as `'open_accessibility_settings'`, no args, returns `void` or throws).

- [ ] **Step 1: Write the failing tests**

Create `apps/macos/src-tauri/src/paste.rs` with only the test module (the items it references don't exist yet):

```rust
//! Accessibility permission check + System Settings deep-link (M3, onboarding
//! UI slice). The real paste mechanism (`paste_text`) is a separate,
//! higher-risk follow-up slice — see docs/development/phase-1-macos-app.md.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accessibility_settings_url_targets_the_privacy_pane() {
        assert_eq!(
            ACCESSIBILITY_SETTINGS_URL,
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        );
    }

    #[test]
    fn has_accessibility_permission_does_not_panic() {
        // Real permission state depends on the machine running the test; the
        // meaningful thing to assert is that the FFI call completes cleanly.
        let _: bool = has_accessibility_permission();
    }
}
```

Register the module in `apps/macos/src-tauri/src/lib.rs` — change:

```rust
mod audio;
mod secret;
mod store;
```

to:

```rust
mod audio;
mod paste;
mod secret;
mod store;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/macos/src-tauri && cargo test`
Expected: compile error — `cannot find value `ACCESSIBILITY_SETTINGS_URL`` and `cannot find function `has_accessibility_permission`` in module `paste`.

- [ ] **Step 3: Write the minimal implementation**

Add above the `#[cfg(test)]` module in `paste.rs`:

```rust
/// URL that opens System Settings directly on the Accessibility pane.
const ACCESSIBILITY_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

/// Whether this process is trusted for Accessibility (required to paste into
/// other apps). This is a passive check — unlike
/// `AXIsProcessTrustedWithOptions`, it never triggers the system's own
/// permission prompt; Verba shows its own onboarding UI instead.
#[tauri::command]
pub fn has_accessibility_permission() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Opens System Settings on the Accessibility pane so the user can grant
/// permission to Verba.
#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg(ACCESSIBILITY_SETTINGS_URL)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/macos/src-tauri && cargo test`
Expected: both `paste::tests::accessibility_settings_url_targets_the_privacy_pane` and `paste::tests::has_accessibility_permission_does_not_panic` pass; 0 failures.

- [ ] **Step 5: Register the commands with Tauri's invoke handler**

In `apps/macos/src-tauri/src/lib.rs`, change:

```rust
        .invoke_handler(tauri::generate_handler![
            audio::start_capture,
            audio::stop_capture,
            secret::secret_get,
            secret::secret_set,
            secret::secret_delete,
            store::kv_load,
            store::kv_set,
            store::read_audio_file,
        ])
```

to:

```rust
        .invoke_handler(tauri::generate_handler![
            audio::start_capture,
            audio::stop_capture,
            paste::has_accessibility_permission,
            paste::open_accessibility_settings,
            secret::secret_get,
            secret::secret_set,
            secret::secret_delete,
            store::kv_load,
            store::kv_set,
            store::read_audio_file,
        ])
```

- [ ] **Step 6: Verify the whole crate still compiles cleanly**

Run: `cd apps/macos/src-tauri && cargo check && cargo clippy -- -D warnings`
Expected: `cargo check` — 0 errors. `cargo clippy -- -D warnings` — fails only on the pre-existing `unused import: Manager` in `lib.rs:8` (present since M1, out of scope for this task); no new warnings from `paste.rs` or the `lib.rs` edits.

- [ ] **Step 7: Commit**

```bash
git add apps/macos/src-tauri/src/paste.rs apps/macos/src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
✨ feat(macos): Accessibility-Berechtigungscheck + Settings-Deep-Link (Rust)

- Neues Modul paste.rs: has_accessibility_permission() (AXIsProcessTrusted,
  passiver Check ohne System-Prompt), open_accessibility_settings() (öffnet
  Systemeinstellungen → Bedienungshilfen via x-apple.systempreferences:).
- Erste Rust-Unit-Tests im src-tauri-Crate.
- paste_text (echter Paste-Mechanismus) folgt in einem separaten Slice.
EOF
)"
```

---

### Task 2: TypeScript — onboarding UI in `ui.ts`

**Files:**
- Modify: `apps/macos/src/ui.ts`

**Interfaces:**
- Consumes: nothing new (uses the existing `reveal()` helper already in this file).
- Produces: `export async function showAccessibilityOnboarding(onOpenSettings: () => void): Promise<void>` — reveals the window, shows a message and two buttons ("Open System Settings" calls `onOpenSettings` without closing the box; "Dismiss" removes it and resolves). `onOpenSettings` is a callback rather than a direct `invoke()` call so `ui.ts` stays presentation-only (it doesn't import `@tauri-apps/api/core` today, only `@tauri-apps/api/window`); `controller.ts` (Task 3) supplies the callback.

There is no test harness for DOM code in this app (see Global Constraints). The verification for this task is `npm run typecheck`; the actual DOM behavior is verified in Task 4's manual QA.

- [ ] **Step 1: Add the function**

Append to `apps/macos/src/ui.ts` (after `promptForApiKey`):

```ts
/**
 * Shows an Accessibility-permission onboarding message with a button that
 * opens System Settings. Resolves once the user dismisses it — clicking
 * "Open System Settings" does not dismiss the box, since the user needs to
 * switch away to System Settings and back before retrying the hotkey.
 */
export async function showAccessibilityOnboarding(onOpenSettings: () => void): Promise<void> {
	await reveal();
	if (document.getElementById('accessibility-onboarding')) { return; }

	const app = document.getElementById('app');
	if (!app) { return; }

	return new Promise((resolve) => {
		const box = document.createElement('div');
		box.id = 'accessibility-onboarding';

		const message = document.createElement('p');
		message.textContent =
			'Verba needs Accessibility permission to paste into other apps. ' +
			'Grant it in System Settings, then press the hotkey again to dictate.';

		const openSettings = document.createElement('button');
		openSettings.type = 'button';
		openSettings.textContent = 'Open System Settings';
		openSettings.addEventListener('click', () => { onOpenSettings(); });

		const dismiss = document.createElement('button');
		dismiss.type = 'button';
		dismiss.textContent = 'Dismiss';
		dismiss.addEventListener('click', () => {
			box.remove();
			resolve();
		});

		box.append(message, openSettings, dismiss);
		app.appendChild(box);
	});
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd apps/macos && npm run typecheck`
Expected: exits 0, no output (matches the current clean baseline).

- [ ] **Step 3: Commit**

```bash
git add apps/macos/src/ui.ts
git commit -m "$(cat <<'EOF'
✨ feat(macos): Accessibility-Onboarding-UI in ui.ts ergänzen

showAccessibilityOnboarding() zeigt eine Meldung mit "Open System
Settings"/"Dismiss"-Buttons; wird in controller.ts (nächster Commit)
eingebunden.
EOF
)"
```

---

### Task 3: Wire the check into `controller.ts`

**Files:**
- Modify: `apps/macos/src/controller.ts:6` (import)
- Modify: `apps/macos/src/controller.ts:15-24` (class docblock)
- Modify: `apps/macos/src/controller.ts:78-92` (`stopAndTranscribe`)

**Interfaces:**
- Consumes: `showAccessibilityOnboarding(onOpenSettings: () => void): Promise<void>` from Task 2; `invoke<boolean>('has_accessibility_permission')` and `invoke('open_accessibility_settings')` from Task 1.

Same verification constraint as Task 2 — no TS test harness; `npm run typecheck` plus Task 4's manual QA.

- [ ] **Step 1: Update the import**

In `apps/macos/src/controller.ts`, change:

```ts
import { promptForApiKey, setPhase, showTranscript } from './ui';
```

to:

```ts
import { promptForApiKey, setPhase, showAccessibilityOnboarding, showTranscript } from './ui';
```

- [ ] **Step 2: Update the class docblock**

Change:

```ts
/**
 * Wires `@verba/core` to the macOS host adapters and owns the dictation flow.
 *
 * **M2 (this milestone):** the hotkey toggles microphone capture; on stop, the
 * recording is transcribed with {@link DeepgramProvider} and the transcript is
 * shown in the window. Keychain-backed secrets; a window prompt for API keys.
 *
 * **M3 (next):** run {@link CleanupService} on the transcript and paste the
 * result into the frontmost app instead of just displaying it.
 */
```

to:

```ts
/**
 * Wires `@verba/core` to the macOS host adapters and owns the dictation flow.
 *
 * **M2 (shipped):** the hotkey toggles microphone capture; on stop, the
 * recording is transcribed with {@link DeepgramProvider} and the transcript is
 * shown in the window. Keychain-backed secrets; a window prompt for API keys.
 *
 * **M3, onboarding-UI slice (this milestone):** after each transcription, a
 * passive Accessibility-permission check runs; when ungranted, an onboarding
 * message with a System-Settings deep-link is shown before falling through to
 * the existing transcript display. Real paste and {@link CleanupService} are a
 * separate, higher-risk follow-up slice.
 */
```

- [ ] **Step 3: Wire the check into `stopAndTranscribe`**

Change:

```ts
	private async stopAndTranscribe(): Promise<void> {
		this.working = true;
		this.recording = false;
		try {
			const wavPath = await invoke<string>('stop_capture');
			setPhase('Transcribing…');
			const { text } = await this.deepgram.transcribe(wavPath);
			await showTranscript(text);
		} catch (err) {
			this.notifier.error(`Verba: ${errText(err)}`);
			setPhase('Idle.');
		} finally {
			this.working = false;
		}
	}
```

to:

```ts
	private async stopAndTranscribe(): Promise<void> {
		this.working = true;
		this.recording = false;
		try {
			const wavPath = await invoke<string>('stop_capture');
			setPhase('Transcribing…');
			const { text } = await this.deepgram.transcribe(wavPath);

			const hasAccessibility = await invoke<boolean>('has_accessibility_permission');
			if (!hasAccessibility) {
				await showAccessibilityOnboarding(() => {
					void invoke('open_accessibility_settings');
				});
			}
			await showTranscript(text);
		} catch (err) {
			this.notifier.error(`Verba: ${errText(err)}`);
			setPhase('Idle.');
		} finally {
			this.working = false;
		}
	}
```

- [ ] **Step 4: Verify it type-checks**

Run: `cd apps/macos && npm run typecheck`
Expected: exits 0, no output.

- [ ] **Step 5: Commit**

```bash
git add apps/macos/src/controller.ts
git commit -m "$(cat <<'EOF'
✨ feat(macos): Accessibility-Onboarding in den Diktier-Flow einbinden

stopAndTranscribe() prüft nach jeder Transkription
has_accessibility_permission; bei fehlender Berechtigung erscheint die
Onboarding-Meldung mit Settings-Deep-Link, danach wird der Transkript-
Anzeige-Pfad aus M2 unverändert durchlaufen. Echtes Einfügen
(paste_text) folgt separat.
EOF
)"
```

---

### Task 4: Verify end-to-end and update the milestone doc

**Files:**
- Modify: `docs/development/phase-1-macos-app.md` (mark the onboarding-UI slice of M3 as done)

- [ ] **Step 1: Full automated verification**

Run, from the repo root:

```bash
cd apps/macos/src-tauri && cargo check && cargo clippy -- -D warnings ; cd -
cd apps/macos && npm run typecheck ; cd -
```

Expected: `cargo check` 0 errors; `cargo clippy -- -D warnings` fails only on the pre-existing M1 `unused import: Manager` in `lib.rs:8` (no new warnings); `npm run typecheck` exits 0 with no output.

- [ ] **Step 2: Manual QA with the real app**

Run: `cd apps/macos && npm run tauri dev`

1. Wait for the window/tray icon to appear.
2. Press the hotkey (`Alt+Space`), speak a sentence, press it again to stop.
3. **Expected (permission not yet granted — the common first-run state):** after "Transcribing…", the window shows the Accessibility onboarding message with "Open System Settings" / "Dismiss" buttons, and the transcript below it (unchanged M2 behavior).
4. Click "Open System Settings". **Expected:** System Settings opens directly on Privacy & Security → Accessibility. **Caveat to watch for:** on some macOS versions the dev binary only appears in that list after the OS has attempted to gate an Accessibility-relevant call at least once — if Verba isn't listed yet, that's a known platform quirk, not a bug in this slice; note it in the PR rather than treating it as a blocker.
5. Grant the permission for the Verba (dev) binary, switch back to Verba.
6. Dictate again (steps 2). **Expected:** no onboarding message this time — straight to the transcript, matching current M2 behavior.
7. Note any deviation from the above before proceeding to Step 3.

- [ ] **Step 3: Update the milestone doc**

In `docs/development/phase-1-macos-app.md`, the M3 milestone entry currently starts with:

```markdown
4. **M3 — Cleanup + paste.** ⏳ Planned — `controller.ts`'s `stopAndTranscribe()`
```

Change the status marker and lead sentence to:

```markdown
4. **M3 — Cleanup + paste.** ⏳ In progress — the onboarding-UI slice (Accessibility
   permission check + System-Settings deep-link, gated in `stopAndTranscribe()`)
   is done; paste itself is still planned. `controller.ts`'s `stopAndTranscribe()`
```

(Leave the rest of the M3 entry — the paste-mechanism spike, the deferred-to-M4 list — unchanged; only the opening status and lead-in need updating.)

- [ ] **Step 4: Commit**

```bash
git add docs/development/phase-1-macos-app.md
git commit -m "$(cat <<'EOF'
📚 docs(macos): M3-Onboarding-UI-Slice als erledigt markieren

Accessibility-Berechtigungscheck + Settings-Deep-Link sind implementiert
und manuell verifiziert; der Paste-Mechanismus selbst bleibt offen.
EOF
)"
```
