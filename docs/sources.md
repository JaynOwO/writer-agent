# Source library — Siglum v0.0.3

[English](sources.md) | [简体中文](sources.zh-CN.md)

This is a **local research-material workflow**, not a global search engine or an autonomous research agent. A source is data, not an instruction or a verified fact. Commands below use the `writer` compatibility alias; `siglum` is equivalent. Replace IDs shown in angle brackets with IDs printed by the preceding commands.

## First run without any network or model key

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm demo:sources
```

The last command should end with `SOURCES_DEMO_OK`. All material is synthetic, the provider is scripted and the workspace is a new temporary directory. The output gives its location and its source export location. No real research or inference is claimed.

## Create a workspace and import a source

```sh
pnpm writer init ../my-writing "My writing workspace"
pnpm writer source import ../my-writing ./examples/research-fixture.html
pnpm writer source list ../my-writing
```

A source record has `id`, `kind`, `locator` and `createdAt`. A snapshot has an independent `id`, `sourceId`, `capturedAt`, `mediaType`, `rawHash`, `textHash`, `rawBytes`, `text`, reported `metadata`, `extractor` and `warnings`. Hashes are integrity fingerprints, **not signatures or proof of authenticity**. Metadata is not externally verified; unknown fields are `null`.

Local imports support `.html`, `.htm`, `.md`, `.markdown` and `.txt`, encoded as UTF-8. Raw bytes are preserved, even when HTML text extraction differs from the original. Files have a 2,000,000-byte raw limit and extracted text has a 1,000,000-byte limit. A non-UTF-8 input is rejected rather than silently recoded. Only the basename is retained as a local locator; a private absolute filesystem path is not placed in model context.

Importing another local file with the same basename creates another source. To explicitly append to a file source, use the same basename and `--source-id <sourceId>`. A source's identity cannot be silently changed.

## Explicit single-page web capture

```sh
pnpm writer source add ../my-writing https://example.org/report
pnpm writer source add ../my-writing https://example.org/report --fetch
```

The first command is a preview: no DNS or HTTP request is made. The example URL is a placeholder, not a bundled research report. Use the final URL of a public page you are permitted to retrieve. The second command contacts that one site and saves a snapshot only after the whole response passes validation.

The intake client uses HTTP(S) on default ports, no authentication or cookies, no browser, JavaScript or embedded-resource downloads. Local, private and special-use IP addresses are blocked, every DNS answer is checked, and a single approved address is pinned to the connection. HTTP redirects are refused; inspect and supply the final URL yourself. The URL's fragment is omitted, while its path and query remain part of the source identity. Do not put secrets in URLs. TLS verification is retained. No automatic retries or proxy credential reuse occur.

The request has a 20-second total deadline, 16-KiB header limit and a bounded response body. It requests uncompressed text and refuses compressed responses. Only HTTP 200 with a supported text media type is accepted. PDFs, login/paywall flows, dynamic-only pages, non-UTF-8 text and unsupported encodings are not supported. Failures save no partial source.

```sh
pnpm writer source refresh ../my-writing <sourceId>
pnpm writer source refresh ../my-writing <sourceId> --fetch
pnpm writer source history ../my-writing <sourceId>
```

Refresh follows the same preview/consent boundary. It **appends** a snapshot; older snapshots, excerpts and model-context records remain pinned. This is not a continuously updating web mirror. Respect website terms and content rights; this version neither crawls recursively nor implements a robots-aware batch crawler.

## Inspect, search and quote

```sh
pnpm writer source show ../my-writing <snapshotId>
pnpm writer source search ../my-writing "correlation"
pnpm writer source extract ../my-writing <snapshotId> --lines 3:5
pnpm writer source excerpts ../my-writing <snapshotId>
```

`show` returns numbered extracted-text lines. An excerpt is an exact slice of that text, with 1-based inclusive lines, UTF-16 string offsets and a UTF-8 quote hash. CRLF and non-BMP characters are handled without silently relocating a quote. Lines are **not original HTML line numbers, rendered page coordinates or PDF page numbers**. Quote wording cannot be typed into an excerpt and then represented as if copied from a source.

The HTML extractor (`siglum-text-v1`) is deliberately small and dependency-free. It removes scripts/styles and selected non-text elements, recognizes ordinary text tags and common/numeric entities, and reports a warning on HTML capture. It is not an HTML5 DOM parser, accessibility tree or high-fidelity article extractor. CSS-hidden content, complex layouts, malformed nesting, tables, uncommon named entities and navigation text may differ. Inspect the raw bytes before relying on an excerpt. To avoid script execution, exports name those bytes `raw.bin`, not an executable/rendered page.

`search` is case-sensitive exact Unicode substring search over each source's latest snapshot text and reported metadata, limited to 20 results. It supports Chinese substrings but performs no stemming, ranking, embeddings or internet search. `list` shows at most 50 sources. These are bounded CLI results, not a complete listing guarantee for a large library; the storage API accepts explicit limits and per-source history is available.

## Research notes and paragraph links

```sh
pnpm writer source note ../my-writing <snapshotId> "Check whether the study supports causation" --excerpt <excerptId>
pnpm writer source notes ../my-writing <snapshotId>
pnpm writer show ../my-writing <documentId>
pnpm writer source bind ../my-writing <documentId> <blockId> <excerptId>
pnpm writer source links ../my-writing <documentId>
```

Notes are your local observations, not extracted quotes, verified facts or learned preferences. They are not automatically sent to a model.

A paragraph binding records the document/revision, block ID and monotonic block version, plus an excerpt ID. The label is `user-linked-not-verified`. If the block changes, the link is **stale**; editing a different block does not invalidate it. Reverting to identical old text does not reset block versions and therefore does not silently restore a link's approval. Create a new explicit binding after checking the revised wording. This is not a Claim Ledger or an automatic citation-support detector.

## Source-aware suggestions

```sh
pnpm writer suggest ../my-writing <documentId> --provider ollama --model <installed-model> --instruction "Make this shorter without overstating the evidence" --excerpts <excerptId>
pnpm writer suggest ../my-writing <documentId> --provider ollama --model <installed-model> --instruction "Make this shorter without overstating the evidence" --excerpts <excerptId> --send
pnpm writer changes ../my-writing <documentId>
pnpm writer provenance ../my-writing <changeId>
```

Use `--sources <snapshotId,...>` for complete saved texts and `--excerpts <excerptId,...>` for smaller selections. IDs are comma-separated with no spaces. No selection is implicit. The maximum is 8 distinct items and 80,000 UTF-8 bytes for the serialized source context (including metadata). Oversized selections are refused, never silently truncated. Choose shorter excerpts instead.

The normal provider rules still apply: preview by default, `--send` for a real request, `--allow-remote` for remote inference. See [providers](providers.md). The model receives the selected manuscript, your editing instruction and the selected source text, but not raw HTML, unselected sources, local full paths, API keys or research notes.

Sources are serialized in the user-data message, never promoted to system instructions. Models still return Proposal Protocol v1 without approval flags. A valid response saves pending edits and the exact source context **in one SQLite transaction**; a malformed response, stale document or invalid context saves neither. No transaction is held over a network wait.

Provenance records say **`supplied-not-verified`**. They show what the model had available, not what it used or what proves a claim. Source attribution in generated prose is not automatically validated. Existing source-free suggestions remain compatible and have no invented context record. Model notes remain transient, unverified opinions.

## Export and integrity

```sh
pnpm writer source export ../my-writing <snapshotId> ../saved-source
```

The destination must not exist; its parent must exist. No existing destination is overwritten. The export contains `raw.bin`, `text.txt`, `metadata.json`, `excerpts.json` and `notes.json`. Metadata includes source and snapshot identifiers and both raw/text hashes. Exporting or showing a stored snapshot checks those hashes. A hash mismatch raises `CORRUPT_DATA` instead of presenting damaged evidence. On an export I/O failure, an incomplete new directory may remain for inspection; the tool does not delete unrelated files.

Snapshots, excerpts, notes, bindings and context records use append-only tables. Triggers prevent accidental update/deletion, not deliberate tampering by someone controlling the database. Exports can contain private notes; they are not automatically uploaded, encrypted or relicensed by Apache-2.0.

<a id="existing-workspaces"></a>
## Existing workspaces

Installing v0.0.3 or running the source-code updater does **not** migrate any writing workspace. New workspaces use schema v2. Old schema-v1 workspaces still support original manuscript operations and source-free suggestions; source operations return `MIGRATION_REQUIRED` until explicitly upgraded.

Close all programs using the old workspace, especially older versions of Writer Agent. Then:

```sh
pnpm writer migrate ../my-writing
pnpm writer migrate ../my-writing --apply
```

The first command only previews. `--apply` verifies the application/schema, acquires a local migration lock, makes and checks a consistent SQLite backup using `VACUUM INTO`, then adds source tables in a single transaction. Original manuscript tables/IDs/history are not rewritten. An unknown schema is refused. A detected concurrent writer or schema failure aborts the migration; the backup remains.

The returned backup path is under `.writer/backups/schema-v1-.../workspace.sqlite`. Keep it until you have checked the migrated workspace. Backups include private manuscript data and are not encrypted. If recovery is needed, close all connections and ask for a recovery plan using that backup; do **not** copy it over a live SQLite database or mix it with stale WAL/SHM files. An interrupted migration can leave `migration.lock`; confirm no migration is running before repairing it. The tool does not guess and remove stale locks automatically.

The locking/data-version checks reduce accidental concurrent changes, but are not a security boundary against older programs or hostile local processes. Close those programs first.
