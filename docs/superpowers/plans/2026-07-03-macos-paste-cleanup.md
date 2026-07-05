# macOS Paste + Cleanup (TF-518) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dictated text lands cleaned-up (Claude post-processing) in whatever macOS app has focus, via clipboard+⌘V paste; the Verba window stays hidden except for errors and onboarding.

**Architecture:** A new Rust Tauri command `paste_text` saves the clipboard, writes the transcript, synthesizes ⌘V via CGEvent, and restores the clipboard. `CleanupService` (from `@verba/core`) runs in the WebView with `dangerouslyAllowBrowser: true`, enabled by a new optional `clientOptions` constructor parameter. `DictationController` gets its dependencies injected (new `wiring.ts` builds the real ones) so the flow becomes unit-testable; `stopAndTranscribe()` gains cleanup with raw-transcript fallback and paste with window fallback.

**Tech Stack:** Rust (Tauri 2, `arboard`, `core-graphics`), TypeScript strict (Tauri WebView), `@anthropic-ai/sdk`, Mocha (tdd UI) + Sinon.

**Spec:** `docs/superpowers/specs/2026-07-03-macos-paste-cleanup-design.md` · **Linear:** TF-518 · **Branch:** `feature/tf-518-macos-paste-mechanismus-cleanup-wiring` (already checked out)

## Global Constraints

- macOS-only code paths; Rust edition 2021, `rust-version = "1.77"`, Tauri 2.
- TypeScript strict mode; UI copy in English; code comments in English (match existing files).
- Tests: `apps/macos` and `packages/core` use **Mocha with `ui: tdd`** (`suite`/`test`/`setup`) + Sinon, compiled via `tsc` first (`npm run test:unit` does both). NOT vitest, NOT `describe/it`.
- Modules under test must not import `@tauri-apps/api/*` at module level (ESM-only package; tests run as CommonJS). Inject `invoke` etc. as dependencies — the `DeepgramTauriProvider` pattern.
- `tauri.conf.json` has `"csp": null` — **no CSP change needed** for api.anthropic.com (deviation from spec, which assumed a CSP entry).
- Commit messages: German, emoji conventional commits (`✨ feat(macos): …`), **no** Co-Authored-By/Generated-with suffixes. Interactive sessions use `/git-workflow:commit`; agentic workers commit with the exact messages given below.
- Never run `git push` or create PRs as part of this plan.

---

### Task 1: Rust — `paste_text` command (clipboard save → set → ⌘V → restore)

**Files:**
- Modify: `apps/macos/src-tauri/Cargo.toml` (add `arboard`, `core-graphics`)
- Modify: `apps/macos/src-tauri/src/paste.rs` (add command + helpers + tests)
- Modify: `apps/macos/src-tauri/src/lib.rs` (register command; ~line 24-33, `invoke_handler`)

**Interfaces:**
- Consumes: nothing new (standalone Rust module additions).
- Produces: Tauri command `paste_text(text: String) -> Result<(), String>`, invoked from TS as `invoke('paste_text', { text })`. Errors are user-presentable strings prefixed `"Paste failed: …"`.

- [ ] **Step 1: Add dependencies to `Cargo.toml`**

Append to the `[dependencies]` section of `apps/macos/src-tauri/Cargo.toml`:

```toml
# Paste mechanism (M3): clipboard save/set/restore + synthetic ⌘V keystroke.
# AX value insertion was considered and dropped — see
# docs/superpowers/specs/2026-07-03-macos-paste-cleanup-design.md.
arboard = "3"
core-graphics = "0.25"
```

If `cargo check` later fails to resolve `core-graphics = "0.25"` (API drift), fall back to `core-graphics = "0.24"` — the used API (`CGEventSource::new`, `CGEvent::new_keyboard_event`, `set_flags`, `post`) is identical in both.

- [ ] **Step 2: Write the failing tests**

In `apps/macos/src-tauri/src/paste.rs`, extend the existing `mod tests` with:

```rust
    #[test]
    fn key_v_matches_the_ansi_virtual_keycode() {
        // kVK_ANSI_V from Carbon's Events.h; ⌘V is synthesized with this code.
        assert_eq!(KEY_V, 9);
    }

    #[test]
    fn restore_waits_longer_than_pasteboard_propagation() {
        // Restoring before the target app has read the pasteboard would paste
        // the OLD clipboard content; the restore delay must dominate.
        assert!(CLIPBOARD_RESTORE_DELAY > PASTEBOARD_PROPAGATION_DELAY);
    }

    #[test]
    fn clipboard_roundtrip_preserves_previous_text() {
        // Touches the real macOS pasteboard. Skips (returns early) where no
        // pasteboard is available (headless CI); restores whatever was there.
        let mut clipboard = match Clipboard::new() {
            Ok(c) => c,
            Err(_) => return,
        };
        let original = clipboard.get_text().ok();

        clipboard.set_text("verba-paste-test").unwrap();
        assert_eq!(clipboard.get_text().unwrap(), "verba-paste-test");

        match original {
            Some(prev) => clipboard.set_text(prev).unwrap(),
            None => {
                let _ = clipboard.clear();
            }
        }
    }
```

Also add `use arboard::Clipboard;` inside `mod tests` (or reference `super::*` once Step 4's imports exist).

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/macos/src-tauri && cargo test`
Expected: compile error — `cannot find value KEY_V in this scope` (and `CLIPBOARD_RESTORE_DELAY`, `Clipboard`).

- [ ] **Step 4: Write the implementation**

At the top of `apps/macos/src-tauri/src/paste.rs`, replace the module doc comment and add imports/constants (keep the existing `ACCESSIBILITY_SETTINGS_URL`, FFI block, and both existing commands unchanged):

```rust
//! Accessibility permission check, System Settings deep-link, and the real
//! paste mechanism (M3). `paste_text` pastes via clipboard + synthetic ⌘V:
//! AX value insertion was evaluated and dropped (unproven FFI, two code
//! paths, little benefit) — see
//! docs/superpowers/specs/2026-07-03-macos-paste-cleanup-design.md.

use std::{thread, time::Duration};

use arboard::Clipboard;
use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

/// Virtual keycode for the `V` key (kVK_ANSI_V in Carbon's Events.h).
const KEY_V: CGKeyCode = 9;

/// Wait after writing the pasteboard so the write has propagated before the
/// synthetic ⌘V fires.
const PASTEBOARD_PROPAGATION_DELAY: Duration = Duration::from_millis(50);

/// Wait after ⌘V before restoring the previous clipboard content: the target
/// app reads the pasteboard asynchronously, and restoring too early makes it
/// paste the old content instead of the transcript.
const CLIPBOARD_RESTORE_DELAY: Duration = Duration::from_millis(300);
```

Then add below `open_accessibility_settings`:

```rust
/// Pastes `text` into the frontmost app: saves the current clipboard text,
/// writes `text`, synthesizes ⌘V, and restores the previous clipboard.
///
/// Non-text clipboard content (images, files) is not restored in v1 — a
/// documented limitation. Requires the Accessibility permission; the caller
/// gates on `has_accessibility_permission` first (without it the synthetic
/// keystroke is silently dropped by the OS).
///
/// Async so the two sleeps (~350ms total) run on a blocking-pool thread and
/// never stall Tauri's main thread.
#[tauri::command]
pub async fn paste_text(text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || paste_text_blocking(&text))
        .await
        .map_err(|e| format!("Paste failed: {e}"))?
}

fn paste_text_blocking(text: &str) -> Result<(), String> {
    let mut clipboard =
        Clipboard::new().map_err(|e| format!("Paste failed: clipboard unavailable: {e}"))?;
    let previous = clipboard.get_text().ok();

    clipboard
        .set_text(text)
        .map_err(|e| format!("Paste failed: could not write clipboard: {e}"))?;
    thread::sleep(PASTEBOARD_PROPAGATION_DELAY);

    synthesize_cmd_v()?;

    thread::sleep(CLIPBOARD_RESTORE_DELAY);
    if let Some(prev) = previous {
        if let Err(e) = clipboard.set_text(prev) {
            // The paste itself succeeded; a failed restore is log-only.
            eprintln!("[Verba] Could not restore previous clipboard content: {e}");
        }
    }
    Ok(())
}

/// Posts a synthetic ⌘V key-down/key-up pair to the HID event tap.
fn synthesize_cmd_v() -> Result<(), String> {
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "Paste failed: could not create event source".to_string())?;

    for key_down in [true, false] {
        let event = CGEvent::new_keyboard_event(source.clone(), KEY_V, key_down)
            .map_err(|_| "Paste failed: could not create ⌘V event".to_string())?;
        event.set_flags(CGEventFlags::CGEventFlagCommand);
        event.post(CGEventTapLocation::HID);
    }
    Ok(())
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/macos/src-tauri && cargo test`
Expected: all tests pass, including the 3 new ones (5 total in `paste::tests`). Note: the roundtrip test briefly mutates the machine's clipboard and restores it.

- [ ] **Step 6: Register the command in `lib.rs`**

In `apps/macos/src-tauri/src/lib.rs`, inside `tauri::generate_handler![…]`, add one line after `paste::open_accessibility_settings,`:

```rust
            paste::paste_text,
```

- [ ] **Step 7: Full Rust verification**

Run: `cd apps/macos/src-tauri && cargo check && cargo clippy -- -D warnings && cargo test`
Expected: 0 errors, 0 clippy warnings, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/macos/src-tauri/Cargo.toml apps/macos/src-tauri/Cargo.lock apps/macos/src-tauri/src/paste.rs apps/macos/src-tauri/src/lib.rs
git commit -m "✨ feat(macos): paste_text-Command — Clipboard-Save/Restore + synthetisches ⌘V

Pastet den Diktat-Text in die Frontmost-App: Clipboard sichern → Text
setzen → ⌘V via CGEvent auf den HID-Tap → nach 300ms Restore. Nicht-Text-
Clipboard-Inhalte werden in v1 nicht restauriert (dokumentiert). Läuft via
spawn_blocking, damit die Sleeps den Main-Thread nicht blockieren."
```

---

### Task 2: Core — `clientOptions` passthrough on `CleanupService`

**Files:**
- Modify: `packages/core/src/cleanupService.ts` (constructor ~line 82, `getClient` ~line 326)
- Test: `packages/core/src/test/unit/cleanupService.test.ts`

**Interfaces:**
- Consumes: `ClientOptions` type from `@anthropic-ai/sdk`.
- Produces: `constructor(secretStorage: SecretStore, notifier?: Notifier, clientOptions?: ClientOptions)` — third parameter optional; existing two-arg callers (VS Code extension) unchanged. Options are spread into `new Anthropic({ ...clientOptions, apiKey })` (apiKey wins over any apiKey in options).

- [ ] **Step 1: Write the failing test**

In `packages/core/src/test/unit/cleanupService.test.ts`, add inside the top-level `suite('CleanupService', …)` (e.g. after the existing `setup`, as a new nested suite):

```typescript
	suite('clientOptions passthrough', () => {
		test('spreads clientOptions into the Anthropic client', () => {
			const withOptions = new CleanupService(secretStorage as any, undefined, {
				baseURL: 'http://localhost:9999',
			});

			const client = (withOptions as any).getClient('test-key');

			assert.strictEqual(client.baseURL, 'http://localhost:9999');
		});

		test('constructs without clientOptions exactly as before', () => {
			const withoutOptions = new CleanupService(secretStorage as any);

			const client = (withoutOptions as any).getClient('test-key');

			assert.strictEqual(client.apiKey, 'test-key');
		});
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npm run test:unit`
Expected: FAIL at the compile step (`npm run compile`) with TS2554 "Expected 1-2 arguments, but got 3" on the `new CleanupService(…, …, { baseURL … })` call.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/cleanupService.ts`:

Change the first import line to:

```typescript
import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
```

Add a field next to `private notifier?: Notifier;`:

```typescript
	private clientOptions?: ClientOptions;
```

Replace the constructor (keep the doc comment, extend it):

```typescript
	/**
	 * @param secretStorage Secure store for the Anthropic API key.
	 * @param notifier Optional host UI for surfacing non-critical warnings
	 *   (e.g. empty-response fallback). When omitted, warnings are only logged.
	 * @param clientOptions Optional Anthropic SDK client options, spread into
	 *   the client constructor. Lets browser-like hosts (Tauri WebView) pass
	 *   `dangerouslyAllowBrowser: true`; the resolved API key always wins.
	 */
	constructor(secretStorage: SecretStore, notifier?: Notifier, clientOptions?: ClientOptions) {
		this.secretStorage = secretStorage;
		this.notifier = notifier;
		this.clientOptions = clientOptions;
	}
```

Replace `getClient`:

```typescript
	private getClient(apiKey: string): Anthropic {
		if (!this._client) {
			this._client = new Anthropic({ ...this.clientOptions, apiKey });
		}
		return this._client;
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npm run test:unit`
Expected: PASS — the 2 new tests and the entire existing suite (no regressions).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cleanupService.ts packages/core/src/test/unit/cleanupService.test.ts
git commit -m "✨ feat(core): optionale clientOptions am CleanupService-Konstruktor

Werden per Spread in den Anthropic-Client gereicht (apiKey gewinnt).
Ermöglicht der macOS-App dangerouslyAllowBrowser: true im Tauri-WebView;
die VS-Code-Extension bleibt unverändert (Parameter optional)."
```

---

### Task 3: macOS — dependency injection for `DictationController` (pure refactor)

`controller.ts` currently imports `invoke` from `@tauri-apps/api/core` and the UI functions directly, which makes it untestable under Mocha/CJS (`@tauri-apps/api` is ESM-only; that's why `DeepgramTauriProvider` takes `invoke` as a constructor parameter). This task moves all real-dependency construction into a new `wiring.ts` and makes the controller take its dependencies via constructor. **No behavior change.**

**Files:**
- Modify: `apps/macos/src/controller.ts` (full rewrite, content below)
- Create: `apps/macos/src/wiring.ts`
- Modify: `apps/macos/src/main.ts` (line 2 import + line 8 construction)
- Test: `apps/macos/src/test/unit/controller.test.ts` (new)

**Interfaces:**
- Consumes: `CleanupService` type from `@verba/core`; existing `TauriSecretStore`, `TauriKeyValueStore`, `TauriNotifier`, `DeepgramTauriProvider`, ui functions.
- Produces:
  - `controller.ts`: `export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>`, `export interface ControllerUi { setPhase(text: string): void; showTranscript(text: string): Promise<void>; showAccessibilityOnboarding(onOpenSettings: () => Promise<void>): Promise<void> }`, `export interface ControllerDeps { deepgram: { transcribe(audioPath: string): Promise<{ text: string; detectedLanguage?: string }> }; cleanup: Pick<CleanupService, 'process'>; notifier: { init(): Promise<void>; info(msg: string): void; warn(msg: string): void; error(msg: string): void }; store: { init(): Promise<void> }; invoke: InvokeFn; ui: ControllerUi }`, `export class DictationController { constructor(deps: ControllerDeps) }` with unchanged public methods `init()` and `handleHotkey()`.
  - `wiring.ts`: `export function createDictationController(): DictationController` (also hosts the `TauriCleanupService` subclass, moved out of controller.ts).

- [ ] **Step 1: Write the failing tests**

Create `apps/macos/src/test/unit/controller.test.ts`:

```typescript
import * as assert from 'assert';
import * as sinon from 'sinon';

import { DictationController, type ControllerDeps } from '../../controller';

/** All-stub dependency set; individual tests override behavior as needed. */
export function createDeps() {
	const invoke = sinon.stub();
	invoke.withArgs('start_capture').resolves(undefined);
	invoke.withArgs('stop_capture').resolves('/tmp/rec.wav');
	invoke.withArgs('has_accessibility_permission').resolves(true);
	invoke.withArgs('paste_text', sinon.match.any).resolves(undefined);

	return {
		deepgram: { transcribe: sinon.stub().resolves({ text: 'raw transcript', detectedLanguage: 'en' }) },
		cleanup: { process: sinon.stub().resolves('cleaned text') },
		notifier: {
			init: sinon.stub().resolves(),
			info: sinon.stub(),
			warn: sinon.stub(),
			error: sinon.stub(),
		},
		store: { init: sinon.stub().resolves() },
		invoke: invoke as unknown as ControllerDeps['invoke'],
		ui: {
			setPhase: sinon.stub(),
			showTranscript: sinon.stub().resolves(),
			showAccessibilityOnboarding: sinon.stub().resolves(),
		},
	};
}

/** Presses the hotkey twice: start recording, then stop-and-transcribe. */
async function dictate(controller: DictationController): Promise<void> {
	await controller.handleHotkey();
	await controller.handleHotkey();
}

suite('DictationController', () => {
	let deps: ReturnType<typeof createDeps>;
	let controller: DictationController;

	setup(() => {
		deps = createDeps();
		controller = new DictationController(deps as unknown as ControllerDeps);
	});

	test('first hotkey press starts capture and sets the recording phase', async () => {
		await controller.handleHotkey();

		assert.strictEqual((deps.invoke as unknown as sinon.SinonStub).calledWith('start_capture'), true);
		assert.strictEqual(deps.ui.setPhase.calledWithMatch(/Recording/), true);
	});

	test('start_capture failure surfaces as an error notification', async () => {
		(deps.invoke as unknown as sinon.SinonStub).withArgs('start_capture').rejects(new Error('no mic'));

		await controller.handleHotkey();

		assert.strictEqual(deps.notifier.error.calledWithMatch(/no mic/), true);
	});

	test('stop_capture failure surfaces as an error notification and resets to Idle', async () => {
		(deps.invoke as unknown as sinon.SinonStub).withArgs('stop_capture').rejects(new Error('capture broke'));

		await dictate(controller);

		assert.strictEqual(deps.notifier.error.calledWithMatch(/capture broke/), true);
		assert.strictEqual(deps.ui.setPhase.calledWith('Idle.'), true);
	});

	test('init initializes the store', async () => {
		await controller.init();

		assert.strictEqual(deps.store.init.calledOnce, true);
	});
});
```

(These tests survive Task 4 unchanged — the transcribe→display assertions arrive there, matching the new behavior.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/macos && npm run test:unit`
Expected: FAIL at the compile step — `Module '"../../controller"' has no exported member 'ControllerDeps'` / constructor arity error.

- [ ] **Step 3: Rewrite `controller.ts`**

Replace the entire content of `apps/macos/src/controller.ts` with:

```typescript
import type { CleanupService } from '@verba/core';

export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Window-UI surface the controller drives (implemented by `ui.ts`). */
export interface ControllerUi {
	setPhase(text: string): void;
	showTranscript(text: string): Promise<void>;
	showAccessibilityOnboarding(onOpenSettings: () => Promise<void>): Promise<void>;
}

/**
 * Everything the controller needs from the host, injected so the dictation
 * flow is unit-testable: `@tauri-apps/api` is ESM-only and cannot be loaded
 * by the CommonJS test build, so no module under test may import it directly
 * (same pattern as `DeepgramTauriProvider`). `wiring.ts` builds the real set.
 */
export interface ControllerDeps {
	deepgram: { transcribe(audioPath: string): Promise<{ text: string; detectedLanguage?: string }> };
	cleanup: Pick<CleanupService, 'process'>;
	notifier: { init(): Promise<void>; info(msg: string): void; warn(msg: string): void; error(msg: string): void };
	store: { init(): Promise<void> };
	invoke: InvokeFn;
	ui: ControllerUi;
}

/**
 * Owns the dictation flow on top of injected host adapters.
 *
 * **M2 (shipped):** the hotkey toggles microphone capture; on stop, the
 * recording is transcribed and the transcript is shown in the window.
 *
 * **M3 (this milestone):** the transcript runs through `CleanupService`
 * (raw-transcript fallback when the key prompt is cancelled or the API
 * fails) and is pasted into the frontmost app via `paste_text`. The window
 * only appears for the Accessibility onboarding or when pasting fails.
 */
export class DictationController {
	private recording = false;
	private working = false;

	constructor(private readonly deps: ControllerDeps) {}

	/** Requests permissions and loads persisted state. Call once at startup. */
	async init(): Promise<void> {
		// Don't block startup (and hotkey registration in main.ts) on the
		// notification-permission dialog: it's best-effort per the Notifier
		// contract, and on this menu-bar (Accessory-policy) app the system
		// dialog isn't reliably raised to the front, so awaiting it can hang
		// indefinitely with no visible sign anything is wrong.
		void this.deps.notifier.init();
		await this.deps.store.init();
	}

	/**
	 * Invoked by the global hotkey. First press starts capture; second press
	 * stops it, transcribes, cleans up, and pastes.
	 */
	async handleHotkey(): Promise<void> {
		if (this.working) { return; }

		if (!this.recording) {
			await this.startRecording();
			return;
		}
		await this.stopAndTranscribe();
	}

	private async startRecording(): Promise<void> {
		try {
			await this.deps.invoke('start_capture');
			this.recording = true;
			this.deps.ui.setPhase('Recording… press the hotkey again to stop.');
			this.deps.notifier.info('Verba: recording…');
		} catch (err) {
			this.deps.notifier.error(`Verba: could not start recording — ${errText(err)}`);
		}
	}

	private async stopAndTranscribe(): Promise<void> {
		this.working = true;
		this.recording = false;
		try {
			const wavPath = await this.deps.invoke<string>('stop_capture');
			this.deps.ui.setPhase('Transcribing…');
			const { text } = await this.deps.deepgram.transcribe(wavPath);

			const hasAccessibility = await this.deps.invoke<boolean>('has_accessibility_permission');
			if (!hasAccessibility) {
				await this.deps.ui.showAccessibilityOnboarding(() => this.deps.invoke('open_accessibility_settings'));
			}
			await this.deps.ui.showTranscript(text);
		} catch (err) {
			this.deps.notifier.error(`Verba: ${errText(err)}`);
			this.deps.ui.setPhase('Idle.');
		} finally {
			this.working = false;
		}
	}
}

function errText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
```

(Note: `stopAndTranscribe` still has M2 behavior — Task 4 changes it. `TauriCleanupService` moves to `wiring.ts` in the next step.)

- [ ] **Step 4: Create `wiring.ts`**

Create `apps/macos/src/wiring.ts`:

```typescript
import { CleanupService, type ApiKeyPrompt } from '@verba/core';
import { invoke } from '@tauri-apps/api/core';
import { TauriSecretStore } from './adapters/secretStore';
import { TauriKeyValueStore } from './adapters/keyValueStore';
import { TauriNotifier } from './adapters/notifier';
import { DeepgramTauriProvider } from './deepgramTauriProvider';
import { promptForApiKey, setPhase, showAccessibilityOnboarding, showTranscript } from './ui';
import { DictationController } from './controller';

/** CleanupService needs a host prompt for its API key; supply it via the window UI. */
class TauriCleanupService extends CleanupService {
	protected async promptForApiKey(): Promise<string | undefined> {
		return promptForApiKey('Anthropic API key (sk-ant-…)');
	}
}

/**
 * Builds the production dependency set (Tauri IPC, window UI, Keychain-backed
 * adapters) and hands it to the controller. Kept out of `controller.ts` so the
 * controller never imports the ESM-only `@tauri-apps/api` and stays testable.
 */
export function createDictationController(): DictationController {
	const secrets = new TauriSecretStore();
	const notifier = new TauriNotifier();
	const deepgramPrompt: ApiKeyPrompt = () => promptForApiKey('Deepgram API key (dg-…)');

	return new DictationController({
		deepgram: new DeepgramTauriProvider(secrets, deepgramPrompt),
		cleanup: new TauriCleanupService(secrets, notifier),
		notifier,
		store: new TauriKeyValueStore(),
		invoke,
		ui: { setPhase, showTranscript, showAccessibilityOnboarding },
	});
}
```

- [ ] **Step 5: Update `main.ts`**

In `apps/macos/src/main.ts`, replace line 2:

```typescript
import { createDictationController } from './wiring';
```

and inside `main()`, replace `const controller = new DictationController();` with:

```typescript
	const controller = createDictationController();
```

- [ ] **Step 6: Run tests and typecheck to verify they pass**

Run: `cd apps/macos && npm run test:unit && npm run typecheck`
Expected: all tests pass (4 new controller tests + existing deepgramTauriProvider tests); `tsc --noEmit` exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/macos/src/controller.ts apps/macos/src/wiring.ts apps/macos/src/main.ts apps/macos/src/test/unit/controller.test.ts
git commit -m "♻️ refactor(macos): DictationController per Dependency Injection testbar machen

Reale Abhängigkeiten (Tauri-invoke, Window-UI, Adapter) ziehen in ein
neues wiring.ts; der Controller bekommt sie als ControllerDeps injiziert.
@tauri-apps/api ist ESM-only und im CJS-Testbuild nicht ladbar — gleiches
Muster wie DeepgramTauriProvider. Kein Verhaltensänderung; erste
Controller-Unit-Tests."
```

---

### Task 4: macOS — cleanup + paste flow in `stopAndTranscribe()`

**Files:**
- Modify: `apps/macos/src/controller.ts` (`stopAndTranscribe` + class doc; produced in Task 3)
- Modify: `apps/macos/src/wiring.ts` (pass `{ dangerouslyAllowBrowser: true }`)
- Test: `apps/macos/src/test/unit/controller.test.ts`

**Interfaces:**
- Consumes: `paste_text` command (Task 1), `clientOptions` parameter (Task 2), `ControllerDeps` (Task 3). `cleanup.process(input: string, context?: { detectedLanguage?: string })` — `PipelineContext.detectedLanguage` exists in `@verba/core`.
- Produces: final M3 dictation behavior (silent paste + toast; window only for onboarding/failure).

- [ ] **Step 1: Write the failing tests**

Append inside `suite('DictationController', …)` in `apps/macos/src/test/unit/controller.test.ts`:

```typescript
	test('happy path: cleans the transcript, pastes it, and keeps the window hidden', async () => {
		await dictate(controller);

		assert.strictEqual(deps.cleanup.process.calledOnce, true);
		assert.strictEqual(deps.cleanup.process.firstCall.args[0], 'raw transcript');
		assert.deepStrictEqual(deps.cleanup.process.firstCall.args[1], { detectedLanguage: 'en' });
		assert.strictEqual(
			(deps.invoke as unknown as sinon.SinonStub).calledWith('paste_text', { text: 'cleaned text' }),
			true
		);
		assert.strictEqual(deps.notifier.info.calledWithMatch(/pasted/i), true);
		assert.strictEqual(deps.ui.showTranscript.called, false);
		assert.strictEqual(deps.ui.setPhase.calledWith('Idle.'), true);
	});

	test('cleanup failure falls back to pasting the raw transcript with a warning', async () => {
		deps.cleanup.process.rejects(new Error('Anthropic API key required for post-processing.'));

		await dictate(controller);

		assert.strictEqual(deps.notifier.warn.calledWithMatch(/raw transcript/), true);
		assert.strictEqual(
			(deps.invoke as unknown as sinon.SinonStub).calledWith('paste_text', { text: 'raw transcript' }),
			true
		);
		assert.strictEqual(deps.notifier.error.called, false);
	});

	test('missing Accessibility permission shows onboarding + transcript window, never pastes', async () => {
		(deps.invoke as unknown as sinon.SinonStub).withArgs('has_accessibility_permission').resolves(false);

		await dictate(controller);

		assert.strictEqual(deps.ui.showAccessibilityOnboarding.calledOnce, true);
		assert.strictEqual(deps.ui.showTranscript.calledWith('cleaned text'), true);
		assert.strictEqual(
			(deps.invoke as unknown as sinon.SinonStub).calledWith('paste_text', sinon.match.any),
			false
		);
	});

	test('paste failure falls back to showing the transcript in the window', async () => {
		(deps.invoke as unknown as sinon.SinonStub).withArgs('paste_text', sinon.match.any)
			.rejects(new Error('Paste failed: could not create event source'));

		await dictate(controller);

		assert.strictEqual(deps.notifier.error.calledWithMatch(/paste failed/i), true);
		assert.strictEqual(deps.ui.showTranscript.calledWith('cleaned text'), true);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/macos && npm run test:unit`
Expected: the 4 new tests FAIL (`cleanup.process` never called; `paste_text` never invoked; transcript still shown on happy path).

- [ ] **Step 3: Implement the new flow**

In `apps/macos/src/controller.ts`, replace the `stopAndTranscribe` method with:

```typescript
	private async stopAndTranscribe(): Promise<void> {
		this.working = true;
		this.recording = false;
		try {
			const wavPath = await this.deps.invoke<string>('stop_capture');
			this.deps.ui.setPhase('Transcribing…');
			const { text: transcript, detectedLanguage } = await this.deps.deepgram.transcribe(wavPath);

			this.deps.ui.setPhase('Processing…');
			let text = transcript;
			try {
				text = await this.deps.cleanup.process(transcript, { detectedLanguage });
			} catch (err) {
				// Cleanup is refinement, not a gate: a cancelled key prompt or an
				// API failure must never cost the user their dictation.
				this.deps.notifier.warn(`Verba: cleanup skipped — using raw transcript (${errText(err)})`);
			}

			const hasAccessibility = await this.deps.invoke<boolean>('has_accessibility_permission');
			if (!hasAccessibility) {
				await this.deps.ui.showAccessibilityOnboarding(() => this.deps.invoke('open_accessibility_settings'));
				await this.deps.ui.showTranscript(text);
				return;
			}

			try {
				await this.deps.invoke('paste_text', { text });
				this.deps.notifier.info('Verba: pasted.');
				this.deps.ui.setPhase('Idle.');
			} catch (err) {
				// The window is the fallback surface: the user must never lose text.
				this.deps.notifier.error(`Verba: paste failed — ${errText(err)}`);
				await this.deps.ui.showTranscript(text);
			}
		} catch (err) {
			this.deps.notifier.error(`Verba: ${errText(err)}`);
			this.deps.ui.setPhase('Idle.');
		} finally {
			this.working = false;
		}
	}
```

In `apps/macos/src/wiring.ts`, change the cleanup construction to:

```typescript
		// dangerouslyAllowBrowser: the Anthropic SDK refuses browser-like
		// environments (Tauri's WebView) by default; Anthropic officially
		// supports direct browser access via CORS when this flag is set.
		cleanup: new TauriCleanupService(secrets, notifier, { dangerouslyAllowBrowser: true }),
```

- [ ] **Step 4: Run tests and typecheck to verify they pass**

Run: `cd apps/macos && npm run test:unit && npm run typecheck`
Expected: all controller tests pass (8 total), no typecheck errors.

- [ ] **Step 5: Commit**

```bash
git add apps/macos/src/controller.ts apps/macos/src/wiring.ts apps/macos/src/test/unit/controller.test.ts
git commit -m "✨ feat(macos): Diktat-Flow — Claude-Cleanup mit Raw-Fallback + Paste in die Frontmost-App

stopAndTranscribe() bereinigt das Transkript via CleanupService
(dangerouslyAllowBrowser im WebView, detectedLanguage als Kontext) und
pastet per paste_text. Cleanup-Fehler oder abgebrochener Key-Prompt →
rohes Transkript mit Warn-Toast. Paste-Fehler oder fehlende
Accessibility-Permission → Fenster-Fallback wie bisher; Text geht nie
verloren. Erfolgsfall: Toast, Fenster bleibt verborgen."
```

---

### Task 5: Docs, spec correction, full verification + manual QA

**Files:**
- Modify: `docs/development/phase-1-macos-app.md` (M3 milestone entry)
- Modify: `docs/superpowers/specs/2026-07-03-macos-paste-cleanup-design.md` (CSP row)

**Interfaces:** none (documentation + verification).

- [ ] **Step 1: Full automated verification**

```bash
cd apps/macos/src-tauri && cargo check && cargo clippy -- -D warnings && cargo test
cd ../../.. && cd packages/core && npm run test:unit
cd ../../apps/macos && npm run test:unit && npm run typecheck
```

Expected: everything green. Fix regressions before proceeding.

- [ ] **Step 2: Manual end-to-end verification (dev build)**

Run: `cd apps/macos && npm run tauri dev`

Walk the TF-518 acceptance criteria; note any deviation before proceeding:
1. Focus TextEdit → `Alt+Space` → dictate → `Alt+Space`: cleaned text appears in TextEdit at the cursor; Verba window stays hidden; "pasted" notification appears.
2. Same flow with Terminal focused: text appears on the prompt.
3. Copy some text first, then dictate: after the paste, `⌘V` manually pastes the *original* clipboard content again (restore works).
4. Delete the Anthropic key from Keychain (or use a fresh machine state) → dictate → cancel the key prompt: the *raw* transcript is pasted and a "cleanup skipped" warning shows.
5. Revoke Accessibility permission (System Settings → Privacy & Security → Accessibility) → dictate: onboarding message + transcript window appear; nothing is pasted.
6. Check the first cleanup call succeeds (network tab / result text differs from raw speech with filler words) — verifies `dangerouslyAllowBrowser` CORS works in the WebView. If the request is blocked by CORS, fall back per spec: pass Tauri's HTTP-plugin `fetch` in `clientOptions` (`{ dangerouslyAllowBrowser: true, fetch }` from `@tauri-apps/plugin-http`) — this is the documented contingency, record it as a deviation.

- [ ] **Step 3: Update the milestone doc**

In `docs/development/phase-1-macos-app.md`, the M3 entry currently starts with:

```
4. **M3 — Cleanup + paste.** ⏳ In progress — the onboarding-UI slice
   (Accessibility permission check + System-Settings deep-link) is done and
   manually verified end-to-end; `CleanupService` wiring and the real paste
   mechanism are still planned. `controller.ts`'s `stopAndTranscribe()` checks
   `has_accessibility_permission` after each transcription and shows an
   onboarding message (with a button to open System Settings) when ungranted,
   falling through unconditionally to the existing `showTranscript()` display
   either way.
```

Replace that opening paragraph with:

```
4. **M3 — Cleanup + paste.** ✅ Done — dictated text is cleaned up via
   `CleanupService` (Anthropic SDK in the WebView with
   `dangerouslyAllowBrowser: true`; raw-transcript fallback when the key
   prompt is cancelled or the API fails) and pasted into the frontmost app
   by the `paste_text` Rust command (clipboard save → set → synthetic ⌘V →
   restore; AX value insertion was evaluated and dropped — see
   `docs/superpowers/specs/2026-07-03-macos-paste-cleanup-design.md`). The
   window only appears for the Accessibility onboarding or when pasting
   fails; `DictationController` now takes injected dependencies
   (`wiring.ts`) and has unit tests.
```

Keep the existing sub-bullets (Rust `paste.rs`, Deepgram-SDK bug note, spike note) — update the spike sub-bullet's first sentence to past tense: `**Paste mechanism (resolved):** clipboard+⌘V shipped; AX value insertion dropped (unproven FFI, two code paths, little benefit).` Leave the rest of the historical notes intact.

- [ ] **Step 4: Correct the spec's CSP assumption**

In `docs/superpowers/specs/2026-07-03-macos-paste-cleanup-design.md`, replace the component-table row

```
| `apps/macos/src-tauri/tauri.conf.json` | CSP `connect-src` um `https://api.anthropic.com` ergänzen |
```

with

```
| `apps/macos/src-tauri/tauri.conf.json` | Keine Änderung nötig — `csp` ist `null` (Umsetzungsbefund) |
```

- [ ] **Step 5: Commit**

```bash
git add docs/development/phase-1-macos-app.md docs/superpowers/specs/2026-07-03-macos-paste-cleanup-design.md
git commit -m "📚 docs(macos): M3 als abgeschlossen markieren (Cleanup + Paste)

Milestone-Eintrag auf Done: paste_text (Clipboard+⌘V) und
CleanupService-Wiring sind implementiert und manuell verifiziert.
Spec-Korrektur: tauri.conf.json braucht keinen CSP-Eintrag (csp: null)."
```

---

## Self-Review (done while writing)

- **Spec coverage:** Entscheidungen (silent paste ✓ Task 4, Raw-Fallback ✓ Task 4, Clipboard+⌘V ✓ Task 1, dangerouslyAllowBrowser ✓ Tasks 2+4), Rust-Details ✓ Task 1, Core-Änderung ✓ Task 2, Controller-Wiring ✓ Tasks 3+4, Verifikation ✓ Task 5, M3-Doku ✓ Task 5. Abweichungen von der Spec, im Plan dokumentiert: (a) kein CSP-Edit nötig (`csp: null`), Task 5 korrigiert die Spec; (b) Tests laufen mit Mocha/tdd statt "Vitest" (Spec-Irrtum); (c) DI-Refactor als Task 3 ergänzt, weil `@tauri-apps/api` ESM-only ist und der Controller sonst untestbar bleibt.
- **Placeholder scan:** keine TBDs; jeder Code-Schritt enthält vollständigen Code; Fallback für `core-graphics`-Version explizit.
- **Typkonsistenz:** `ControllerDeps`/`ControllerUi`/`InvokeFn` (Task 3) == Nutzung in Task 4-Tests; `paste_text`-Signatur (Task 1) == `invoke('paste_text', { text })` (Task 4); `clientOptions` (Task 2) == drittes Konstruktor-Argument in `wiring.ts` (Task 4); `detectedLanguage` existiert auf `PipelineContext`.
