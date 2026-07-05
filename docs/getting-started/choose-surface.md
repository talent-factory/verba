# Choose Your Surface

Verba ships as two separate surfaces that share the same transcription and post-processing pipeline (Deepgram Nova-3 + Claude). Pick the one that matches how you work — you can always add the other later.

## VS Code Extension

Use the **VS Code extension** if you:

- live in the editor and want dictation tied to cursor position, active file, and selection
- want **code-aware templates** (JavaDoc, code comments, commit messages, Claude Code prompts) that pick themselves based on file type
- need dictation inside the **integrated terminal**
- want **offline transcription** via whisper.cpp, with no audio ever leaving your machine

→ [Install the VS Code extension](../vscode/installation.md)

## macOS App — Public Beta

Use the **macOS app (Public Beta)** if you:

- want dictation **system-wide**, in any app — email, chat, browser, notes, not just VS Code
- prefer a lightweight menu-bar companion over an editor extension

The macOS app is currently a **Public Beta**, built from source (no packaged `.dmg` yet). It shares the same bring-your-own-key model and post-processing pipeline as the extension.

→ [Install the macOS app](../macos/installation.md)

## Not sure yet?

Both surfaces are free to use with your own API keys — there's no cost to trying either one first. Continue with [Prerequisites](prerequisites.md) to set up the shared requirements (ffmpeg, Deepgram key, Anthropic key) before installing either surface.
