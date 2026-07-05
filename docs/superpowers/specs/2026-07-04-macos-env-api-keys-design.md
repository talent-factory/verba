# macOS App: API Keys from Environment Variables

**Date:** 2026-07-04
**Status:** Approved (design)
**Scope:** `apps/macos` only. `@verba/core` and the VS Code extension are unchanged.

## Problem

The macOS menu-bar app resolves the Deepgram and Anthropic API keys through
`SecretStore.get(storageKey)` (Keychain). When a key is missing, the flow reveals
the (normally hidden) window to prompt for it via `promptForApiKey()`. That window
reveal **steals keyboard focus right before the paste step**, so the synthetic ⌘V
lands in the Verba window instead of the user's frontmost app (e.g. Sublime Text) —
the dictated text never arrives.

Developers already keep provider keys in their shell environment. Reading them from
env removes the prompt entirely (no window reveal → no focus theft) and is the
idiomatic BYOK path for a dev tool.

## Goal

Resolve each API key in this order, per key:

1. **Environment variable** (`VERBA_`-prefixed name first, then the SDK-standard name)
2. **Keychain** (existing `TauriSecretStore`)
3. **GUI prompt** (existing `promptForApiKey`), only if both above are empty

Env-provided keys are **never persisted** to the Keychain — they are transient config.

### Env variable names

| Storage key (core)        | Env names tried, in order                          |
|---------------------------|----------------------------------------------------|
| `anthropic-api-key`       | `VERBA_ANTHROPIC_API_KEY`, then `ANTHROPIC_API_KEY` |
| `verba.deepgramApiKey`    | `VERBA_DEEPGRAM_API_KEY`, then `DEEPGRAM_API_KEY`   |

## Constraints & non-goals

- **Env inheritance:** the process only sees env vars when launched from a shell
  (`just macos-dev` ✅). A double-clicked `.app` bundle from Finder does **not**
  inherit shell env — Keychain/prompt remains the path there. Documented, not solved.
- No changes to `@verba/core` (keeps it platform-agnostic; the VS Code extension is
  unaffected).
- No new setting/UI for configuring env names in this iteration (YAGNI).

## Design (Approach A — env-fallback decorator at the adapter seam)

Both keys flow through `secretStorage.get(storageKey)`
(`deepgramProvider.ts:81`, `cleanupService.ts` `getApiKey()`), so the single
injection point is the `SecretStore` seam in the macOS layer.

### 1. Rust command `env_var`

New module `apps/macos/src-tauri/src/env.rs`:

```rust
/// Returns the value of the named environment variable, or `None` if unset or
/// blank. Used by the frontend to resolve API keys from the shell environment
/// before falling back to the Keychain.
#[tauri::command]
pub fn env_var(name: String) -> Option<String> {
    std::env::var(&name).ok().filter(|v| !v.trim().is_empty())
}
```

Registered in `lib.rs` `invoke_handler!` (custom commands need no capability entry,
same as `start_capture`).

### 2. `EnvAwareSecretStore` (new macOS adapter)

`apps/macos/src/adapters/envAwareSecretStore.ts` — decorates a `SecretStore`:

- Constructor deps (DI for testability, mirroring `DeepgramTauriProvider`):
  - `inner: SecretStore` — the wrapped Keychain store.
  - `readEnv: (name: string) => Promise<string | undefined>` — defaults to
    `(name) => invoke('env_var', { name })`.
- `get(storageKey)`:
  1. Look up the env-name list for `storageKey` from a small documented map
     (keys mirror the core storage-key constants; drift risk noted in a comment,
     same convention as the `UNAUTHORIZED_SENTINEL` cross-file note).
  2. Try each env name in order; the first non-empty value wins → return it
     (**env first**).
  3. If none set, or `storageKey` is unmapped, delegate to `inner.get(storageKey)`.
  4. On any `readEnv` error: swallow and fall through to `inner.get` — env-read
     failures must never break key resolution.
- `store()` / `delete()`: delegate to `inner` unchanged.

### 3. Wiring

`wiring.ts` `createDictationController()`:

```ts
const secrets = new EnvAwareSecretStore(new TauriSecretStore());
```

passed to both `DeepgramTauriProvider` and the cleanup service (unchanged otherwise).

## Data flow

```
transcribe / cleanup
   └─ secretStorage.get("verba.deepgramApiKey" | "anthropic-api-key")
        └─ EnvAwareSecretStore.get
             1. readEnv(VERBA_… ) → readEnv(SDK-standard)   ← env first
             2. inner.get (Keychain)
             3. (empty) → caller prompts via GUI  ← only now a window reveals
```

## Error handling

- `env_var` returns `None` for unset/blank → treated as "not set".
- `readEnv` rejection → caught in `EnvAwareSecretStore.get`, logged, fall through to
  Keychain. Never propagates.

## Testing

Unit tests for `EnvAwareSecretStore` (no Tauri runtime; inject `readEnv` + a fake
`inner`):

1. Env set → returns env value **without** consulting `inner` (env precedence).
2. `VERBA_`-prefixed name present → wins over the SDK-standard name.
3. Env unset → delegates to `inner.get` (Keychain fallback).
4. Unmapped storage key → delegates straight to `inner.get`.
5. `readEnv` throws → falls through to `inner.get` (no throw).
6. `store` / `delete` → delegate to `inner` verbatim.

## Side effect (intended)

With keys in env, the missing-key prompt never fires, so no window reveal occurs
before paste. This is expected to resolve the observed "paste lands in Verba, not
Sublime" symptom for the shell-launched dev flow, and lets us verify the paste path
in isolation.
```
