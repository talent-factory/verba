# Design: Adaptive Personal Dictionary (TF-263)

## Summary

A new command `dictation.generateGlossary` scans the workspace for project-specific terms and generates glossary suggestions. Users review and approve terms via a Multi-Select Quick Pick. Approved terms are merged into `.verba-glossary.json`, building on the existing glossary infrastructure.

## Architecture

### New Module: `glossaryGenerator.ts`

A single `GlossaryGenerator` class with one public method:

```typescript
generate(workspaceRoot: string, existingTerms: string[]): Promise<string[]>
```

Internally split into three private scan methods:

- `_scanMetadata(root)` — reads `package.json`, `pom.xml`, `pyproject.toml`
- `_scanSymbols(root)` — regex-based extraction from `**/*.{ts,java,py}`
- `_scanDocs(root)` — headings and bold terms from `README.md`, `CLAUDE.md`

Returns: deduplicated, alphabetically sorted `string[]` with existing glossary terms filtered out.

### Command Integration

New command `dictation.generateGlossary` ("Verba: Generate Glossary from Project") registered in `package.json` and `extension.ts`.

**Workflow:**

1. Call `GlossaryGenerator.generate(workspaceRoot, currentGlossary)` with progress notification
2. If no terms found: show info message, done
3. Show Multi-Select Quick Pick (all terms pre-selected)
4. Load existing `.verba-glossary.json` (or empty array)
5. Merge selected terms, deduplicate, sort, write back
6. Call `applyGlossary()` so Whisper + Claude update immediately
7. Info message: "X terms added to glossary"

## Scan Details

### Metadata Extraction

| File | Extracted Terms |
|------|----------------|
| `package.json` | `name`, keys from `dependencies` + `devDependencies` (without `@` prefix/version) |
| `pom.xml` | `<artifactId>`, `<groupId>` values via regex |
| `pyproject.toml` | `[project] name`, dependency names via regex |

### Symbol Extraction (Regex)

| Language | Pattern |
|----------|---------|
| TypeScript | `/(?:export\s+)?(?:class\|interface\|enum\|type\|function)\s+(\w+)/g` |
| Java | `/(?:public\|private\|protected)?\s*(?:class\|interface\|enum)\s+(\w+)/g` |
| Python | `/^(?:class\|def)\s+(\w+)/gm` (top-level only, no `_`-prefixed) |

File patterns: `**/*.{ts,java,py}`
Excludes: `node_modules`, `dist`, `out`, `.git`, `.verba`

### Documentation Extraction

From `README.md` and `CLAUDE.md`:

- Markdown headings: `/^#{1,3}\s+(.+)$/gm`
- Bold terms: `/\*\*([^*]+)\*\*/g`

## Filtering

- Terms shorter than 3 characters removed
- Generic stopwords excluded (`index`, `main`, `test`, `App`, `constructor`, etc.)
- Already existing glossary terms excluded
- Deduplicated via `Set`

## Testing Strategy

- **Unit tests** for `GlossaryGenerator`: each scan method tested with fake file contents (string input, no filesystem needed)
- **Filter logic**: dedicated tests for deduplication, length filter, stopword exclusion
- **Integration**: command registration tested like existing commands

No changes to existing tests — feature is purely additive.

## Decisions

- **Scope:** Full scan (metadata + symbols + docs) in v1
- **Parsing:** Regex-based, no AST parsers or Language Server dependency
- **Review UX:** Multi-Select Quick Pick with all terms pre-selected
- **Incremental updates:** Deferred to follow-up (manual command only in v1)
- **Architecture:** Monolithic service, internal method separation. Refactor to registry pattern if more sources added later.
