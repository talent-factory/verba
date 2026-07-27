# UAT — TF-531 Agent Prompt Template

**Voraussetzung:** Release-Build aus dem Terminal gestartet (App-Nap/echtes Verhalten,
sichtbares stderr):
`just macos-build && ./apps/macos/src-tauri/target/release/bundle/macos/Verba.app/Contents/MacOS/Verba`
grepai muss installiert und im Ziel-Repo initialisiert sein (`grepai init` → `.grepai/`).

## VS Code
- [x] `Agent Instruction`-Template aktiv, `verba.contextSearch`-Provider = grepai oder openai.
- [x] Kurzer Befehl („mach die Tests grün") → knappes `## Ziel`, KEINE leeren Sektionen.
- [x] Mehrteiliger Befehl mit vager Referenz („das mit dem Cache in der Session-Klasse, und Tests dazu")
      → `## Ziel`, `## Scope` mit ECHTEN Pfaden aus dem Workspace, `## Constraints` (Tests), ggf. `## Unklar`.
- [x] Referenz auf etwas Nicht-Existierendes → landet unter `## Unklar`, KEIN erfundener Pfad.
- [x] Deutsches Diktat → deutsche Header (`## Ziel`); englisches → `## Goal`.

## macOS (herdr)
- [x] Fokussierte Claude-Code-Pane in einem indizierten Repo; Diktat mit vager Referenz.
- [x] `## Scope` zeigt Pfade aus dem **Pane-Repo** (cwd), NICHT aus einem MCP-Subprozess-Repo (foreground_cwd).
- [x] Ohne herdr / ohne `.grepai/` im Ziel-Repo: Struktur kommt, `## Scope` fehlt, kein Fehler-Banner
      (stderr zeigt „grepai scope resolution failed … no ## Scope").
- [x] Zustellung an die Pane funktioniert weiterhin (Insert/Submit, TF-525).

## Laufzeit-Fixes, die im UAT nötig wurden
Das Feature selbst (Template + Scope) stand nach den Plan-Tasks; die Abnahme deckte vier
Laufzeit-Bugs auf, jeder mit Test gefixt:
- `## Ziel`-Header war optional („terse" → Header weggelassen) → verpflichtend gemacht (`3df9157`).
- Mehrzeiliger Terminal-Output wurde an der Newline aufgetrennt → Bracketed-Paste (`4e32758`).
- macOS-Flow blieb bei „Verarbeite mit Claude…" stehen bis Tastendruck (App Nap / WKWebView-Occlusion-
  Drosselung) → nativer Run-Loop-Heartbeat (`05d158e`).
- `## Scope` immer leer, weil `grepai search` ein Box-Format ausgibt, nicht `file:zeile: text` →
  `--json` + JSON-Parser, beide Hosts (`4e19cc0`).

Nicht-Bugs (Diagnose): VSIX-Install-Kollision (gleiche Version braucht VS-Code-Neustart/State-Cleanup);
Aussagesatz ohne Anweisung → korrekt als Prosa zurückgegeben (kein erfundenes Ziel).

## Ergebnis
- [x] Abgenommen von: Daniel Senften  Datum: 2026-07-27
