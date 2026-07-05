# Bring Your Own Key & Privacy

Verba has no subscription, no account, and no server of its own that your voice or text passes through. You supply the API keys for the services that do the actual work, Verba orchestrates the calls, and everything else — recordings, transcripts, glossary, history — stays on your machine.

## Which keys, and for what

| Provider | Used for | Required? |
|----------|----------|-----------|
| **Deepgram** | Cloud transcription (Nova-3) | Yes, unless using [offline transcription](../vscode/offline.md) |
| **Anthropic (Claude)** | Post-processing — cleanup, templates, course correction, voice commands | Yes, always |
| **OpenAI** | Embeddings only, for the local context-search index used by context-aware templates | No — only if you choose the OpenAI embeddings context-search provider over grepai |

There is no Verba-operated backend in this path: each key talks directly to its provider's API from your machine.

## Where keys are stored

Keys are never written to plaintext config files or committed anywhere — each surface uses its platform's secure credential storage:

| Surface | Storage | Notes |
|---------|---------|-------|
| VS Code extension | `vscode.SecretStorage` | Backed by your OS's credential store (Keychain on macOS, Credential Manager on Windows, libsecret on Linux) via VS Code itself |
| macOS app | System **Keychain**, via the Rust [`keyring`](https://crates.io/crates/keyring) crate | Read/written through Tauri commands (`secret_get` / `secret_set` / `secret_delete`) |

### macOS: environment-variable override

On the macOS app, you can pin a key via an environment variable instead of the Keychain — useful for scripted or ephemeral setups. `VERBA_ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY` and `VERBA_DEEPGRAM_API_KEY` / `DEEPGRAM_API_KEY` are checked first (in that order) and, when set, take precedence over whatever is stored in the Keychain. Env values are read-only from Verba's perspective — they're never written back, so a bad key from the environment must be fixed at the source (unset or correct the variable and restart the app) rather than through the tray's key-management UI.

## Going fully offline

Even Deepgram is optional: switch the transcription provider to **whisper.cpp** and audio never leaves your machine at all — only the transcript is still sent to Claude for post-processing. See [Offline Transcription](../vscode/offline.md) for setup (currently VS Code only).

## Why this matters

- **No subscription, no lock-in** — you pay each provider directly for what you use, at their rates, and can revoke access at any time from your own account.
- **No data pass-through** — Verba doesn't log, proxy, or retain your audio or transcripts on any server it operates; dictation history is kept locally and is never sent anywhere.
- **Full control over the trust boundary** — you decide which two (or three) providers see your speech at all, down to going fully offline for transcription.
