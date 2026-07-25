# HUD-Spiegel für handlungsrelevante Meldungen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die drei handlungsrelevanten macOS-Meldungen (Secure-Input, leeres Diktat, Zustellungsfehler) zusätzlich kurz in der HUD-Pille spiegeln, damit sie auch dann sichtbar sind, wenn der native Notification-Kanal versagt (Dev-Binary, deaktivierte Berechtigung, maskierte Vorschau).

**Architecture:** Ansatz A — Lebenszyklus in TypeScript, Rust-HUD bleibt zustandslos. Der Controller merkt die Meldung in `pendingHudMessage` vor; der `finally`-Block spielt sie aus (Tray idle + HUD-Meldung) und plant das Ausblenden nach `HUD_MESSAGE_MS` über den bereits injizierten `schedule`-Seam. Ein neues Aufnahme-`setState` bricht einen laufenden Meldungs-Timer ab (Supersession).

**Tech Stack:** TypeScript (macOS-Frontend + `@verba/core`), Rust (Tauri v2 HUD-Command). Tests: mocha + sinon + `assert` (TS), `cargo test` (Rust), mocha (core).

## Global Constraints

- **Plattform:** nur macOS (`apps/macos`).
- **HUD-Invariante:** Das HUD-Fenster bleibt non-focused/click-through — niemals `set_focus`, `set_ignore_cursor_events(true)`, `set_always_on_top(true)` beibehalten (ein fokussiertes HUD stiehlt den Fokus, der Paste-⌘V landet in Verba statt im Zielfenster).
- **Spiegelung, kein Ersatz:** Die bestehenden `notifier.warn/error`-Aufrufe bleiben an allen drei Stellen erhalten; die HUD-Meldung kommt zusätzlich.
- **Copy (verbatim, deutsch):** Secure-Input → `⌘V zum Einfügen` (warn, Icon ⚠); leeres Diktat → `Keine Sprache erkannt` (error, Icon 🔇); Zustellungsfehler → `Zustellung fehlgeschlagen` (error, Icon ⚠).
- **Accent per Severity:** `warn` → `#f5a623`, `error` → `#e5484d`. (Icon ist **per Meldung**, nicht per Severity — korrigiert die Spec-Skizze `messagePresentationFor(severity)→{icon,accent}`.)
- **Dauer:** `HUD_MESSAGE_MS = 5000`.
- **Core-Rebuild:** Nach Änderung an `packages/core/src/**` `npm run compile:core` ausführen — sonst sehen die Hosts den neuen Export nicht aus `dist/` (macOS-TS-Tests importieren `@verba/core` aus `dist/`).
- **Commits:** Über `/git-workflow:commit` (Projektvorgabe — keine manuellen `git commit`), emoji-conventional, deutsch, **kein** Co-Authored-By/Generated-Suffix.

## File Structure

| Datei | Verantwortung | Aktion |
|-------|---------------|--------|
| `packages/core/src/transcription.ts` | typisierter `NoSpeechError`; `validateTranscript` wirft ihn | Modify |
| `packages/core/src/test/unit/transcription.test.ts` | Contract-Tests für `validateTranscript`/`NoSpeechError` | Modify |
| `apps/macos/src-tauri/src/hud.rs` | zustandsloser `set_hud_message`-Command | Modify |
| `apps/macos/src-tauri/src/lib.rs` | Command-Registrierung im `invoke_handler` | Modify |
| `apps/macos/src/visualization/messagePresentation.ts` | `Severity`, `HudMessage`, `HUD_MESSAGES`, `accentForSeverity` (einzige Copy-Quelle) | Create |
| `apps/macos/src/test/unit/messagePresentation.test.ts` | Tests der Copy-/Accent-Map | Create |
| `apps/macos/src/visualization/visualization.ts` | `showMessage(message)` neben `setState` | Modify |
| `apps/macos/src/test/unit/visualization.test.ts` | Tests für `showMessage` | Modify |
| `apps/macos/src/controller.ts` | `ControllerUi.showMessage`; `pendingHudMessage`/`hudMessageTimer`; `surfaceHudMessage`; `setState`-Supersession; 3 Branches; `HUD_MESSAGE_MS` | Modify |
| `apps/macos/src/test/unit/controller.test.ts` | `createDeps`-Fixture + neue Verhaltens-Tests | Modify |
| `apps/macos/src/wiring.ts` | `showMessage: visualization.showMessage` ins `ui`-Objekt | Modify |

---

### Task 1: Core — typisierter `NoSpeechError`

**Files:**
- Modify: `packages/core/src/transcription.ts` (`validateTranscript`, ~Zeile 31-51)
- Test: `packages/core/src/test/unit/transcription.test.ts`

**Interfaces:**
- Produces: `export class NoSpeechError extends Error` (aus `@verba/core`, via `export * from './transcription'`). `validateTranscript(rawText: string): string` wirft `NoSpeechError` (statt `Error`) bei leer/whitespace/silence.

- [ ] **Step 1: Failing test schreiben** — in `transcription.test.ts` den bestehenden `suite('validateTranscript', …)` ergänzen (Import oben um `NoSpeechError` erweitern):

```typescript
import * as assert from 'assert';
import { validateTranscript, NoSpeechError } from '../../transcription';
```

```typescript
	test('throws a NoSpeechError (not a plain Error) on empty input', () => {
		assert.throws(() => validateTranscript(''), NoSpeechError);
	});

	test('throws a NoSpeechError on whitespace-only input', () => {
		assert.throws(() => validateTranscript('   \n\t '), NoSpeechError);
	});

	test('throws a NoSpeechError on a silence-only (dots/ellipsis) transcript', () => {
		assert.throws(() => validateTranscript('… . ..'), NoSpeechError);
	});

	test('NoSpeechError is an instanceof Error (host catch stays compatible)', () => {
		try {
			validateTranscript('');
			assert.fail('expected throw');
		} catch (err) {
			assert.ok(err instanceof Error, 'is an Error');
			assert.ok(err instanceof NoSpeechError, 'is a NoSpeechError');
		}
	});
```

- [ ] **Step 2: Test laufen lassen (muss fehlschlagen)**

Run: `cd packages/core && npm run test:unit`
Expected: FAIL — `NoSpeechError` ist kein Export / Import wirft.

- [ ] **Step 3: Minimale Implementierung** — in `transcription.ts` oberhalb von `validateTranscript` die Klasse einfügen und beide `throw new Error(...)` durch `throw new NoSpeechError(...)` ersetzen:

```typescript
/**
 * Thrown by {@link validateTranscript} when a recording contains no usable
 * speech (empty, whitespace-only, or silence/dots only). A typed error so
 * callers can distinguish "no speech" from other transcription failures via
 * `instanceof` — the same pattern the macOS host uses for CleanupTimeoutError
 * and StopCaptureTimeoutError. Extends Error, so existing `catch (err)`
 * handlers that treat it as an Error stay compatible.
 */
export class NoSpeechError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NoSpeechError';
	}
}
```

Dann in `validateTranscript`:

```typescript
export function validateTranscript(rawText: string): string {
	if (!rawText || rawText.trim() === '') {
		throw new NoSpeechError('No speech detected in recording.');
	}

	// Whisper/Deepgram may return dots/ellipsis when it receives audio without speech
	if (/^[\s.…]+$/.test(rawText)) {
		throw new NoSpeechError(
			'No speech detected in recording (only silence). '
			+ 'Check that the correct microphone is selected — configure "verba.audioDevice" in Settings.'
		);
	}

	return rawText;
}
```

- [ ] **Step 4: Tests laufen lassen (müssen bestehen)**

Run: `cd packages/core && npm run test:unit`
Expected: PASS — inkl. der bestehenden `/No speech detected/`- und `/only silence/`-Regex-Tests (Messages unverändert).

- [ ] **Step 5: Core nach `dist/` kompilieren** (damit die Hosts den neuen Export sehen)

Run: `npm run compile:core` (im Repo-Root)
Expected: sauberer Build, keine tsc-Fehler.

- [ ] **Step 6: Commit** — über `/git-workflow:commit`, Message:
`✨ feat(core): NoSpeechError als typisierter Fehler in validateTranscript`

---

### Task 2: Rust — zustandsloser `set_hud_message`-Command

**Files:**
- Modify: `apps/macos/src-tauri/src/hud.rs`
- Modify: `apps/macos/src-tauri/src/lib.rs` (`invoke_handler`, ~Zeile 56-75)

**Interfaces:**
- Produces: Tauri-Command `set_hud_message(app, label: String, icon: String, accent: String) -> Result<(), String>`. Zeigt die Pille non-focused/click-through mit dem `HudPayload` (derselbe `hud:state`-Event, derselbe Renderer in `hud.ts`). No-op ohne `hud`-Fenster.

> **Hinweis:** Wie `set_hud_state` benötigt der Command einen `AppHandle` und ist damit nicht als reiner Rust-Unit-Test abbildbar (es gibt auch für `set_hud_state` keinen). Verifikation daher über `cargo test` (kompiliert + bestehende Tests grün) statt eines neuen Rust-Tests.

- [ ] **Step 1: Command implementieren** — in `hud.rs` nach `set_hud_state` einfügen:

```rust
/// Shows the HUD pill with an ad-hoc message, decoupled from the flow's
/// `DictationState`. Used by the controller to mirror actionable notifications
/// (secure-input, no-speech, delivery failure) onto the always-reliable HUD.
/// Reuses the same `hud:state` event + renderer; positions bottom-center and
/// shows WITHOUT focus (same non-activating guarantee as `set_hud_state`).
/// No-op when the `hud` window doesn't exist. Best-effort.
#[tauri::command]
pub fn set_hud_message(
    app: AppHandle,
    label: String,
    icon: String,
    accent: String,
) -> Result<(), String> {
    let Some(win) = app.get_webview_window("hud") else {
        return Ok(());
    };
    if let Err(e) = app.emit_to("hud", "hud:state", HudPayload { label, icon, accent }) {
        eprintln!("[Verba] hud:message emit failed: {e}");
    }
    position_bottom_center(&win);
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.set_always_on_top(true);
    let _ = win.show(); // deliberately NOT set_focus — must not steal focus
    Ok(())
}
```

- [ ] **Step 2: Command registrieren** — in `lib.rs` im `tauri::generate_handler![…]`-Block direkt nach `hud::set_hud_state,` ergänzen:

```rust
            hud::set_hud_state,
            hud::set_hud_message,
```

- [ ] **Step 3: Bauen + Tests**

Run: `cd apps/macos/src-tauri && cargo test`
Expected: kompiliert sauber; alle bestehenden 69 Rust-Tests grün.

- [ ] **Step 4: Commit** — über `/git-workflow:commit`, Message:
`✨ feat(macos): set_hud_message — zustandsloser HUD-Command für Meldungen`

---

### Task 3: Frontend — Copy-/Severity-Map (`messagePresentation.ts`)

**Files:**
- Create: `apps/macos/src/visualization/messagePresentation.ts`
- Test: `apps/macos/src/test/unit/messagePresentation.test.ts`

**Interfaces:**
- Produces:
  - `export type Severity = 'warn' | 'error'`
  - `export interface HudMessage { label: string; severity: Severity; icon: string }`
  - `export const HUD_MESSAGES: { secureInput: HudMessage; noSpeech: HudMessage; deliveryFailed: HudMessage }`
  - `export function accentForSeverity(severity: Severity): string`

- [ ] **Step 1: Failing test schreiben** — `messagePresentation.test.ts`:

```typescript
import * as assert from 'assert';
import { HUD_MESSAGES, accentForSeverity } from '../../visualization/messagePresentation';

suite('messagePresentation', () => {
	test('accentForSeverity maps warn to amber and error to red', () => {
		assert.strictEqual(accentForSeverity('warn'), '#f5a623');
		assert.strictEqual(accentForSeverity('error'), '#e5484d');
	});

	test('HUD_MESSAGES carries the approved copy, severity and per-message icon', () => {
		assert.deepStrictEqual(HUD_MESSAGES.secureInput, { label: '⌘V zum Einfügen', severity: 'warn', icon: '⚠' });
		assert.deepStrictEqual(HUD_MESSAGES.noSpeech, { label: 'Keine Sprache erkannt', severity: 'error', icon: '🔇' });
		assert.deepStrictEqual(HUD_MESSAGES.deliveryFailed, { label: 'Zustellung fehlgeschlagen', severity: 'error', icon: '⚠' });
	});
});
```

- [ ] **Step 2: Test laufen lassen (muss fehlschlagen)**

Run: `cd apps/macos && npm run test:unit`
Expected: FAIL — Modul `messagePresentation` existiert nicht.

- [ ] **Step 3: Modul implementieren** — `messagePresentation.ts`:

```typescript
/** Severity of an actionable HUD message. Drives the accent color. */
export type Severity = 'warn' | 'error';

/** A short, actionable message mirrored onto the HUD pill. */
export interface HudMessage {
	label: string;
	severity: Severity;
	icon: string;
}

/**
 * The three actionable messages mirrored to the HUD — the single source of this
 * German copy. Icon is per-message (not per-severity): no-speech uses 🔇 while
 * the other error, delivery-failure, uses ⚠.
 */
export const HUD_MESSAGES = {
	secureInput: { label: '⌘V zum Einfügen', severity: 'warn', icon: '⚠' },
	noSpeech: { label: 'Keine Sprache erkannt', severity: 'error', icon: '🔇' },
	deliveryFailed: { label: 'Zustellung fehlgeschlagen', severity: 'error', icon: '⚠' },
} as const satisfies Record<string, HudMessage>;

/** Accent color for a severity: warn = amber, error = red. */
export function accentForSeverity(severity: Severity): string {
	return severity === 'warn' ? '#f5a623' : '#e5484d';
}
```

- [ ] **Step 4: Tests laufen lassen (müssen bestehen)**

Run: `cd apps/macos && npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit** — über `/git-workflow:commit`, Message:
`✨ feat(macos): HUD_MESSAGES — zentrale Copy-/Severity-Map für HUD-Meldungen`

---

### Task 4: Frontend — `visualization.showMessage`

**Files:**
- Modify: `apps/macos/src/visualization/visualization.ts`
- Test: `apps/macos/src/test/unit/visualization.test.ts`

**Interfaces:**
- Consumes: `HUD_MESSAGES`, `accentForSeverity`, `HudMessage` (Task 3); `presentationFor` (bestehend); Rust-Command `set_hud_message` (Task 2).
- Produces: `createVisualization(invoke).showMessage(message: HudMessage): void` — setzt Tray auf idle (`set_tray_state`) **und** zeigt die HUD-Meldung (`set_hud_message` mit `label`, `icon`, `accent = accentForSeverity(message.severity)`). Best-effort (Fehler geloggt/geschluckt).

- [ ] **Step 1: Failing test schreiben** — in `visualization.test.ts` neuen Test im bestehenden `suite('createVisualization', …)` ergänzen (Import oben um `HUD_MESSAGES` erweitern):

```typescript
import { HUD_MESSAGES } from '../../visualization/messagePresentation';
```

```typescript
	test('showMessage sets the tray to idle and pushes the HUD message with mapped accent', () => {
		const invoke = sinon.stub().resolves(undefined);
		createVisualization(invoke).showMessage(HUD_MESSAGES.secureInput);

		const tray = invoke.getCalls().find((c) => c.args[0] === 'set_tray_state');
		const msg = invoke.getCalls().find((c) => c.args[0] === 'set_hud_message');
		assert.ok(tray, 'set_tray_state called');
		assert.strictEqual(tray!.args[1].state, 'idle');
		assert.ok(msg, 'set_hud_message called');
		assert.deepStrictEqual(msg!.args[1], { label: '⌘V zum Einfügen', icon: '⚠', accent: '#f5a623' });
	});

	test('showMessage maps an error-severity message to the red accent', () => {
		const invoke = sinon.stub().resolves(undefined);
		createVisualization(invoke).showMessage(HUD_MESSAGES.noSpeech);
		const msg = invoke.getCalls().find((c) => c.args[0] === 'set_hud_message');
		assert.deepStrictEqual(msg!.args[1], { label: 'Keine Sprache erkannt', icon: '🔇', accent: '#e5484d' });
	});
```

- [ ] **Step 2: Test laufen lassen (muss fehlschlagen)**

Run: `cd apps/macos && npm run test:unit`
Expected: FAIL — `showMessage` ist keine Funktion.

- [ ] **Step 3: `showMessage` implementieren** — `visualization.ts` anpassen:

```typescript
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { presentationFor, type DictationState } from './statePresentation';
import { accentForSeverity, type HudMessage } from './messagePresentation';

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export function createVisualization(
	invoke: Invoke = tauriInvoke,
): { setState(state: DictationState): void; showMessage(message: HudMessage): void } {
	return {
		setState(state: DictationState): void {
			const p = presentationFor(state);
			void invoke('set_tray_state', { state, tooltip: p.trayTooltip, title: p.trayTitle })
				.catch((err) => console.warn('[Verba] set_tray_state failed:', err));
			void invoke('set_hud_state', { state, label: p.hudLabel, icon: p.hudIcon, accent: p.hudAccent })
				.catch((err) => console.warn('[Verba] set_hud_state failed:', err));
		},
		showMessage(message: HudMessage): void {
			// The flow is done → tray returns to idle, while the HUD shows the
			// actionable message for its own lifetime (owned by the controller).
			const idle = presentationFor('idle');
			void invoke('set_tray_state', { state: 'idle', tooltip: idle.trayTooltip, title: idle.trayTitle })
				.catch((err) => console.warn('[Verba] set_tray_state failed:', err));
			void invoke('set_hud_message', {
				label: message.label,
				icon: message.icon,
				accent: accentForSeverity(message.severity),
			}).catch((err) => console.warn('[Verba] set_hud_message failed:', err));
		},
	};
}
```

- [ ] **Step 4: Tests laufen lassen (müssen bestehen)**

Run: `cd apps/macos && npm run test:unit`
Expected: PASS (inkl. der bestehenden `setState`-Tests).

- [ ] **Step 5: Commit** — über `/git-workflow:commit`, Message:
`✨ feat(macos): visualization.showMessage — HUD-Meldung + Tray-Idle`

---

### Task 5: Controller — Meldungs-Lebenszyklus + 3 Branches + Wiring

**Files:**
- Modify: `apps/macos/src/controller.ts` (`ControllerUi` ~Zeile 8-11; `private setState` ~110-113; `stopAndTranscribe` ~198-268; neues Feld + `surfaceHudMessage`; Modul-Konstante)
- Modify: `apps/macos/src/test/unit/controller.test.ts` (`createDeps`-Fixture + neue Tests)
- Modify: `apps/macos/src/wiring.ts` (`ui`-Objekt)

**Interfaces:**
- Consumes: `HUD_MESSAGES`, `HudMessage` (Task 3); `NoSpeechError` (Task 1, aus `@verba/core`); `visualization.showMessage` (Task 4); `this.schedule` (bestehend, `(fn, ms) => () => void`).
- Produces: `ControllerUi.showMessage(message: HudMessage): void`. Verhalten: die drei Branches spiegeln zusätzlich zur Notification auf das HUD; die Meldung bleibt `HUD_MESSAGE_MS` sichtbar; das `finally`-Idle verdeckt sie nicht; eine neue Aufnahme bricht den Timer ab.

- [ ] **Step 1: `createDeps`-Fixture erweitern** — in `controller.test.ts` das `ui`-Objekt in `createDeps()` um `showMessage` ergänzen:

```typescript
		ui: {
			setPhase: sinon.stub(),
			showTranscript: sinon.stub().resolves(),
			showAccessibilityOnboarding: sinon.stub().resolves(),
			setState: sinon.stub(),
			showMessage: sinon.stub(),
		},
```

- [ ] **Step 2: Failing tests schreiben** — neue Tests in `controller.test.ts` (Imports oben um `HUD_MESSAGES` und `NoSpeechError` erweitern):

```typescript
import { HUD_MESSAGES } from '../../visualization/messagePresentation';
import { NoSpeechError } from '@verba/core';
```

```typescript
	test('secure-input delivery mirrors the ⌘V message onto the HUD (in addition to the notification)', async () => {
		let fire: (() => void) | null = null;
		const deps = createDeps();
		deps.delivery.paste = sinon.stub().resolves('secure-input');
		const controller = new DictationController({
			...deps,
			schedule: (fn: () => void) => { fire = fn; return () => {}; },
		} as unknown as ControllerDeps);

		await dictate(controller);

		assert.ok(deps.ui.showMessage.calledOnceWithExactly(HUD_MESSAGES.secureInput), 'HUD shows the ⌘V message');
		assert.ok(deps.notifier.warn.called, 'the notification still fires (mirror, not replacement)');
		// finally did NOT stomp the message with an immediate idle:
		assert.ok(!deps.ui.setState.getCalls().some((c) => c.args[0] === 'idle'), 'no immediate idle while message pending');
		// after HUD_MESSAGE_MS elapses, the HUD hides:
		assert.ok(fire, 'a hide timer was scheduled');
		fire!();
		assert.ok(deps.ui.setState.calledWith('idle'), 'HUD hides after the message timeout');
	});

	test('empty dictation (NoSpeechError) mirrors "Keine Sprache erkannt" onto the HUD', async () => {
		const deps = createDeps();
		deps.deepgram.transcribe = sinon.stub().rejects(new NoSpeechError('No speech detected in recording.'));
		const controller = new DictationController({
			...deps,
			schedule: (fn: () => void) => { void fn; return () => {}; },
		} as unknown as ControllerDeps);

		await dictate(controller);

		assert.ok(deps.ui.showMessage.calledOnceWithExactly(HUD_MESSAGES.noSpeech), 'HUD shows the no-speech message');
		assert.ok(deps.notifier.error.called, 'the error notification still fires');
	});

	test('a non-NoSpeech error (e.g. transcription failure) does NOT surface a HUD message', async () => {
		const deps = createDeps();
		deps.deepgram.transcribe = sinon.stub().rejects(new Error('Transcription failed: 401'));
		const controller = new DictationController(deps as unknown as ControllerDeps);

		await dictate(controller);

		assert.ok(deps.ui.showMessage.notCalled, 'no HUD message for a generic error');
		assert.ok(deps.notifier.error.called, 'but the error notification fires');
	});

	test('delivery failure mirrors "Zustellung fehlgeschlagen" onto the HUD', async () => {
		const deps = createDeps();
		deps.delivery.paste = sinon.stub().rejects(new Error('paste boom'));
		const controller = new DictationController({
			...deps,
			schedule: (fn: () => void) => { void fn; return () => {}; },
		} as unknown as ControllerDeps);

		await dictate(controller);

		assert.ok(deps.ui.showMessage.calledOnceWithExactly(HUD_MESSAGES.deliveryFailed), 'HUD shows the delivery-failed message');
		assert.ok(deps.notifier.error.called, 'the error notification still fires');
	});

	test('a normal paste surfaces NO HUD message and idles immediately', async () => {
		const deps = createDeps(); // default: paste resolves 'pasted'
		const controller = new DictationController(deps as unknown as ControllerDeps);

		await dictate(controller);

		assert.ok(deps.ui.showMessage.notCalled, 'no HUD message on the happy path');
		assert.ok(deps.ui.setState.calledWith('idle'), 'idles immediately');
	});

	test('a new recording during the message window cancels the pending hide timer (supersession)', async () => {
		let cancelled = false;
		const deps = createDeps();
		deps.delivery.paste = sinon.stub().resolves('secure-input');
		const controller = new DictationController({
			...deps,
			schedule: (fn: () => void) => { void fn; return () => { cancelled = true; }; },
		} as unknown as ControllerDeps);

		await dictate(controller); // shows message, arms hide timer
		await controller.handleHotkey(); // new recording → setState('recording') must cancel the timer

		assert.strictEqual(cancelled, true, 'the pending HUD message hide timer was cancelled');
		assert.ok(deps.ui.setState.calledWith('recording'), 'the new recording took over the pill');
	});
```

- [ ] **Step 3: Tests laufen lassen (müssen fehlschlagen)**

Run: `cd apps/macos && npm run test:unit`
Expected: FAIL — `ui.showMessage` wird nie gerufen / Typfehler `showMessage` fehlt auf `ControllerUi`.

- [ ] **Step 4: `ControllerUi` + Konstante + Feld + Imports** — in `controller.ts`:

Imports oben ergänzen:

```typescript
import { NoSpeechError } from '@verba/core';
import { HUD_MESSAGES, type HudMessage } from './visualization/messagePresentation';
```

`ControllerUi` um `showMessage` erweitern:

```typescript
export interface ControllerUi {
	setPhase(text: string): void;
	setState(state: DictationState): void;
	showMessage(message: HudMessage): void;
	showTranscript(text: string): Promise<void>;
	showAccessibilityOnboarding(openSettings: () => Promise<unknown>): Promise<void>;
}
```

Modul-Konstante (bei den anderen Top-Level-Konstanten):

```typescript
/** How long an actionable HUD message stays before auto-hiding. */
const HUD_MESSAGE_MS = 5000;
```

Neues privates Feld (bei den anderen Flow-Feldern):

```typescript
	private pendingHudMessage: HudMessage | null = null;
	private hudMessageTimer: (() => void) | null = null;
```

- [ ] **Step 5: `setState`-Supersession + `surfaceHudMessage`** — `private setState` erweitern und die neue Methode ergänzen:

```typescript
	/** Updates the flow state and mirrors it to the visualization surfaces. */
	private setState(state: DictationState): void {
		// A new non-idle state (e.g. a fresh recording) takes over the pill, so a
		// still-pending HUD-message hide timer must be cancelled — otherwise it
		// would fire mid-flow and hide the HUD.
		if (state !== 'idle' && this.hudMessageTimer) {
			this.hudMessageTimer();
			this.hudMessageTimer = null;
		}
		this.state = state;
		this.deps.ui.setState(state);
	}

	/**
	 * Shows an actionable message on the HUD for HUD_MESSAGE_MS, then hides it.
	 * Tray goes idle immediately (the flow is done); the logical state is idle so
	 * a new hotkey press is accepted. Called from `finally` instead of the plain
	 * idle so the message isn't stomped by the flow's end-of-run idle.
	 */
	private surfaceHudMessage(message: HudMessage): void {
		this.state = 'idle';
		this.deps.ui.showMessage(message);
		this.hudMessageTimer?.();
		this.hudMessageTimer = this.schedule(() => {
			this.hudMessageTimer = null;
			this.deps.ui.setState('idle');
		}, HUD_MESSAGE_MS);
	}
```

- [ ] **Step 6: Die 3 Branches + `finally` verdrahten** — in `stopAndTranscribe`:

Secure-Input-Branch (im `try` um `deliver`):

```typescript
				const outcome = await deliver(text, this.intent, this.deps.delivery);
				if (outcome === 'secure-input') {
					this.deps.notifier.warn('Verba: Terminal blocked the paste (Secure Input) — transcript left on the clipboard, press ⌘V to insert.');
					this.pendingHudMessage = HUD_MESSAGES.secureInput;
				} else {
					this.deps.notifier.info(this.intent === 'submit' ? 'Verba: sent.' : 'Verba: pasted.');
				}
				this.deps.ui.setPhase('Idle.');
```

Delivery-Failure-`catch` (der innere `catch` um `deliver`):

```typescript
			} catch (err) {
				// The window is the fallback surface: the user must never lose text.
				this.deps.notifier.error(`Verba: delivery failed — ${errText(err)}`);
				this.pendingHudMessage = HUD_MESSAGES.deliveryFailed;
				await this.deps.ui.showTranscript(text);
			}
```

Äußerer `catch` — nur der No-Speech-Fall spiegelt:

```typescript
		} catch (err) {
			if (err instanceof StopCaptureTimeoutError) {
				this.deps.notifier.error(
					`Verba: recording could not be finalized (stop timed out after ${this.stopCaptureTimeoutMs}ms) — the audio device may be stuck; retry, and restart Verba if it persists.`
				);
			} else {
				if (err instanceof NoSpeechError) {
					this.pendingHudMessage = HUD_MESSAGES.noSpeech;
				}
				this.deps.notifier.error(`Verba: ${errText(err)}`);
			}
			this.deps.ui.setPhase('Idle.');
		} finally {
			if (this.pendingHudMessage) {
				const message = this.pendingHudMessage;
				this.pendingHudMessage = null;
				this.surfaceHudMessage(message);
			} else {
				this.setState('idle');
			}
		}
```

- [ ] **Step 7: `wiring.ts` — `showMessage` ins `ui`-Objekt** — den `ui`-Block im `DictationController`-Konstruktoraufruf erweitern:

```typescript
		ui: { setPhase, showTranscript, showAccessibilityOnboarding, setState: visualization.setState, showMessage: visualization.showMessage },
```

- [ ] **Step 8: Tests laufen lassen (müssen bestehen)**

Run: `cd apps/macos && npm run test:unit`
Expected: PASS — alle neuen Tests grün, die bestehenden 94 weiterhin grün.

- [ ] **Step 9: Typecheck** (der `wiring.ts`-Aufruf muss die erweiterte `ControllerUi` erfüllen)

Run: `cd apps/macos && npx tsc --noEmit`
Expected: keine Typfehler.

- [ ] **Step 10: Commit** — über `/git-workflow:commit`, Message:
`✨ feat(macos): HUD spiegelt Secure-Input/leeres-Diktat/Zustellungsfehler`

---

### Task 6: Integration — voller Build + manueller Smoke-Test

**Files:** keine (Verifikation).

- [ ] **Step 1: Alle Suites grün**

Run (Repo-Root): `npm run compile:core` · `cd packages/core && npm run test:unit` · `cd apps/macos && npm run test:unit` · `cd apps/macos/src-tauri && cargo test`
Expected: alle grün (core 173+, macOS 94+neue, Rust 69).

- [ ] **Step 2: Gebundeltes App-Bundle bauen** (Notifications + HUD real)

Run: `just macos-build` → gebaute `Verba.app` starten.

- [ ] **Step 3: Manueller Smoke** (mit aktivierten Mitteilungen + „Vorschau zeigen: Immer")
  - **Leeres Diktat:** rechts-Cmd halten → schweigen → loslassen → HUD zeigt kurz `🔇 Keine Sprache erkannt` (~5 s), dann verschwindet die Pille. Notification-Banner `Verba: No speech detected in recording.` erscheint zusätzlich.
  - **Secure-Input:** iTerm2 mit „Secure Keyboard Entry" AN → Diktat → HUD zeigt `⚠ ⌘V zum Einfügen`; Transkript bleibt auf der Zwischenablage.
  - **Dev-Modus-Gegenprobe:** `just macos-dev` (kein Banner-Kanal) → leeres Diktat → HUD zeigt trotzdem `Keine Sprache erkannt`. **Das ist der Kern-Beleg des Fixes.**
  - **Supersession:** während die Meldung sichtbar ist, sofort neue Aufnahme starten → Pille wechselt sauf `🎙 Aufnahme …`, kein vorzeitiges Verstecken/Flackern.

- [ ] **Step 4: UAT-Doc — #8 re-verifizieren** — nach erfolgreichem Smoke Fall #8 im UAT-Protokoll auf ✅ setzen (separater Commit), Notiz „HUD-Spiegel + Banner im Bundle verifiziert".

---

## Self-Review (durchgeführt)

**Spec-Coverage:** Alle drei Meldungen (Secure-Input/leeres-Diktat/Zustellungsfehler) → Task 5. `NoSpeechError` → Task 1. Rust `set_hud_message` → Task 2. `showMessage` + Copy-Map → Task 3/4. Supersession + `finally`-Nicht-Stomp + 5-s-Timer → Task 5-Tests. Notification-Spiegelung (kein Ersatz) → in jedem Branch geprüft. Core-Rebuild → Task 1 Step 5 + Task 6.

**Placeholder-Scan:** Keine TBD/TODO; jeder Code-Step enthält vollständigen Code; jeder Run-Step ein konkretes Kommando + erwartetes Ergebnis.

**Typ-Konsistenz:** `HudMessage`/`Severity`/`HUD_MESSAGES`/`accentForSeverity` in Task 3 definiert, in Task 4/5 identisch konsumiert. `ControllerUi.showMessage(message: HudMessage)` konsistent zwischen Controller-Interface, Test-Fixture und `wiring.ts`. `set_hud_message(label, icon, accent)` identisch zwischen Rust (Task 2), `visualization.showMessage` (Task 4) und Registrierung (Task 2 lib.rs).

**Spec-Korrektur:** Die Spec-Skizze `messagePresentationFor(severity)→{icon,accent}` widersprach der Copy-Tabelle (empty=🔇 vs delivery=⚠ bei gleicher Severity `error`). Aufgelöst: Icon **per Meldung** (`HUD_MESSAGES`), Accent **per Severity** (`accentForSeverity`). Die freigegebene Copy-Tabelle ist verbindlich und wird exakt umgesetzt.
