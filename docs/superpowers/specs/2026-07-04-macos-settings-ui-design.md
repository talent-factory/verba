# macOS App: Settings UI via Tray Submenu (Sub-Project B)

**Date:** 2026-07-04
**Status:** Approved (design)
**Scope:** `apps/macos` only. `@verba/core` and the VS Code extension are unchanged.

Sub-Project B of three (order A → C → B). A (config system) and C (visualization) are done.
This adds a menu-bar settings UI on top of A's config file and applies changes live.

## Problem

A's `~/.config/verba/config.json` is only editable by hand, and only read once at startup.
Users want to change the common settings from the menu bar and have them take effect on the
next dictation without restarting.

## Goal

A tray submenu that lets the user change the menu-suitable, already-wired settings; each change
writes `config.json` and applies to the running app immediately (next dictation), with no
restart. Array/complex settings (glossary, expansions) are handled by an "open config file"
action, not menu items.

### Menu layout

```
Verba (tray)
├─ Transkriptionssprache   ▸  (check group, bound to config `transcription.language`)
│     ✓ Auto / Mehrsprachig (multi) · Deutsch (de) · English (en) · Français (fr)
│       · Español (es) · Italiano (it) · Nederlands (nl) · Português (pt)
├─ Cleanup-Sprache (Claude) ▸  (check group, bound to config `language`)
│     ✓ Automatisch (auto) · Deutsch (de) · English (en) · Français (fr)
│       · Español (es) · Italiano (it) · Nederlands (nl) · Português (pt)
├─ Provider                ▸  (check group, bound to config `transcription.provider`)
│     ✓ Deepgram (deepgram) · Lokal – whisper.cpp (local, DISABLED — not wired yet)
├─ ──────────────
├─ Konfiguration öffnen…      (opens ~/.config/verba/config.json; creates it if missing)
├─ Konfiguration neu laden    (re-reads the file, updates checks, applies live)
└─ Quit Verba
```

The checkmark reflects the current config value (read from `config.json` at menu-build time).
Settings that are not yet wired in the macOS app (`templates`, `autoSelectTemplate`,
`audioDevice`) are intentionally omitted — exposing dead menu items would mislead. `Local`
provider appears but is disabled.

## Design

### 1. Config writing (Rust, `config.rs`)

- Pure, testable `fn set_json_key(root: &mut serde_json::Value, dotted: &str, value: serde_json::Value)` — splits `dotted` on `.`, creates/descends intermediate objects, sets the leaf. E.g. `"transcription.language"` → `{ "transcription": { "language": … } }`.
- `fn write_config_key(dotted: &str, value: serde_json::Value) -> Result<(), String>` — reads the existing file (or `{}` if absent/malformed), applies `set_json_key`, writes pretty JSON back (creating `~/.config/verba/` if needed). Reuses A's `config_path()`. **Comments are lost** (JSON round-trip) — documented.
- `fn read_config_value(dotted: &str, default: &str) -> String` — reads the file and returns the string at `dotted`, or `default`. Used to set initial menu checkmarks.

### 2. Settings menu (Rust, `menu.rs`)

- A static `OPTIONS` describing the three check groups: `(dotted_key, [(value, label, enabled)])`.
- `build_settings_menu(app) -> Menu` builds the submenus + check items (checked = value equals the current config value) + the action items (`open-config`, `reload-config`, `quit`), and stores the `CheckMenuItem` handles in Tauri managed state (`MenuState`) keyed by item id so the event handler can toggle them.
- Menu item ids: `set:<dotted_key>:<value>` (e.g. `set:transcription.language:de`), plus `open-config`, `reload-config`, `quit`.
- `handle_menu_event(app, id)`:
  - `set:KEY:VALUE` → `write_config_key(KEY, json!(VALUE))`; in that group, `set_checked(true)` on the chosen item and `false` on its siblings; `emit("config:changed")`.
  - `open-config` → ensure the file exists (create with `{}` if missing), then `open` it.
  - `reload-config` → re-read the file, update all check items to match, `emit("config:changed")`.
  - `quit` → `app.exit(0)` (unchanged).
- `lib.rs` `setup` uses `build_settings_menu` instead of the current quit-only menu, and routes `on_menu_event` to `handle_menu_event`.

### 3. Live apply (frontend)

- `DeepgramTauriProvider`: `language` becomes a mutable field with `setLanguage(language: string): void`.
- `wiring.ts`: hold a mutable `configState = { current: ResolvedConfig }`. The `deepgram` dep reads `configState.current.glossary`; the `cleanup` dep reads `configState.current.language`; the provider starts at `configState.current.transcriptionLanguage`.
- A pure, testable `applyConfig(config, targets)` (in `config/verbaConfig.ts` or `visualization`-style module) sets `targets.setLanguage(config.transcriptionLanguage)`, `targets.setGlossary(config.glossary)`, `targets.setExpansions(config.expansions)`.
- `reloadConfig()` = `configState.current = await loadConfig(); applyConfig(configState.current, { setLanguage: provider.setLanguage, setGlossary: cleanup.setGlossary, setExpansions: cleanup.setExpansions })`.
- `createDictationController()` returns `{ controller, reloadConfig }` (was: `controller`).
- `main.ts`: destructure `{ controller, reloadConfig }`, and `listen('config:changed', () => void reloadConfig())` (import `listen` from `@tauri-apps/api/event`; the main window already has `core:event:default`).

### Data flow

```
user clicks menu item  → Rust handle_menu_event
   ├─ write_config_key(dotted, value)      (config.json updated)
   ├─ toggle CheckMenuItem group           (checkmark moves)
   └─ emit "config:changed"
        └─ main.ts listener → reloadConfig() → loadConfig() → applyConfig(...)
             → provider.setLanguage / cleanup.setGlossary / setExpansions
                → next dictation uses the new settings (no restart)
```

## Error handling

- `write_config_key` returns `Err(String)` on IO failure; the menu handler logs it (eprintln) and still updates the check + emits — best-effort (a failed write is surfaced in logs, not a crash).
- Malformed existing file → treated as `{}` (same as A's read path), so a bad file is overwritten with a valid one on the next menu change. Documented.
- `reloadConfig` is best-effort: any failure is caught/logged, never breaks the flow.

## Testing

- Rust (`config.rs` tests): `set_json_key` — sets a nested new key, overwrites an existing leaf, creates intermediate objects, sets a top-level key. Round-trip via `serde_json` (pure, no file/env).
- Frontend:
  - `DeepgramTauriProvider`: after `setLanguage('de')`, the next `transcribe` invoke carries `language: 'de'`.
  - `applyConfig`: calls `setLanguage`/`setGlossary`/`setExpansions` with the resolved config's values (fakes; pure).
- Menu building, event handling, managed state, and the `open`/`config:changed` glue are Tauri runtime-bound → manual verification.

## Manual verification

1. Menu shows the three submenus with the correct current values checked.
2. Pick a different transcription language → checkmark moves, `config.json` updates, and the
   **next** dictation transcribes in that language — no restart.
3. Change the cleanup language → next dictation's Claude cleanup respects it.
4. "Konfiguration öffnen" opens the file (creating it if absent); after hand-editing glossary
   + "Konfiguration neu laden", the next dictation reflects the edited glossary.
5. `Local` provider item is visibly disabled.

## Non-goals

- No settings for the not-yet-wired features (templates, audio device, local whisper).
- No in-menu editing of arrays (glossary/expansions) — handled via the config file.
- No config file watching — reload is triggered by menu changes / the explicit reload action.
