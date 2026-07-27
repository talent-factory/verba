# TF-531 — Agent Prompt Template: Diktat als strukturierter Agent-Prompt

**Status:** Design abgenommen (2026-07-26) · **Issue:** [TF-531](https://linear.app/talent-factory/issue/TF-531) · **Baut auf:** TF-525 (agent-native Zustellung)

## Ziel

Diktat, das an einen Coding-Agenten geht, wird zu einem **strukturierten Prompt** (Ziel/Scope/Constraints/Unklar) statt zu bereinigtem Fliesstext. Kern: vage Referenzen werden zu echten Pfaden aufgelöst, und was *nicht* auflösbar ist, wird explizit als `## Unklar` markiert statt erfunden.

## Ausgangslage (verifiziert am 2026-07-26)

Große Teile existieren bereits — das Design nutzt sie statt neu zu bauen:

- **Template-System** in `@verba/core` (`packages/core/src/config.ts`, `config/defaultTemplates.json`). Zwei bereits vorhandene Agent-Templates: `Claude Code Prompt` und `Agent Instruction`.
- **`Agent Instruction`** ist über `AGENT_INSTRUCTION_TEMPLATE_NAME` (`config.ts:54`) bereits der **auto-gewählte Default für Agent-Surfaces** — auf beiden Hosts (`templateForSurface` in `apps/macos/src/config/verbaConfig.ts:81`; VS-Code-Pfad analog). Sein Prompt ist bewusst **adaptiv** (kurzer Befehl → knappe Imperativ-Zeile; langer → Task + Bullets + Constraints; „MUST NOT be inflated into a multi-section block").
- **Scope-Auflösung (VS Code)** komplett vorhanden: `src/contextProvider.ts` ist eine Fassade über drei Backends — `grepai` (`src/grepaiProvider.ts`, shellt zur `grepai`-CLI), `openai` (`src/embeddingService.ts` + `src/vectorStore.ts`/`indexer.ts`) und `none`. Wird bei `contextAware`-Templates schon genutzt (`extension.ts:397`).
- **Core-Kontext-Transport** vorhanden: `PipelineContext.contextSnippets?: string[]` (`pipeline.ts:8`); `CleanupService` verpackt sie in `<context>…</context>` (`cleanupService.ts:309`).
- **macOS-Lücke:** `cleanupContextFor` (`verbaConfig.ts:91`) füllt `contextSnippets` **nicht** — macOS-`contextAware`-Templates laufen heute ohne Code-Kontext. Das ist der eigentliche Neubau.

## Getroffene Entscheidungen

| Entscheidung | Wahl | Begründung |
| -- | -- | -- |
| Neues Template vs. bestehendes evolvieren | **`Agent Instruction` erweitern** | Vermeidet ein drittes fast identisches Template; AC7 (Auto-Wahl) automatisch erfüllt; **keine** neuen Template-Einträge → die Namens-Konsumenten (`config.rs`, verbaConfig-Tests) bleiben unberührt. Der Prompt-**Text** ist aber in `package.json` + `defaultTemplates.json` dupliziert und wird per `templateParity.test.ts` synchron gehalten (siehe unten). |
| macOS-Scope-Mechanik | **Native `grepai`-CLI (Rust), analog herdr** | Ziel-Repo ist eine beliebige Pane-cwd → pro-Repo-Index nötig. grepai lagert Freshness an das (ohnehin genutzte) Dev-Tool aus; kein Verba-eigener Index; passt zur Eigen-/Lehr-Tool-Positionierung. |
| Struktur immer vs. adaptiv (AC2) | **Adaptiv** | Kurzer Ein-Aktions-Befehl → knappes `## Ziel` (eine Zeile), keine leeren Sektionen. Erst mehrteilige Diktate bekommen die volle Struktur. Erfüllt „`## Ziel` ist Pflicht" ohne die bewusst vermiedene Inflation. |
| Header-Sprache | **Folgt der Diktat-/Output-Sprache** | DE → `## Ziel`, EN → `## Goal`. Konsistent damit, dass der Rest-Text sprachtreu bleibt. |
| No-Hallucination-Durchsetzung | **Prompt-Disziplin + UAT** | Ein LLM lässt sich nicht deterministisch an Nicht-Halluzination binden; die deterministischen Teile (cwd-Feldwahl, Parse, Degradation, Injektion) sind unit-getestet, die Pfad-Treue per UAT verifiziert. |

## Architektur

```
                     @verba/core
   defaultTemplates.json → "Agent Instruction" (Prompt evolviert)
   PipelineContext.contextSnippets → CleanupService <context>…</context>
        │                                          │
   VS-Code-Host                              macOS-Host
   ContextProvider (vorhanden)              NEU: herdr-cwd + grepai (Rust)
   grepai|openai|none per Config            detect.rs (+cwd) → grepai_search → wiring
        └──────────────── contextSnippets ─────────────┘
```

### 1. Kern: Template-Prompt (`packages/core/src/config/defaultTemplates.json`)

Der `Agent Instruction`-Prompt wird erweitert (Verhalten, nicht Identität):

- **Adaptive Struktur** bleibt; wenn strukturiert, dann in den Sektionen `## Ziel` / `## Scope` / `## Constraints` / `## Unklar`.
- **Leere Sektionen weglassen**, `## Ziel` immer vorhanden.
- **`## Scope`** aus den Pfaden/Symbolen des `<context>`-Blocks.
- **`## Unklar`** für Referenzen, die im `<context>` nicht auflösbar sind — statt Pfade zu erfinden.
- **Header** in der Output-Sprache.
- Bestehende Zusicherungen (kein Refuse bei nicht-aktionablem Diktat, Backticks für Pfade/Symbole, Sprachtreue) bleiben.

**Betroffene Dateien für die Prompt-Änderung (verifiziert):** Der `Agent Instruction`-Prompt-Text ist an **zwei** Stellen dupliziert und muss synchron bleiben:
- `packages/core/src/config/defaultTemplates.json` (Single Source für den Core)
- `package.json` (VS-Code-Manifest, Default des `verba.templates`-Settings)

`src/test/unit/templateParity.test.ts` erzwingt Gleichheit beider — beide Stellen zusammen ändern, sonst rot. Rust `config.rs` dupliziert den Prompt **nicht** (nur Template-Namen/-Struktur) und bleibt unberührt; da kein neues Template hinzukommt, ändern sich auch die Namens-Konsumenten (verbaConfig-Tests) nicht.

### 2. VS-Code-Host

Keine Struktur-Änderung: `Agent Instruction` ist `contextAware`, `ContextProvider` liefert die Snippets bereits (`extension.ts:397`). Der evolvierte Prompt konsumiert sie neu strukturiert. Backend-Wahl (grepai/openai/none) bleibt Config-gesteuert.

### 3. macOS-Host (Neubau)

**a) herdr-cwd-Erkennung — `apps/macos/src-tauri/src/detect.rs`**
`HerdrAgent` um `cwd`/`foreground_cwd` aus `herdr api snapshot` erweitern. Feldregel:
- Agent-Pane (`agent` gesetzt) → **`cwd`**.
- Shell-Pane (kein `agent`) → **`foreground_cwd`**.

Reines JSON-Parsing über den bestehenden Envelope (`{"id":…, "result":…}`); Muster durch TF-525-Serde-Wire-Tests abgedeckt.

**b) Nativer `grepai_search`-Command — neu (analog `deliver::herdr_send`)**
Shellt `grepai search <query> --limit <N>` mit `cwd=<pane-repo>`, parst `file:line: content` zu Snippets (gleiche Logik wie `parseGrepaiOutput`). Timeout + Fehler → leeres Ergebnis (kein Abbruch).

**c) Wiring — `apps/macos/src/config/verbaConfig.ts` / `wiring.ts`**
Bei Agent-Surface: Pane-cwd ermitteln → `grepai_search` → `contextSnippets` in den `PipelineContext` (`cleanupContextFor`) füllen. Kern bleibt unverändert; nur das bereits vorhandene Feld wird endlich gefüllt.

**d) Degradation (AC6)**
Kein herdr / Pane nicht gefunden / Timeout / kein `.grepai/` im Ziel-Repo → `contextSnippets` leer → Template liefert Struktur ohne `## Scope`, kein harter Fehler.

## Tests (AC8)

**Rust (`cargo test`):**
- Feldwahl `cwd` vs. `foreground_cwd` je Pane-Typ (Agent vs. Shell).
- `grepai`-Output-Parsing (Gruppierung nach Datei).
- grepai-Fehler / leere Ausgabe → leeres Ergebnis.

**TS (macOS, mocha):**
- Wiring füllt `contextSnippets` bei Agent-Surface aus dem grepai-Ergebnis.
- Degradations-Pfad: Fehler/kein Repo → `contextSnippets` leer, Flow läuft weiter.

**Nicht unit-getestet:** LLM-Struktur/Pfad-Treue (nicht deterministisch) → **UAT-Dokument** unter `docs/superpowers/uat/`.

## Acceptance-Criteria-Mapping

| AC | Umsetzung |
| -- | -- |
| Template in `@verba/core`, konfigurierbar | `Agent Instruction` evolviert (bestehendes, konfigurierbares Template) |
| Struktur Ziel/Scope/Constraints/Unklar, leere weg, Ziel Pflicht | Prompt (adaptiv, siehe Entscheidung) |
| Keine erfundenen Pfade → `## Unklar` | Prompt-Disziplin (nur `<context>`-Pfade) + UAT |
| VS Code: Scope via aktiven Workspace | Vorhandener `ContextProvider` (grepai/openai) |
| macOS: Repo aus herdr-Pane, Feldregel, dann Scope | `detect.rs`-cwd + `grepai_search` + Wiring |
| Degradation ohne cwd | `contextSnippets` leer → `## Scope` entfällt |
| Auto-Wahl bei agent-nativer Zustellung | `Agent Instruction` ist bereits Agent-Surface-Default |
| Unit-Tests | Rust + TS wie oben |
| UAT-Dokument | `docs/superpowers/uat/` |

## Nicht in Scope

Rückkanal (Agent → HUD → Stimme), MCP-Server (Agent fordert Diktat an), Zustellung über herdr hinaus (Cursor, generische Terminals), signiertes macOS-Build, Offline-Transkription auf macOS.

## Referenzen

- Issue [TF-531](https://linear.app/talent-factory/issue/TF-531), related [TF-525](https://linear.app/talent-factory/issue/TF-525)
- Wiki: `85 Wissen/_wiki/compare/Verba-vs-Spokenly.md`, `85 Wissen/_raw/notes/2026-07-26-verba-repo-scan-v070.md`
- Bestehender Code: `src/contextProvider.ts`, `src/grepaiProvider.ts`, `packages/core/src/config.ts`, `apps/macos/src/config/verbaConfig.ts`, `apps/macos/src-tauri/src/detect.rs`
