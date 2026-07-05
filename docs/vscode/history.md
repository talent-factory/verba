# Dictation History

Verba keeps a persistent, searchable history of your past dictations — both the raw transcript and the cleaned (post-processed) text — so you can revisit, re-insert, or copy something you dictated earlier.

!!! note "Privacy"
    History stays entirely local, persisted via VS Code's `globalState`. It is never sent to Deepgram, Anthropic, or any other API.

## Commands

| Command | Description |
|---------|-------------|
| **Verba: Dictation History** (`dictation.showHistory`) | Browse recent dictations in a Quick Pick, filter, and act on an entry |
| **Verba: Search Dictation History** (`dictation.searchHistory`) | Full-text search across all dictations — matches both the raw transcript and the cleaned text |
| **Verba: Clear Dictation History** (`dictation.clearHistory`) | Delete all saved dictations (with confirmation) |

## Acting on an Entry

Selecting a history entry (from either browse or search) offers three actions:

- **Insert into Editor** — insert the cleaned text at the current cursor position.
- **Copy to Clipboard** — copy the cleaned text without inserting it.
- **Show Details** — view the full transcript, cleaned text, template used, and timestamp.

## Configuring History Size

By default, Verba keeps up to 500 entries. Configure the limit in `settings.json`:

```json
{
  "verba.history.maxEntries": 500
}
```

Once the limit is reached, the oldest entries are removed automatically to make room for new ones.
