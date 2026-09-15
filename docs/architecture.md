# Architecture — v0.0.2

## Dependency direction

```text
apps/cli ──> storage ──> core
    └──────> models  ──> core
```

`core` contains deterministic value transformations and validation, not file/network I/O. `storage` owns the SQLite transaction boundary. `models` can propose edits but cannot approve them or write the database. The CLI acts on explicit user commands. Native Ollama and Chat Completions-compatible providers have bounded HTTP transport, but cannot reach storage. See provider-protocol.md and security-model.md. This is not yet an autonomous research runtime.

The mono-repository uses pnpm workspace dependencies, TypeScript NodeNext ESM and project references. It has two direct development dependencies and no third-party runtime dependencies. Tests use Node's built-in test runner instead of adding Vitest at this bootstrap stage. ESLint and richer editor tooling can be added in a scoped follow-up.

## One authority, not two competing versions of the manuscript

SQLite is authoritative in this preview. `documents.head_revision_id` points to a stored revision snapshot. Exports are copies; importing a file creates a new document and does not reconcile an existing document. No file watcher, auto-overwrite, or Git synchronization is implied.

Each snapshot stores ordered text blocks:

```ts
{ id, version, text, separator }
```

Blank lines form the initial boundaries. `text + separator` is concatenated verbatim; original CRLF/LF, combining characters and ordinary UTF-8 text are not normalized. A UTF-8 BOM is retained. This is **not Markdown AST parsing**: blank lines inside fenced code can form block boundaries. Accepted text may introduce blank lines but retains its block identity. Structural parsing is a later migration.

## Proposal lifecycle

`proposeChanges(documentId, baseRevisionId, edits, providerId)` verifies that the entire response was generated against the current head, validates the full batch, then stores pending changes. A failure stores no portion of the batch.

```text
pending ──accept──> accepted ──revert──> reverted
   └──────reject─────────────────────> rejected
```

No other transitions are allowed. Reverting creates a *new* content revision and decision; it does not erase history.

The initial same-batch constraint is one edit per block. Accepting change A uses only A's block precondition, so change B targeting an unchanged different block remains applicable. For a target block, both exact text and its monotonic `version` must match. This prevents an ABA hazard: A → B → A has the same characters but is **not** the old block version.

Reverts require the currently accepted block version. A later modification of the same block causes an explicit conflict, even after its characters return to a prior value. This is intentionally conservative, not automatic rebase.

## Transaction and schema boundary

The database has `workspace`, `documents`, `revisions`, `changes`, `decisions` tables. `PRAGMA application_id` identifies the format and `PRAGMA user_version=1` identifies the schema. Unknown formats/versions are rejected; the preview contains no destructive migration.

Writes use `BEGIN IMMEDIATE` with a busy timeout, parameterized SQL, foreign keys, WAL and `synchronous=FULL`. Content-changing decisions write a revision, advance the document head, change the proposal status, and append a decision in the same transaction. SQL triggers prevent accidental UPDATE/DELETE on revision and decision tables. They are not tamper-proof security against someone who controls the database file.

Snapshots duplicate document content per revision. This is acceptable for a correctness-focused prototype and is not a scalable storage format for years of long manuscripts. Future optimization must preserve event semantics and include migration tests.

## Semantic layer, deliberately separated

`reviewTextChange()` produces `lexical-v1` hints only. Exact revision safety is independent of those hints. A missed or false lexical hint cannot break rollback. The four initial categories are uncertainty/attribution removed, causality added and scope marker removed.

Not yet implemented: Claim Ledger, reference snapshots, evidence-to-claim support, intention contracts, semantic argument matching, sentence-level patch identity, semantic evaluation on human-labeled writing datasets.

## Privacy and future tools

The scripted adapter remains offline. The two HTTP adapters make a single bounded, explicit request. CLI suggest previews unless --send is supplied; remote requests additionally require --allow-remote and HTTPS. The application revalidates responses and the current document head before persisting pending changes. Decision reasons persist locally but are not automatically learned as preferences. There is no MCP host, Skills execution, browser automation or shell tool exposed to models. Future research content must be treated as untrusted data; external tools need explicit capability scopes, approval gates and budget limits. API secrets are read from named process environment variables only at send time and must not enter project source or user manuscript files. No key store or dotenv loader is provided. Model notes are transient and unverified. HTTP limits do not constitute a calibrated cost/quality guarantee.

## Future desktop integration

React/Tauri remain candidates, not dependencies in this build. The current storage API is synchronous and must not later run lengthy operations on a desktop UI thread. A future host should isolate persistence and model work in an appropriate process/worker and define an event protocol.
