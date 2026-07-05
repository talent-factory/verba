# macOS App: JSON Configuration System (Sub-Project A)

**Date:** 2026-07-04
**Status:** Approved (design)
**Scope:** `apps/macos` only. `@verba/core` and the VS Code extension are unchanged.

This is **Sub-Project A** of three. B (Settings UI via tray submenu) and C (working-state
visualization) are separate specs, built after A in the order A → C → B.

## Problem

Two gaps:

1. **Transcription language bug.** `transcribe.rs` sends both `language=multi` and
   `detect_language=true` — a contradictory combination. On short German utterances with
   loan words ("Voila…"), the multilingual model drifts into another language (observed:
   German dictation transcribed as Dutch gibberish).
2. **No user configuration.** The macOS app hardcodes everything. The VS Code extension
   exposes ~14 `verba.*` settings; the macOS app has none. Users want the same
   configurability via a JSON file, following the VS Code model.

## Goal

A JSON config file at **`~/.config/verba/config.json`** (XDG), loaded at startup, driving
the settings that apply to the macOS app's *current* feature set — while defining the full,
forward-compatible schema so later features (and Sub-Projects B/C) slot in without
re-architecting.

### Settings wired in this sub-project (applicable today)

| Config key | Type | Default | Effect |
|---|---|---|---|
| `transcription.language` | string | `"multi"` | Deepgram `language` param. `"multi"` → `language=multi`; any other code (e.g. `"de"`, `"en"`) → `language=<code>`. **`detect_language` is removed in both cases** (it was the bug). |
| `glossary` | string[] | `[]` | Passed to Deepgram as `keyterm`s AND to `CleanupService.setGlossary`. |
| `expansions` | `{abbreviation,expansion}[]` | `[]` | `CleanupService.setExpansions`. |
| `language` | string | `"auto"` | Cleanup language hint. `"auto"` → use Deepgram's detected language; any other code → force that hint to Claude. |

### Schema defined but NOT wired yet (forward-compatible placeholders)

`templates`, `autoSelectTemplate`, `transcription.provider`, `transcription.localModel`,
`audioDevice`. These require macOS features that don't exist yet (template picker, local
whisper, device selection). They parse and default cleanly but change nothing.

## Constraints & non-goals

- Missing/unreadable/malformed config file → empty config → all defaults. Never a hard error.
- No config *writing* in this sub-project (that's Sub-Project B, the settings UI).
- No file watching / hot-reload — config is read once at startup. (Restart to apply. Matches
  VS Code's `history.maxEntries` "takes effect after restart" precedent.)
- `@verba/core` untouched — all wiring lives in the macOS adapter/wiring layer.

## Design

### 1. Rust command `read_config`

New module `apps/macos/src-tauri/src/config.rs`:

```rust
/// Returns the raw contents of `~/.config/verba/config.json` (honoring
/// `$XDG_CONFIG_HOME`), or `"{}"` if the file is absent or unreadable. Parsing
/// and validation happen on the frontend so this stays a dumb reader.
#[tauri::command]
pub fn read_config() -> String { … }
```

Path resolution: `$XDG_CONFIG_HOME` if set and non-empty, else `$HOME/.config`, then
`/verba/config.json`. Uses `std::env` only (no new crate). Returns `"{}"` on any error
(missing HOME, missing file, read error).

Registered in `lib.rs` `generate_handler!`.

### 2. Config types + loader (frontend)

New `apps/macos/src/config/verbaConfig.ts`:

- `interface VerbaConfig` — the full schema, every field optional (raw parsed shape).
- `interface ResolvedConfig` — every wired field present with its default applied
  (`transcription.language: string`, `language: string`, `glossary: string[]`,
  `expansions: Expansion[]`).
- `type ReadConfig = () => Promise<string>` — defaults to `invoke('read_config')`.
- `async function loadConfig(readConfig?: ReadConfig): Promise<ResolvedConfig>` — reads,
  `JSON.parse` inside try/catch (malformed → `{}`), applies defaults, coerces types
  defensively (e.g. non-array `glossary` → `[]`). Never throws.

Unit-testable via injected `readConfig` (same DI pattern as `EnvAwareSecretStore`).

### 3. Deepgram language plumbing

- `DeepgramTauriProvider` gains a constructor param `language: string = 'multi'`, included in
  the `invoke('deepgram_transcribe', { … , language })` call.
- Rust `deepgram_transcribe` gains a `language: String` param. It builds the query params as:
  - always: `model=nova-3`, `smart_format=true`
  - `("language", language)` — the value is `"multi"` or a specific code, passed through.
  - **`detect_language` is no longer sent.**
- `transcribe.rs`'s detected-language extraction (`detected_language` from the response) is
  unchanged; with `language=multi` Deepgram may omit it (then `detectedLanguage` is `None`,
  which the cleanup already tolerates).

### 4. Cleanup wiring (glossary, expansions, language hint)

`createDictationController()` becomes `async` (it now `await`s `loadConfig()`); `main.ts`
already `await`s the controller, so it awaits the factory too.

- After building the cleanup service: `cleanup.setGlossary(config.glossary)` and
  `cleanup.setExpansions(config.expansions)`.
- Deepgram keyterms: the controller calls `deepgram.transcribe(wavPath)` with no glossary.
  Wire the glossary by wrapping the provider in the deps: the `deepgram` dep's `transcribe`
  closure calls `provider.transcribe(audioPath, config.glossary)`. Controller unchanged.
- Language hint: the `cleanup` dep wraps `process` so that when `config.language !== 'auto'`
  it overrides `context.detectedLanguage` with `config.language` before delegating; when
  `'auto'`, it passes context through unchanged.

### Data flow

```
startup → loadConfig(read_config) → ResolvedConfig
  ├─ transcription.language → DeepgramTauriProvider → deepgram_transcribe(language=…)
  ├─ glossary → provider.transcribe(_, glossary) (keyterms)  +  cleanup.setGlossary
  ├─ expansions → cleanup.setExpansions
  └─ language → cleanup dep wraps process(): detectedLanguage override when ≠ "auto"
```

## Error handling

- `read_config` never fails — returns `"{}"` on any error.
- `loadConfig` never throws — malformed JSON or wrong-typed fields fall back to defaults.
- A config that sets `transcription.language` to a code Deepgram rejects surfaces as a normal
  Deepgram error through the existing transcription error path — not this layer's concern.

## Testing

Unit tests (mocha TDD + sinon, no Tauri runtime):

`loadConfig` (`apps/macos/src/test/unit/verbaConfig.test.ts`):
1. Missing file (`readConfig` resolves `"{}"`) → all defaults (`transcription.language==='multi'`, `language==='auto'`, `glossary==[]`, `expansions==[]`).
2. Malformed JSON (`readConfig` resolves `"{ not json"`) → all defaults, no throw.
3. Populated config → values parsed through (e.g. `transcription.language==='de'`, glossary/expansions arrays).
4. Wrong-typed fields (`glossary: "nope"`, `expansions: 5`) → coerced to defaults.
5. Partial config (only `transcription.language`) → that value set, everything else defaulted.

`DeepgramTauriProvider` (extend existing test file): passes the configured `language` in the
`deepgram_transcribe` invoke args; defaults to `'multi'` when not supplied.

Rust `config.rs`: a test that `read_config` returns valid JSON (`"{}"` or object) and never
panics when `HOME`/file are absent (assert it parses as JSON).

## Manual verification (after implementation)

1. No config file → dictate German → still works (default `multi`), no crash.
2. `mkdir -p ~/.config/verba && echo '{"transcription":{"language":"de"}}' > ~/.config/verba/config.json`,
   restart `just macos-dev`, dictate the earlier failing German phrase → correct German
   transcript (no Dutch drift).
3. Add a `glossary` term and an `expansion`, restart, dictate → term preserved / abbreviation expanded.
