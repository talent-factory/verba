# UAT — TF-531 Agent Prompt Template

**Voraussetzung:** Release-Build aus dem Terminal gestartet (App-Nap/echtes Verhalten,
sichtbares stderr):
`just macos-build && ./apps/macos/src-tauri/target/release/bundle/macos/Verba.app/Contents/MacOS/Verba`
grepai muss installiert und im Ziel-Repo initialisiert sein (`grepai init` → `.grepai/`).

## VS Code
- [ ] `Agent Instruction`-Template aktiv, `verba.contextSearch`-Provider = grepai oder openai.
- [ ] Kurzer Befehl („mach die Tests grün") → knappes `## Ziel`, KEINE leeren Sektionen.
- [ ] Mehrteiliger Befehl mit vager Referenz („das mit dem Cache in der Session-Klasse, und Tests dazu")
      → `## Ziel`, `## Scope` mit ECHTEN Pfaden aus dem Workspace, `## Constraints` (Tests), ggf. `## Unklar`.
- [ ] Referenz auf etwas Nicht-Existierendes → landet unter `## Unklar`, KEIN erfundener Pfad.
- [ ] Deutsches Diktat → deutsche Header (`## Ziel`); englisches → `## Goal`.

## macOS (herdr)
- [ ] Fokussierte Claude-Code-Pane in einem indizierten Repo; Diktat mit vager Referenz.
- [ ] `## Scope` zeigt Pfade aus dem **Pane-Repo** (cwd), NICHT aus einem MCP-Subprozess-Repo (foreground_cwd).
- [ ] Ohne herdr / ohne `.grepai/` im Ziel-Repo: Struktur kommt, `## Scope` fehlt, kein Fehler-Banner
      (stderr zeigt „grepai scope resolution failed … no ## Scope").
- [ ] Zustellung an die Pane funktioniert weiterhin (Insert/Submit, TF-525).

## Ergebnis
- [ ] Abgenommen von: __________  Datum: __________
