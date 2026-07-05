# Configuration

The macOS app reads its settings from a single JSON file:

```
~/.config/verba/config.json
```

This follows the XDG convention: if `$XDG_CONFIG_HOME` is set, Verba uses `$XDG_CONFIG_HOME/verba/config.json` instead. If the file doesn't exist, Verba behaves as if it were `{}` and falls back to defaults for everything.

You can open it directly from the tray menu (**Konfiguration öffnen…**), which creates the file first if it's missing. After editing it by hand, use **Konfiguration neu laden** to apply the changes without restarting the app.

!!! warning "Bare top-level keys — no `verba.` prefix"
    Unlike the VS Code extension's `settings.json` (which namespaces everything under `verba.*`, e.g. `verba.glossary`), the macOS config file uses **bare top-level keys**: `glossary`, not `verba.glossary`. A VS Code–style key here is simply ignored — the corresponding default is used instead, silently.

## API Keys

Your Deepgram and Anthropic API keys are **not** stored in `config.json`. They live in the macOS **Keychain** (never in plaintext), and Verba resolves them in this order: **environment variable → Keychain → GUI prompt**.

For the bundled `Verba.app`, store them in the Keychain: launch the app and dictate once — when no key is found, Verba prompts for the Deepgram key (transcription) and then the Anthropic key (cleanup), and saves each to the Keychain. This persists across restarts and is the recommended, secure path.

!!! warning "`Verba.app` does not read `~/.zshrc`"
    A `.app` launched from Finder / Spotlight / Dock is started by `launchd`, not a shell, so it never sources `~/.zshrc` (or `~/.zprofile`). Environment-variable keys — `VERBA_ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY` and `VERBA_DEEPGRAM_API_KEY` / `DEEPGRAM_API_KEY` — therefore only resolve when Verba is launched **from a terminal** (e.g. `just macos-dev`). This is standard macOS behaviour, not a Verba bug — so a `.app` that "ignores" your shell keys is expected; use the Keychain instead.

    If you really do want env vars for the GUI app, set them in the `launchd` session and fully relaunch Verba:

    ```bash
    launchctl setenv ANTHROPIC_API_KEY "sk-ant-…"
    launchctl setenv DEEPGRAM_API_KEY  "…"
    ```

    Caveats: this is **not persistent** across reboot/logout (you would need a LaunchAgent to re-run it at login) and is **less secure** than the Keychain. Prefer the Keychain prompt above.

## Schema

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `language` | String | `"auto"` | Language used by Claude for post-processing/cleanup. |
| `transcription.language` | String | `"multi"` | Language passed to Deepgram for transcription (`"multi"` for multilingual code-switching, or a specific code like `"de"`). |
| `transcription.provider` | String | `"deepgram"` | Transcription provider. `"local"` is listed in the tray menu but not yet wired on macOS — Deepgram is always used regardless of this value. |
| `glossary` | String[] | `[]` | Terms preserved during transcription (Deepgram) and cleanup (Claude). Non-string or blank entries are dropped. |
| `expansions` | `{abbreviation, expansion}[]` | `[]` | Text abbreviations expanded during Claude post-processing. Malformed entries are dropped individually. |
| `templates` | Template[] | 9 bundled defaults | Post-processing templates — see [Templates](#templates) below. |
| `activeTemplate` | String | first template's name | Name of the currently active template (set via the tray's **Vorlage** submenu). |
| `audioDevice` | String | `""` (system default) | Input device name; empty/blank uses the system default microphone. |

Every key is optional and independently defaulted — a malformed or missing value never crashes the app, it just falls back (see `resolveConfig` in `packages/core/src/config.ts`, shared with the VS Code extension).

## Templates

Each entry in `templates` has this shape:

```ts
{
  name: string;          // required, non-empty
  prompt: string;        // required
  icon?: string;         // optional emoji, shown in the tray "Vorlage" submenu
  contextAware?: boolean; // VS Code–only, inert on macOS
  fileTypes?: string[];   // VS Code–only, inert on macOS
}
```

`contextAware` and `fileTypes` exist because `Template` is a shared type used by both hosts: `contextAware` triggers a codebase search before the VS Code extension calls Claude, and `fileTypes` drives VS Code's automatic per-language template selection. Neither has any effect on macOS — you can include them (e.g. if you share one config across notes) or leave them out.

!!! warning "All-or-nothing"
    `templates` is validated as a whole: if it's present, non-empty, and *every* entry has at least a non-empty `name` and a `prompt`, your array **replaces** the 9 bundled defaults entirely. If it's absent, empty, or even a single entry is invalid, Verba falls back to all 9 bundled defaults — nothing is merged. If you want to keep any of the built-in templates alongside your own, copy them into your `templates` array explicitly.

The 9 bundled defaults are: **Freitext**, **Commit Message**, **JavaDoc**, **Markdown**, **E-Mail**, **Code Comment**, **Explain Code**, **Claude Code Prompt**, and **Transform Selection** (see [Templates](../concepts/templates.md) for what each does).

## Full Example

```json
{
  "language": "de",
  "transcription": {
    "language": "multi",
    "provider": "deepgram"
  },
  "glossary": ["Verba", "Kubernetes", "PostgreSQL"],
  "expansions": [
    { "abbreviation": "brb", "expansion": "be right back" },
    { "abbreviation": "asap", "expansion": "as soon as possible" }
  ],
  "templates": [
    {
      "name": "Freitext",
      "icon": "✏️",
      "prompt": "Clean up the transcript: remove filler words, smooth broken or repeated sentence starts, fix obvious transcription errors. Keep the original language and meaning exactly. Return only the cleaned text without explanation."
    },
    {
      "name": "E-Mail",
      "icon": "📧",
      "prompt": "Convert this transcript into a professional email with appropriate greeting and closing. Maintain the original language and intended tone (formal or informal). Return only the email text without explanation."
    },
    {
      "name": "Standup Notes",
      "icon": "🗒️",
      "prompt": "Convert this transcript into concise standup notes with three sections: Yesterday, Today, Blockers. Keep the original language. Return only the notes without explanation."
    }
  ],
  "activeTemplate": "Freitext",
  "audioDevice": ""
}
```

This example keeps two of the bundled defaults (**Freitext**, **E-Mail** — copied in explicitly, per the all-or-nothing rule) and adds one custom template (**Standup Notes**); the other 7 defaults are dropped for this config.

## Next Steps

- [Templates](../concepts/templates.md) — what each bundled template does
- [Usage](usage.md) — how tray-menu changes are written back to this file
