# Architecture — Siglum v0.0.4

## Dependencies and authority

```text
apps/cli -> storage -> core
       \-> models  -> core
```

`core` validates text, revisions, source value types, static extraction and bounded source context. `storage` owns one SQLite database and all transactions. `models` receives immutable value snapshots and returns untrusted proposals; it has no database or approval handles. CLI source HTTP is a host capability invoked only by explicit `source add/refresh --fetch`. It is not a model tool or autonomous crawler.

The product name is Siglum. Repository `JaynOwO/writer-agent`, workspace directory `.writer`, pnpm packages `@writer-agent/*` and `writer` command alias stay unchanged. `pnpm siglum` is an additional root script. There are no new package dependencies or lockfile changes. NodeNext ESM/project references, Node's built-in test runner/SQLite, and the existing compiler remain in use.

## Manuscript rules retained

SQLite is canonical; Markdown import/export is explicit, not live synchronization. Snapshots contain `{ id, version, text, separator }` blocks. Initial blank-line splitting preserves original text but is not a Markdown AST. Exact block ID/text/version checks prevent stale edits, accidental overwrite and ABA. Pending -> accepted/rejected; accepted -> reverted. Each accept/revert appends a new content revision and decision; reject does not change content. Different blocks remain independent. Revision/head/change/decision updates are atomic, and history has append-only triggers.

## Source records and snapshots

Schema v2 adds sources, source_snapshots, source_excerpts, research_notes, source_bindings, proposal_contexts and change_contexts. No original manuscript table is rebuilt. Raw response/file bytes live in a bounded SQLite BLOB alongside extracted text, separate hashes, a recorded extractor version, capture time and unverified reported metadata. This makes saving evidence atomic without coordinating loose files and database transactions. File export is explicit and never overwrites.

A web source is identified by its normalized requested URL (fragment removed, query retained). Each capture appends an independent snapshot. Local files store only a basename and get a new source unless refresh is explicit. Excerpts pin exact extracted-text lines/offsets and hashes, not mutable URLs. Notes are records, not source text or preferences. Source bindings pin an excerpt to a document block version and dynamically report current/stale. Revert does not silently reapprove a citation.

Source content, excerpt and context reads validate stored hashes/structure. Append-only triggers deter accidental modification; a database owner can still bypass them. Hashes are integrity checks, not origin signatures. Full snapshots duplicate data; this is not a compact archival database for unlimited material. Library search is bounded, exact substring search of latest snapshots, not embedding retrieval.

## Source-aware provider protocol

Response Proposal Protocol v1 is unchanged. Requests gain optional bounded `sources` values. The user-data message serializes them as explicitly unverified context, separate from the editing instruction and manuscript. It never promotes page text into system instructions. A model sees only explicit selections, not raw HTML, unselected sources or private notes.

The host captures document/source snapshots before inference, passes a separate clone to the provider, validates the response, and rechecks the document head and selected source context inside the persistence transaction. Valid pending changes and their supplied-source record commit together. A stale document, bad response or invalid source context saves no partial batch. No SQLite transaction spans a network wait.

`change_contexts` links proposals to exact selected text and identifiers. The status is "supplied-not-verified". It does not claim the model used every source or that a source supports a particular sentence. Manual paragraph/excerpt links and model-context provenance are separate objects. These source relationships remain distinct from the v0.0.4 claim ledger and fallible semantic assessments. They never become truth flags.

## Web intake boundary

URL preview does not resolve DNS. An explicit request validates scheme/credentials/port/hostname, rejects local/private/special-use IP ranges, validates every DNS address and pins one address using the request's lookup callback with pooling disabled. TLS validates the original hostname. No redirects, cookies, bearer keys, embedded resources or source scripts are followed/executed. The entire operation has a deadline, supported media/charset checks, header and streamed-body limits. Compression is refused. Test dependency injection cannot be selected via URLs/CLI flags.

This is not a network sandbox or a complete SSRF audit. Public addresses may still route specially under unusual network configurations; use OS/network egress controls for stronger isolation. The static text extractor is deliberately limited, not a rendering engine or full HTML5 parser. Its version/warnings are persisted so evidence interpretation remains explicit.

## Migration and desktop future

Old schema-v1 workspaces can still use original editing, v2 still supports sources; analysis features request an explicit v3 migration. The migration previews by default, retains a verified VACUUM INTO backup, checks a cooperative lock/data version, adds tables transactionally and preserves all existing content rows. Unknown formats are refused. Source-code update bundles never migrate user data. See the paired source guides for backup and recovery boundaries.

Storage/extraction are synchronous and must not later block a desktop UI thread. Future desktop hosts need an appropriate process/worker and explicit capabilities. GUI, streaming, automatic tool execution, Skills/MCP, inferred intent, learned memory and factual certification are not implemented here.

## v0.0.4 analysis layer

Schema v3 adds ledger_claims, claim_occurrences, claim_decisions, analysis_runs, analysis_feedback and claim_evidence without rebuilding previous tables. Payloads are JSON with integrity hashes and append-only triggers. Claims have multiple explicitly linked immutable occurrences; model equivalence mappings do not silently join claim identities. Manual annotations are human-authored; extracted annotations begin as candidates. Confirming an annotation is not certifying truth. Corrections append new occurrences and supersede old ones.

The host captures pending change fingerprints, document head, selected blocks, explicit sources, important claims and an annotation stamp. It builds a proposed snapshot without editing stored text. Separate claim-extraction/semantic-review methods reuse bounded transport, not Proposal Protocol v1. Schemas reject extra fields; exact UTF-16 quote anchors and local references are independently validated. JSON duplicate keys and deep nesting are refused for these new tasks. Returned reasoning text is a concise review explanation, not hidden chain-of-thought.

Before persistence, the host reconstructs the capture and checks document, pending status, claim decisions and source context atomically. No transaction spans HTTP. Successful reports retain inputs, outputs, prompt/protocol versions, selected model/endpoint/settings, duration and returned usage (unknown is null). Failed/cancelled/invalid/stale runs create no current report. Review cannot approve edits or mutate source evidence.

Exact prefix/suffix replacement spans are mechanical observations, not a minimal diff algorithm or semantic judgments. Reports display model mappings/findings/assessments separately. Feedback on a finding, mapping or assessment is immutable and never changes a manuscript approval. Later manuscript revisions or selected pending-status changes invalidate current review status; extraction reports retain candidate history. An important-claim decision changes the review stamp. An unrelated source refresh leaves old pinned-material analysis about the old material, not an evaluation of the new material.

The input/response cap is 6,000,000 serialized UTF-8 bytes, not a context-window guarantee. There are at most 100 candidates per side/findings, 200 mappings/assessments, 8 anchors per item and 80,000 bytes of selected source context. Small local models may not reliably output exact offsets or the schema; there is no silent repair or fallback. See analysis-protocol.md and review.md.
