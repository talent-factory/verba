# TF-531 Agent Prompt Template — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das bestehende `Agent Instruction`-Template liefert einen strukturierten Agent-Prompt (Ziel/Scope/Constraints/Unklar) mit echter Scope-Auflösung — auf VS Code (vorhandener `ContextProvider`) und neu auf macOS (herdr-Pane-cwd → native grepai-CLI).

**Architecture:** Kein neues Template — der `Agent Instruction`-Prompt wird evolviert (Core-JSON + VS-Code-Manifest, synchron via Parity-Test). VS Code nutzt den bestehenden `ContextProvider` unverändert. macOS bekommt drei neue Bausteine: cwd-Extraktion aus `herdr api snapshot` (`detect.rs`), einen nativen `grepai_search`-Command (neu `grepai.rs`), und Wiring, das die Snippets als `contextSnippets` in den bereits vorhandenen `PipelineContext` einspeist.

**Tech Stack:** TypeScript (VS Code + macOS-Frontend), Rust (Tauri-Backend), `@verba/core` (kompiliert nach `dist/`), grepai-CLI (extern, Shell-Out wie herdr).

## Global Constraints

- **Kein neues Template.** Nur der `Agent Instruction`-Prompt wird geändert; die Template-*Menge* bleibt (10) → `config.rs` und verbaConfig-Namens-Tests unberührt.
- **Prompt-Sync:** Der Prompt-Text steht identisch in `packages/core/src/config/defaultTemplates.json` UND `package.json` (`contributes.configuration.properties["verba.templates"].default`). `src/test/unit/templateParity.test.ts` erzwingt `deepStrictEqual` — beide immer zusammen ändern.
- **Adaptiv (nicht rigide):** kurzer Ein-Aktions-Befehl → knappes `## Ziel` (eine Zeile), keine leeren Sektionen. `## Ziel` immer vorhanden.
- **Sprachtreue Header:** Sektions-Header in der Diktat-/Output-Sprache (DE → `## Ziel`, EN → `## Goal`).
- **Keine erfundenen Pfade:** nur Pfade/Symbole aus dem `<context>`-Block; Unauflösbares → `## Unklar`.
- **Graceful Degradation (AC6):** kein herdr / keine cwd / kein `.grepai/` / Timeout → `contextSnippets` leer → `## Scope` entfällt, kein harter Fehler.
- **Nach `@verba/core`-Änderung:** `npm run compile:core` (sonst importieren Hosts stale `dist/`).
- **Commits:** Emoji Conventional Commits, Deutsch, ohne Co-Authored-By (Repo-Konvention `/git-workflow:commit`).
- **Rust-Tests** laufen nur via `cargo test` (nicht in den npm-Suites).

## File Structure

| Datei | Rolle | Aktion |
| -- | -- | -- |
| `packages/core/src/config/defaultTemplates.json` | Single Source der Default-Templates | Modify (Agent-Instruction-Prompt) |
| `package.json` | VS-Code-Manifest, `verba.templates`-Default | Modify (identischer Prompt) |
| `packages/core/src/test/unit/config.test.ts` | Core-Tests | Modify (Lock-Test für Prompt-Direktiven) |
| `packages/core/src/config.ts` | `DetectedSurface`-Typ | Modify (`cwd?` an agent-Variante) |
| `apps/macos/src-tauri/src/detect.rs` | Surface-Erkennung | Modify (cwd/foreground_cwd, `pane_repo_root`, `Surface::Agent.cwd`) |
| `apps/macos/src-tauri/src/grepai.rs` | Native grepai-Scope-Auflösung | **Create** |
| `apps/macos/src-tauri/src/lib.rs` | Command-Registrierung | Modify (`grepai::grepai_search`) |
| `apps/macos/src/config/verbaConfig.ts` | Wiring-Helfer | Modify (`agentContextSnippets`, `DetectedSurface`-Import) |
| `apps/macos/src/wiring.ts` | Produktions-Deps | Modify (Snippets in cleanup-Kontext) |
| `apps/macos/src/test/unit/verbaConfig.test.ts` | macOS-Tests | Modify (`agentContextSnippets`-Tests) |
| `docs/superpowers/uat/2026-07-26-tf-531-agent-prompt-template.md` | UAT | **Create** |

---

## Task 1: `Agent Instruction`-Prompt evolvieren (Core + Manifest-Parity)

**Files:**
- Modify: `packages/core/src/config/defaultTemplates.json` (Eintrag `"Agent Instruction"`)
- Modify: `package.json` (`contributes.configuration.properties."verba.templates".default` — derselbe Eintrag)
- Test: `packages/core/src/test/unit/config.test.ts` (neuer Lock-Test), `src/test/unit/templateParity.test.ts` (bestehend, muss grün bleiben)

**Interfaces:**
- Consumes: nichts.
- Produces: kein neuer Export; der evolvierte Prompt-String (identisch in beiden Dateien).

- [ ] **Step 1: Lock-Test schreiben (schlägt fehl)**

In `packages/core/src/test/unit/config.test.ts` am Ende der Datei ergänzen:

```typescript
import { DEFAULT_TEMPLATES } from '../../config';

test('the Agent Instruction template documents the structured agent-prompt contract', () => {
	const agent = DEFAULT_TEMPLATES.find(t => t.name === 'Agent Instruction');
	assert.ok(agent, 'Agent Instruction template exists');
	const p = agent!.prompt;
	// Structured sections (headers illustrated in the dictation language).
	assert.ok(p.includes('## Ziel'), 'names the mandatory Ziel/Goal section');
	assert.ok(p.includes('## Scope'), 'names the Scope section');
	assert.ok(p.includes('## Constraints'), 'names the Constraints section');
	assert.ok(p.includes('## Unklar'), 'names the Unklar/Unclear section');
	// The two novel guarantees over the old free-form instruction.
	assert.ok(/never invent/i.test(p), 'forbids inventing file paths');
	assert.ok(/omit/i.test(p), 'omits empty sections');
	// Adaptive: short single-action requests must stay terse.
	assert.ok(/single-action|terse/i.test(p), 'keeps short requests terse (no inflation)');
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `npm run compile:core && cd packages/core && npx mocha dist-test/test/unit/config.test.js -g "structured agent-prompt contract"`
Expected: FAIL (alter Prompt enthält weder `## Ziel` noch „never invent").

> Hinweis: Falls die Core-Test-Ausführung anders läuft, das im Repo etablierte Core-Test-Kommando verwenden (`just` bzw. `npm test -w @verba/core`). Entscheidend ist: der neue Test ist zuerst rot.

- [ ] **Step 3: Prompt in `defaultTemplates.json` ersetzen**

Den `prompt`-Wert des `"Agent Instruction"`-Eintrags (aktuell „Convert this transcript into a clear, executable instruction…") **vollständig** ersetzen durch:

```
Convert this transcript into a structured, executable instruction for an AI coding agent (e.g. Claude Code, Cursor, Codex). The transcript is a raw spoken thought: extract the intent and drop meta-speech such as 'okay so what I want you to do is'. Adapt the structure to the content. A short, single-action request stays terse: a single '## Ziel' section with one imperative line — do NOT inflate it into extra sections. A longer, multi-part request uses these sections in this order, OMITTING any that would be empty: '## Ziel' (the objective — ALWAYS present), '## Scope' (the concrete files, paths and code symbols the work touches), '## Constraints' (only when the speaker names boundaries — what must not be touched, tests to add), '## Unklar' (open questions the agent should clarify before acting). Write the section HEADERS in the same language as the transcript (German -> '## Ziel', '## Scope', '## Constraints', '## Unklar'; English -> '## Goal', '## Scope', '## Constraints', '## Unclear'). A <context> block may be provided with real code snippets, each starting with '// file: <path>'. Use ONLY those paths and symbols to fill '## Scope' and to reference files, classes and functions by name (in backticks). NEVER invent file paths: if the transcript references something you cannot resolve from the provided context (or no context was provided), put that open reference under '## Unklar' instead of guessing a path. Keep the original spoken language for all content. If the transcript contains no actionable instruction, do NOT refuse, apologize, or ask for a task — instead return the transcript lightly cleaned up as plain prose, in the same spoken language. Return ONLY the resulting text, ready to paste into an agent.
```

- [ ] **Step 4: Identischen Prompt in `package.json` setzen**

In `package.json` unter `contributes.configuration.properties."verba.templates".default` den `"Agent Instruction"`-Eintrag mit **exakt demselben** `prompt`-String aktualisieren (Zeichen-für-Zeichen identisch, sonst schlägt Parity fehl).

- [ ] **Step 5: Lock-Test + Parity-Test ausführen — müssen bestehen**

Run: `npm run compile:core && cd packages/core && npx mocha dist-test/test/unit/config.test.js -g "structured agent-prompt contract"`
Expected: PASS
Run (Repo-Root, VS-Code-Suite): das etablierte VS-Code-Test-Kommando, gefiltert auf `templateParity`
Expected: PASS (`verba.templates default deep-equals core DEFAULT_TEMPLATES`).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config/defaultTemplates.json package.json packages/core/src/test/unit/config.test.ts
git commit -m "✨ feat(core): Agent-Instruction-Template zu strukturiertem Agent-Prompt (Ziel/Scope/Constraints/Unklar)"
```

---

## Task 2: herdr-Pane-cwd-Extraktion + `DetectedSurface.cwd` (Wire-Contract)

**Files:**
- Modify: `apps/macos/src-tauri/src/detect.rs` (`HerdrAgent`, `focused_herdr_agent_from_json`, neue `pane_repo_root`, `Surface::Agent`, `classify`, bestehende Tests)
- Modify: `packages/core/src/config.ts:96` (`DetectedSurface` agent-Variante: `cwd?`)

**Interfaces:**
- Consumes: nichts.
- Produces:
  - Rust `pub(crate) fn pane_repo_root(agent: Option<&str>, cwd: Option<&str>, foreground_cwd: Option<&str>) -> Option<String>`
  - Rust `HerdrAgent.repo_root: Option<String>`
  - Rust `Surface::Agent { agent, status, pane_id, cwd: Option<String> }` (serde-Feld `"cwd"`, ausgelassen wenn `None`)
  - TS `DetectedSurface` agent-Variante mit `cwd?: string` (der aufgelöste Repo-Root der fokussierten Pane)

- [ ] **Step 1: Failing tests für `pane_repo_root` + cwd-Parsing schreiben**

In `apps/macos/src-tauri/src/detect.rs` im `#[cfg(test)] mod tests` ergänzen:

```rust
    #[test]
    fn agent_pane_uses_cwd_not_foreground() {
        // Agent-Pane: foreground_cwd zeigt oft auf einen MCP-Subprozess in fremdem
        // Repo — cwd ist der richtige Scope.
        let r = pane_repo_root(Some("claude"), Some("/repo/verba"), Some("/repo/content-hub/mcp-server"));
        assert_eq!(r.as_deref(), Some("/repo/verba"));
    }

    #[test]
    fn shell_pane_uses_foreground_cwd() {
        let r = pane_repo_root(None, Some("/repo/ratum"), Some("/repo/ratum/backend"));
        assert_eq!(r.as_deref(), Some("/repo/ratum/backend"));
    }

    #[test]
    fn shell_pane_without_foreground_falls_back_to_cwd() {
        let r = pane_repo_root(None, Some("/repo/ratum"), None);
        assert_eq!(r.as_deref(), Some("/repo/ratum"));
    }

    #[test]
    fn no_dirs_at_all_is_none() {
        assert_eq!(pane_repo_root(Some("claude"), None, None), None);
    }

    #[test]
    fn focused_agent_carries_repo_root_from_cwd() {
        let json = r#"{"result":{"snapshot":{"agents":[
            {"agent":"claude","focused":true,"pane_id":"wW:p1","cwd":"/repo/verba","foreground_cwd":"/repo/content-hub/mcp-server"}
        ]}}}"#;
        let a = focused_herdr_agent_from_json(json).expect("a focused agent");
        assert_eq!(a.repo_root.as_deref(), Some("/repo/verba"));
    }

    #[test]
    fn agent_surface_carries_cwd_in_wire_json() {
        let herdr = Some(HerdrAgent { agent: "claude".into(), status: None, pane_id: Some("wW:p1".into()), repo_root: Some("/repo/verba".into()) });
        let s = classify(front("com.apple.Terminal"), herdr, None,
            &["claude".into()], &["com.apple.Terminal".into()], &[]);
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"cwd\":\"/repo/verba\""), "agent surface serializes cwd: {json}");
    }
```

- [ ] **Step 2: Tests ausführen — müssen fehlschlagen (Compile-Fehler zählt als Fail)**

Run: `cd apps/macos/src-tauri && cargo test pane_repo_root focused_agent_carries agent_surface_carries_cwd 2>&1 | tail -20`
Expected: FAIL — `pane_repo_root` existiert nicht, `HerdrAgent` hat kein `repo_root`, `Surface::Agent` kein `cwd`.

- [ ] **Step 3: `pane_repo_root` + `HerdrAgent.repo_root` implementieren**

`HerdrAgent` (oben in `detect.rs`) erweitern:

```rust
pub(crate) struct HerdrAgent {
    pub agent: String,
    pub status: Option<String>,
    pub pane_id: Option<String>,
    /// Repo root for scope resolution, resolved per pane type (see pane_repo_root).
    pub repo_root: Option<String>,
}
```

Direkt darunter die reine Feldwahl-Funktion einfügen:

```rust
/// Repo root for scope resolution, per pane type. Agent pane (`agent` set) ->
/// `cwd`: `foreground_cwd` follows the foreground process, which on a Claude-Code
/// pane is often an MCP subprocess in a foreign repo (measured: 3/4 panes pointed
/// at content-hub/mcp-server), so it would resolve scope against the wrong repo.
/// Shell pane (no agent) -> `foreground_cwd` (more precise than the login cwd),
/// falling back to `cwd`.
pub(crate) fn pane_repo_root(
    agent: Option<&str>,
    cwd: Option<&str>,
    foreground_cwd: Option<&str>,
) -> Option<String> {
    if agent.is_some() {
        cwd.map(|s| s.to_string())
    } else {
        foreground_cwd.or(cwd).map(|s| s.to_string())
    }
}
```

In `focused_herdr_agent_from_json` die beiden cwd-Felder extrahieren und `repo_root` berechnen (die `return Some(HerdrAgent { ... })`-Zeile ersetzen):

```rust
            let pane_id = a.get("pane_id").and_then(|p| p.as_str()).map(|s| s.to_string());
            let cwd = a.get("cwd").and_then(|c| c.as_str());
            let foreground_cwd = a.get("foreground_cwd").and_then(|c| c.as_str());
            let repo_root = pane_repo_root(Some(&agent), cwd, foreground_cwd);
            return Some(HerdrAgent { agent, status, pane_id, repo_root });
```

- [ ] **Step 4: `Surface::Agent.cwd` + `classify` + bestehende Tests anpassen**

`Surface::Agent`-Variante erweitern:

```rust
    Agent {
        agent: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<String>,
        #[serde(rename = "paneId", skip_serializing_if = "Option::is_none")]
        pane_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cwd: Option<String>,
    },
```

In `classify` beide `Surface::Agent { ... }`-Konstruktionen ergänzen:
- herdr-Zweig: `Surface::Agent { agent: h.agent, status: h.status, pane_id: h.pane_id, cwd: h.repo_root }`
- Title-Marker-Zweig: `Surface::Agent { agent: m.clone(), status: None, pane_id: None, cwd: None }`

Bestehende Tests, die `Surface::Agent { ... }` als Literal erwarten oder `HerdrAgent { ... }` bauen, um das neue Feld ergänzen (`cwd: None` bzw. `repo_root: None`), damit sie kompilieren:
- `terminal_with_herdr_agent_is_agent`, `terminal_with_marker_in_title_is_agent`, `marker_matching_is_case_insensitive_on_both_sides`, `herdr_agent_takes_precedence_over_a_title_marker`, `agent_surface_carries_pane_id` (Surface-Literale → `cwd: None`; die `HerdrAgent`-Konstruktionen → `repo_root: None`).

- [ ] **Step 5: `DetectedSurface.cwd` im Core ergänzen**

`packages/core/src/config.ts` (agent-Variante, aktuell Zeilen 99–105) erweitern:

```typescript
	| {
		class: 'agent';
		agent: string;
		status?: string;
		/** herdr pane id of the focused agent (delivery target); absent unless detected via herdr. */
		paneId?: string;
		/** Resolved repo root of the focused pane, for scope resolution; absent unless detected via herdr. */
		cwd?: string;
	};
```

- [ ] **Step 6: Tests ausführen — müssen bestehen**

Run: `cd apps/macos/src-tauri && cargo test 2>&1 | tail -20`
Expected: PASS (alle detect.rs-Tests, inkl. der neuen).
Run: `npm run compile:core`
Expected: PASS (Core kompiliert mit erweitertem Typ).

- [ ] **Step 7: Commit**

```bash
git add apps/macos/src-tauri/src/detect.rs packages/core/src/config.ts
git commit -m "✨ feat(macos): herdr-Pane-cwd (Agent→cwd, Shell→foreground_cwd) in Surface-Detection"
```

---

## Task 3: Nativer `grepai_search`-Command

**Files:**
- Create: `apps/macos/src-tauri/src/grepai.rs`
- Modify: `apps/macos/src-tauri/src/lib.rs` (`mod grepai;` + Handler-Registrierung)
- Test: in `grepai.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: nichts.
- Produces: Tauri-Command `grepai_search(query: String, cwd: String, limit: u32) -> Vec<String>` (Wire: `invoke<string[]>('grepai_search', { query, cwd, limit })`). Jeder Snippet-String hat die Form `// file: <pfad>\n<zeilen>` (identisch zum VS-Code-`ContextProvider`). Fehler/leer → `[]`.

- [ ] **Step 1: Failing tests für `parse_grepai_output` + `run_grepai` schreiben**

`apps/macos/src-tauri/src/grepai.rs` mit **nur** dem Test-Modul anlegen (Implementierung folgt in Step 3):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn groups_lines_by_file_in_first_seen_order() {
        let out = "src/session/SessionManager.ts:12: class SessionManager {\n\
                   src/session/SessionManager.ts:40:   flushCache() {\n\
                   src/session/SessionCache.ts:5: export class SessionCache {";
        let snippets = parse_grepai_output(out);
        assert_eq!(snippets.len(), 2);
        assert_eq!(
            snippets[0],
            "// file: src/session/SessionManager.ts\nclass SessionManager {\nflushCache() {"
        );
        assert_eq!(
            snippets[1],
            "// file: src/session/SessionCache.ts\nexport class SessionCache {"
        );
    }

    #[test]
    fn ignores_non_matching_lines_and_blanks() {
        let out = "\nnot a grep line\nsrc/a.ts:1: ok\n";
        let snippets = parse_grepai_output(out);
        assert_eq!(snippets, vec!["// file: src/a.ts\nok".to_string()]);
    }

    #[test]
    fn empty_output_is_no_snippets() {
        assert!(parse_grepai_output("").is_empty());
    }

    // run_grepai driven against real coreutils, no grepai CLI needed:
    #[test]
    fn run_grepai_true_yields_empty_ok() {
        // `true` ignores args, exits 0, emits nothing -> Ok("").
        assert_eq!(run_grepai("true", "q", ".", 5, Duration::from_secs(2)), Ok(String::new()));
    }

    #[test]
    fn run_grepai_false_is_err() {
        assert!(run_grepai("false", "q", ".", 5, Duration::from_secs(2)).is_err());
    }

    #[test]
    fn run_grepai_missing_binary_is_err() {
        assert!(run_grepai("definitely-not-a-real-binary-xyz", "q", ".", 5, Duration::from_secs(2)).is_err());
    }
}
```

- [ ] **Step 2: Tests ausführen — müssen fehlschlagen**

Zuerst `mod grepai;` provisorisch zu `lib.rs` (Zeile nach `mod env;`) hinzufügen, damit der Test kompiliert wird.
Run: `cd apps/macos/src-tauri && cargo test --lib grepai 2>&1 | tail -20`
Expected: FAIL — `parse_grepai_output`/`run_grepai` existieren nicht.

- [ ] **Step 3: Implementierung in `grepai.rs` (oberhalb des Test-Moduls) einfügen**

```rust
//! Native grepai scope resolution: shells out to the `grepai` CLI in a target
//! repo, mirroring the VS Code `GrepaiProvider` (spawn `grepai search <query>
//! --limit N` with cwd=<repo>, parse `file:line: content`). Follows the spawn +
//! timed-wait + kill-on-timeout shape of `deliver.rs::run_herdr`, but captures
//! stdout on a side thread (like `detect.rs::query_herdr`) since we need the
//! output. Every failure degrades to an empty result — scope resolution never
//! aborts the dictation flow (TF-531 AC6).

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Duration;

/// Upper bound on a single grepai search. A hung `grepai` must not freeze cleanup.
const GREPAI_TIMEOUT: Duration = Duration::from_secs(30);

/// Parses grepai's `file:line: content` output into `// file: <path>\n<lines>`
/// snippets, grouped by file in first-seen order. Mirrors VS Code's
/// `parseGrepaiOutput` + `ContextProvider` formatting so both hosts feed
/// `CleanupService` the same `<context>` shape.
pub(crate) fn parse_grepai_output(output: &str) -> Vec<String> {
    let mut order: Vec<String> = Vec::new();
    let mut by_file: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for line in output.lines() {
        if line.trim().is_empty() {
            continue;
        }
        // `file:line: content` — split on the first two colons.
        let Some((file, rest)) = line.split_once(':') else { continue; };
        let Some((num, content)) = rest.split_once(':') else { continue; };
        if num.trim().parse::<u64>().is_err() {
            continue; // not a line-numbered grep line
        }
        let file = file.to_string();
        if !by_file.contains_key(&file) {
            order.push(file.clone());
        }
        by_file.entry(file).or_default().push(content.trim().to_string());
    }
    order
        .into_iter()
        .map(|file| format!("// file: {file}\n{}", by_file.remove(&file).unwrap().join("\n")))
        .collect()
}

/// Runs `program search <query> --limit <limit>` in `cwd`, bounded by `timeout`,
/// and returns captured stdout. `program` is a parameter so tests can drive it
/// against coreutils (`true`/`false`) without the `grepai` CLI installed.
fn run_grepai(program: &str, query: &str, cwd: &str, limit: u32, timeout: Duration) -> Result<String, String> {
    let mut child = Command::new(program)
        .args(["search", query, "--limit", &limit.to_string()])
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("{program} spawn failed: {e}"))?;

    let mut stdout = child.stdout.take().ok_or("no stdout pipe")?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        let _ = tx.send(buf);
    });

    match rx.recv_timeout(timeout) {
        Ok(out) => match child.wait() {
            Ok(status) if status.success() => Ok(out),
            Ok(status) => Err(format!("{program} search exited with {status}")),
            Err(e) => Err(format!("{program} wait failed: {e}")),
        },
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(format!("{program} search timed out after {timeout:?}"))
        }
    }
}

/// Resolves scope for `query` against the repo at `cwd` via the `grepai` CLI.
/// Returns formatted `// file: …` snippets, or `[]` on any failure (grepai not
/// installed, no `.grepai/` index, non-zero exit, timeout) — the caller degrades
/// to a prompt without `## Scope`. Runs on the blocking pool (grepai blocks).
#[tauri::command]
pub async fn grepai_search(query: String, cwd: String, limit: u32) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        match run_grepai("grepai", &query, &cwd, limit, GREPAI_TIMEOUT) {
            Ok(out) => parse_grepai_output(&out),
            Err(e) => {
                eprintln!("[Verba] grepai scope resolution failed ({e}); no ## Scope");
                Vec::new()
            }
        }
    })
    .await
    .unwrap_or_else(|e| {
        eprintln!("[Verba] grepai_search task panicked: {e}");
        Vec::new()
    })
}
```

- [ ] **Step 4: Command registrieren**

In `apps/macos/src-tauri/src/lib.rs`: `mod grepai;` (bei den anderen `mod`-Zeilen, alphabetisch nach `mod env;`) und in `tauri::generate_handler![...]` `grepai::grepai_search,` ergänzen (z. B. direkt nach `env::env_var,`).

- [ ] **Step 5: Tests + Build ausführen — müssen bestehen**

Run: `cd apps/macos/src-tauri && cargo test --lib grepai 2>&1 | tail -20`
Expected: PASS (parse + run_grepai gegen coreutils).
Run: `cd apps/macos/src-tauri && cargo check 2>&1 | tail -5`
Expected: PASS (Command registriert, kompiliert).

- [ ] **Step 6: Commit**

```bash
git add apps/macos/src-tauri/src/grepai.rs apps/macos/src-tauri/src/lib.rs
git commit -m "✨ feat(macos): nativer grepai_search-Command für Scope-Auflösung (analog herdr)"
```

---

## Task 4: macOS-Wiring — Snippets in den Cleanup-Kontext

**Files:**
- Modify: `apps/macos/src/config/verbaConfig.ts` (neue `agentContextSnippets`, `DetectedSurface`-Import)
- Modify: `apps/macos/src/wiring.ts` (cleanup-`process`-Wrapper nutzt Snippets)
- Test: `apps/macos/src/test/unit/verbaConfig.test.ts`

**Interfaces:**
- Consumes: `DetectedSurface.cwd` (Task 2), Command `grepai_search` (Task 3), `CleanupService`-`contextSnippets` (vorhanden).
- Produces: `export async function agentContextSnippets(surface: DetectedSurface, template: Template, invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>, limit: number, query: string): Promise<string[]>`

- [ ] **Step 1: Failing tests schreiben**

In `apps/macos/src/test/unit/verbaConfig.test.ts` ergänzen (Import `agentContextSnippets` oben zur bestehenden `@verba/core`/verbaConfig-Import-Gruppe hinzufügen; `DetectedSurface`, `Template` aus `@verba/core`):

```typescript
import { agentContextSnippets } from '../../config/verbaConfig';
import type { DetectedSurface } from '@verba/core';

suite('agentContextSnippets', () => {
	const ctxTemplate: Template = { name: 'Agent Instruction', prompt: 'A', contextAware: true };
	const plainTemplate: Template = { name: 'Freitext', prompt: 'F' };
	const agentSurface: DetectedSurface = { class: 'agent', agent: 'claude', paneId: 'wW:p1', cwd: '/repo/verba' };

	test('agent surface + contextAware + cwd → invokes grepai_search and returns snippets', async () => {
		const calls: Array<Record<string, unknown> | undefined> = [];
		const invoke = (async (_cmd: string, args?: Record<string, unknown>) => {
			calls.push(args);
			return ['// file: src/a.ts\nok'];
		}) as <T>(c: string, a?: Record<string, unknown>) => Promise<T>;
		const snippets = await agentContextSnippets(agentSurface, ctxTemplate, invoke, 5, 'fix the cache');
		assert.deepStrictEqual(snippets, ['// file: src/a.ts\nok']);
		assert.deepStrictEqual(calls[0], { query: 'fix the cache', cwd: '/repo/verba', limit: 5 });
	});

	test('non-agent surface → no grepai call, empty', async () => {
		let called = false;
		const invoke = (async () => { called = true; return []; }) as <T>(c: string, a?: Record<string, unknown>) => Promise<T>;
		const snippets = await agentContextSnippets({ class: 'generic' }, ctxTemplate, invoke, 5, 'q');
		assert.deepStrictEqual(snippets, []);
		assert.strictEqual(called, false);
	});

	test('agent surface without cwd → no grepai call, empty', async () => {
		let called = false;
		const invoke = (async () => { called = true; return []; }) as <T>(c: string, a?: Record<string, unknown>) => Promise<T>;
		const snippets = await agentContextSnippets({ class: 'agent', agent: 'claude' }, ctxTemplate, invoke, 5, 'q');
		assert.deepStrictEqual(snippets, []);
		assert.strictEqual(called, false);
	});

	test('non-contextAware template → no grepai call, empty', async () => {
		let called = false;
		const invoke = (async () => { called = true; return []; }) as <T>(c: string, a?: Record<string, unknown>) => Promise<T>;
		const snippets = await agentContextSnippets(agentSurface, plainTemplate, invoke, 5, 'q');
		assert.deepStrictEqual(snippets, []);
		assert.strictEqual(called, false);
	});

	test('grepai_search rejects → degrades to empty (no throw)', async () => {
		const invoke = (async () => { throw new Error('grepai missing'); }) as <T>(c: string, a?: Record<string, unknown>) => Promise<T>;
		const snippets = await agentContextSnippets(agentSurface, ctxTemplate, invoke, 5, 'q');
		assert.deepStrictEqual(snippets, []);
	});
});
```

- [ ] **Step 2: Tests ausführen — müssen fehlschlagen**

Run: `cd apps/macos && npm run test:unit 2>&1 | tail -20`
Expected: FAIL — `agentContextSnippets` existiert nicht.

- [ ] **Step 3: `agentContextSnippets` implementieren**

In `apps/macos/src/config/verbaConfig.ts`: `DetectedSurface` zum `@verba/core`-Import hinzufügen und die Funktion (z. B. nach `templateForSurface`) einfügen:

```typescript
/**
 * Resolves scope snippets for an agent surface via the native grepai command.
 * Returns [] — no `## Scope` — when the template is not contextAware, the surface
 * is not an agent with a resolvable repo root, or grepai fails/finds nothing.
 * Graceful degradation: never throws (TF-531 AC6).
 */
export async function agentContextSnippets(
	surface: DetectedSurface,
	template: Template,
	invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
	limit: number,
	query: string,
): Promise<string[]> {
	if (!template.contextAware || surface.class !== 'agent' || !surface.cwd) {
		return [];
	}
	try {
		return await invoke<string[]>('grepai_search', { query, cwd: surface.cwd, limit });
	} catch (err) {
		console.warn('[Verba] grepai scope resolution failed, proceeding without ## Scope:', err);
		return [];
	}
}
```

- [ ] **Step 4: Tests ausführen — müssen bestehen**

Run: `cd apps/macos && npm run test:unit 2>&1 | tail -20`
Expected: PASS (fünf neue `agentContextSnippets`-Tests grün, Rest unverändert).

- [ ] **Step 5: Wiring anschließen (`wiring.ts`)**

Den cleanup-`process`-Wrapper in `apps/macos/src/wiring.ts` ersetzen. Aktuell:

```typescript
			process: async (transcript, context, signal) => {
				const cfg = configState.current;
				let surfaceClass: SurfaceClass = 'generic';
				try {
					const surface = await invoke<DetectedSurface>('detect_surface', {
						agentMarkers: cfg.agentMarkers,
						terminalApps: cfg.terminalApps,
						editorApps: cfg.editorApps,
					});
					surfaceClass = surface.class;
				} catch (err) {
					console.warn('[Verba] surface detection failed, using active template:', err);
				}
				const template = templateForSurface(cfg, surfaceClass);
				return cleanup.process(transcript, cleanupContextFor(cfg, context, template), signal);
			},
```

Ersetzen durch (behält die volle `surface`, holt Snippets, speist sie ein):

```typescript
			process: async (transcript, context, signal) => {
				const cfg = configState.current;
				let surface: DetectedSurface = { class: 'generic' };
				try {
					surface = await invoke<DetectedSurface>('detect_surface', {
						agentMarkers: cfg.agentMarkers,
						terminalApps: cfg.terminalApps,
						editorApps: cfg.editorApps,
					});
				} catch (err) {
					console.warn('[Verba] surface detection failed, using active template:', err);
				}
				const template = templateForSurface(cfg, surface.class);
				const contextSnippets = await agentContextSnippets(surface, template, invoke, SCOPE_SEARCH_LIMIT, transcript);
				return cleanup.process(transcript, cleanupContextFor(cfg, { ...context, contextSnippets }, template), signal);
			},
```

Oben in `wiring.ts` `agentContextSnippets` zum Import aus `./config/verbaConfig` hinzufügen und eine Konstante definieren (z. B. bei den Modul-Konstanten):

```typescript
/** Max. Code-Snippets für die Agent-Scope-Auflösung (grepai --limit). */
const SCOPE_SEARCH_LIMIT = 5;
```

> `cleanupContextFor` spreitet `context` (`{ ...context, templatePrompt }`), sodass `contextSnippets` durchgereicht wird; `CleanupService` lässt einen leeren `contextSnippets`-Array weg (kein `<context>`), also ist die Degradation automatisch korrekt.

- [ ] **Step 6: Typecheck + Tests + Core-Rebuild**

Run: `npm run compile:core && cd apps/macos && npm run typecheck && npm run test:unit 2>&1 | tail -15`
Expected: PASS (Typecheck sauber, alle macOS-Unit-Tests grün).

- [ ] **Step 7: Commit**

```bash
git add apps/macos/src/config/verbaConfig.ts apps/macos/src/wiring.ts apps/macos/src/test/unit/verbaConfig.test.ts
git commit -m "✨ feat(macos): Agent-Scope-Snippets via grepai in den Cleanup-Kontext einspeisen"
```

---

## Task 5: UAT-Dokument

**Files:**
- Create: `docs/superpowers/uat/2026-07-26-tf-531-agent-prompt-template.md`

**Interfaces:**
- Consumes: das fertige Feature (Tasks 1–4).
- Produces: manuelles Abnahme-Skript (LLM-Struktur/Pfad-Treue ist nicht unit-testbar).

- [ ] **Step 1: UAT-Dokument schreiben**

Datei mit folgendem Inhalt anlegen:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/uat/2026-07-26-tf-531-agent-prompt-template.md
git commit -m "📚 docs(tf-531): UAT-Skript für Agent-Prompt-Template"
```

---

## Self-Review (vom Autor durchgeführt)

**Spec-Coverage:** AC-Template evolviert → T1. AC-Struktur/omit/Ziel-Pflicht → T1 (Prompt) + Lock-Test. AC-keine-erfundenen-Pfade → T1 (Prompt) + UAT. AC-VS-Code-Scope → vorhandener `ContextProvider` (unverändert, in UAT verifiziert). AC-macOS-Scope (Repo aus herdr, Feldregel) → T2 + T3 + T4. AC-Degradation → T3 (grepai leer) + T4 (`agentContextSnippets` []). AC-Auto-Wahl → `Agent Instruction` ist bereits Agent-Default (T1 ändert nur den Prompt). AC-Unit-Tests → T2 (Feldwahl), T3 (parse), T4 (Degradation). AC-UAT → T5.

**Placeholder-Scan:** keine TBD/TODO; jeder Code-Step enthält vollständigen Code.

**Typ-Konsistenz:** `pane_repo_root`/`HerdrAgent.repo_root`/`Surface::Agent.cwd`/`DetectedSurface.cwd`/`agentContextSnippets`-Signatur durchgängig identisch verwendet. `grepai_search`-Wire (`{query, cwd, limit}` → `string[]`) in T3 definiert und in T4 exakt so aufgerufen. Snippet-Format `// file: …\n…` in T3 erzeugt und im T4-Test erwartet.
