# Terminal Mode

When the VS Code integrated terminal is focused, Verba inserts dictated text directly into the terminal instead of the editor.

## How It Works

The same keybinding `Cmd+Shift+D` (Mac) / `Ctrl+Shift+D` (Windows/Linux) works in both contexts:

- **Editor focused** — Text is inserted at the cursor position in the active editor.
- **Terminal focused** — Text is pasted into the active terminal.

Verba uses VS Code's `when` clause to detect focus and routes to the appropriate command automatically.

## Auto-Execute

By default, dictated text is pasted into the terminal without pressing Enter. To auto-execute:

```json
{
  "verba.terminal.executeCommand": true
}
```

With this setting enabled, Verba sends Enter after pasting — the dictated text is immediately executed as a terminal command.

!!! warning
    Use `executeCommand: true` with caution. The dictated text is executed immediately after post-processing, without a chance to review.
