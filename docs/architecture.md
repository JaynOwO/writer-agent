# Architecture — Siglum v0.0.8

## Dependencies and authority

```text
apps/cli -> storage -> core
       \-> models  -> core
```

`core` validates text, revisions, source value types, static extraction and bounded source context. `storage` owns one SQLite database and all transactions. `models` receives immutable value snapshots and returns untrusted proposals; it has no database or approval handles. CLI source HTTP is a host capability invoked only by explicit `source add/refresh --fetch`. It is not a model tool or autonomous crawler.

The product name is Siglum. Repository `JaynOwO/writer-agent`, workspace directory `.writer`, pnpm packages `@writer-agent/*` and `writer` command alias stay unchanged. `pnpm siglum` is an additional root script. v0.0.8 adds pinned official MCP SDK and OS credential binding dependencies with a genuine pnpm lockfile update. NodeNext ESM/project references, Node's built-in test runner/SQLite, and the existing compiler remain in use.

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

Storage/extraction are synchronous and must not later block a desktop UI thread. Future desktop hosts need an appropriate process/worker and explicit capabilities. GUI, streaming, unrestricted automatic tool execution, passive learning and factual certification are not implemented. v0.0.7 adds bounded selected Skills/MCP below. v0.0.5 adds explicit author-confirmed intent and candidate-based memory below.

## v0.0.4 analysis layer

Schema v3 adds ledger_claims, claim_occurrences, claim_decisions, analysis_runs, analysis_feedback and claim_evidence without rebuilding previous tables. Payloads are JSON with integrity hashes and append-only triggers. Claims have multiple explicitly linked immutable occurrences; model equivalence mappings do not silently join claim identities. Manual annotations are human-authored; extracted annotations begin as candidates. Confirming an annotation is not certifying truth. Corrections append new occurrences and supersede old ones.

The host captures pending change fingerprints, document head, selected blocks, explicit sources, important claims and an annotation stamp. It builds a proposed snapshot without editing stored text. Separate claim-extraction/semantic-review methods reuse bounded transport, not Proposal Protocol v1. Schemas reject extra fields; exact UTF-16 quote anchors and local references are independently validated. JSON duplicate keys and deep nesting are refused for these new tasks. Returned reasoning text is a concise review explanation, not hidden chain-of-thought.

Before persistence, the host reconstructs the capture and checks document, pending status, claim decisions and source context atomically. No transaction spans HTTP. Successful reports retain inputs, outputs, prompt/protocol versions, selected model/endpoint/settings, duration and returned usage (unknown is null). Failed/cancelled/invalid/stale runs create no current report. Review cannot approve edits or mutate source evidence.

Exact prefix/suffix replacement spans are mechanical observations, not a minimal diff algorithm or semantic judgments. Reports display model mappings/findings/assessments separately. Feedback on a finding, mapping or assessment is immutable and never changes a manuscript approval. Later manuscript revisions or selected pending-status changes invalidate current review status; extraction reports retain candidate history. An important-claim decision changes the review stamp. An unrelated source refresh leaves old pinned-material analysis about the old material, not an evaluation of the new material.

The input/response cap is 6,000,000 serialized UTF-8 bytes, not a context-window guarantee. There are at most 100 candidates per side/findings, 200 mappings/assessments, 8 anchors per item and 80,000 bytes of selected source context. Small local models may not reliably output exact offsets or the schema; there is no silent repair or fallback. See analysis-protocol.md and review.md.

## v0.0.5 intent and writing memory

Schema4 adds writing_profiles, profile_bindings, intent_versions/intent_confirmations, preference_versions, memory_task_runs, guidance_uses/change_guidance and decision_reasons. Existing manuscript/source/analysis tables and IDs are not rebuilt. The shared transaction boundary protects model proposals plus selected source/guidance provenance. DB bindings/versions are immutable records with integrity hashes; the database owner can still tamper with storage, so hashes are not adversarial authenticity proofs.

WritingMemory uses existing ledger claims for important occurrences rather than inventing another claim identity. A confirmed card persists across edits, but stale referenced occurrences require an explicit card/annotation change. Profile rules are scoped by author-chosen language/task. Defaults never mean all profiles. buildMemoryPlan is a pure bounded deterministic selector; singleton conflicts are exact-value comparisons, not semantic entailment.

Model tasks draftIntent/draftPreferences are separate from propose/analyze. Validation permits only selected feedback IDs/quoted brief spans and explicit suggestion labels. Outputs remain drafts/candidates. Model requests never receive the store. Ordinary suggestions/semantic analysis get pinned guidance; unrelated profile changes do not invalidate them, applicable changes do. Legacy analysis input without guidance is retained unchanged, not falsely upgraded.

The numbered guide calls the same CLI service functions, captures a request before confirmation and submits that exact capture, not a fresh unnoticed selection. readline is terminal-only; EOF/Ctrl+C cancels, control sequences are filtered at the interactive display boundary. No full-screen TUI, GUI, background task or runtime Git is added. See memory-protocol.md and the paired memory guides.

## v0.0.6 fixed writing workflows

Schema5 adds workflow_runs, workflow_grants, workflow_attempts, workflow_artifacts and workflow_events; it does not rebuild earlier tables. Workspace.workflows owns durable state. Runs/attempts evolve with integrity hashes; artifacts/events are append-only. The private Workspace transaction helper uses SAVEPOINTs for nested local units of work, so a source/proposal/report/manuscript side effect and its workflow checkpoint commit atomically. Network calls never execute inside these transactions.

The foreground host runner is apps/cli/src/workflow-runtime.ts, shared by commands and the numbered guide. Pure core types/validators define stage tasks, source policy and output schemas. Models add workflowTask, which has no persistence/approval capabilities. TavilySearch adds one fixed API capability: direct basic Search, with no account mutation or SDK. Extracted public URL policy is shared with original source-http; the pinned-DNS/connection implementation is retained.

Each stage grant captures exact input/guidance, model settings, source scope, optional revision and remaining attempt/time limits. A saved outline is approved separately from composition consent. New drafts are artifacts, not documents; explicit adoption creates a document/profile/intent and an adoption event atomically. Repeated adoption returns the same document. Existing-article alternatives retain the original baseline; review-only creates no edit.

One run has an owner/generation/45-second lease. Every result checks it plus input freshness before commit. Attempt state is persisted as reserved then dispatched before external effects; recovery labels abandoned dispatched attempts outcome-unknown and fences old writers. Explicit retry records acknowledgement and preserves spent quotas. Completed artifacts are keyed by request/task version, model settings and relevant epoch; matching public discovery/fetch steps can survive a private direction refresh. Budget-only changes need a fresh grant but preserve result cache keys. Late/untrusted/invalid outputs cannot approve text or become current artifacts.

Search planning sees only the public brief. Search results remain discoveries; fetched page bytes/excerpts use the existing SourceLibrary. A capped selection with omission reasons, not snippets, reaches content tasks. Query-plan, outline, draft, draft-review and draft-revision are separate structured requests; parent outputs and quotations are validated. Workflow code does not call shell/Git, load scripts from sources or activate preferences. See workflow-protocol.md and paired workflows guides.

## v0.0.7 extension/research layer

Optional config.extensions enables immutable Skill captures and explicit MCP call descriptors in the existing WorkflowStore fingerprint. Core defines constrained schemas and research/citation value transformations; ExtensionStore stores packages, activation/trust/catalogue events, original third-party provenance, derived index cache and citation maps in the same schema6 database. Existing source/model/memory APIs remain authoritative. SDK-backed MCP transport is an isolated CLI host adapter, not a model capability handle. It uses explicit protocol dates and a documented host capability/schema subset. Unsupported schema assertions exclude tools.

Workflow research uses the existing reserve/dispatched/complete path for MCP reads as well as built-in fetch/search. MCP attempts share the fetch/read quota and have exact author-selected arguments. Discovery is performed before actual calls; observed relevant changes revoke old descriptor usability. The client cannot prevent a server from lying or constrain a trusted child with user OS access. Returned text is imported as a file-kind source with an immutable source_provenance row and origin in SourceContext; it is not a Siglum direct web capture. No result URL or source instruction executes a new capability.

Enhanced research indexes complete bounded saved source text. Search discovery is sorted by literal relevance and host diversity, with URL/snippet dedup; fetched text dedups by hash. Window selection has exact original line/UTF16 anchors, neighbor context and omissions, not source-truth scores or complete semantic retrieval. New research query commands persist derived indexes and exact excerpt records; they do not invoke models.

Chapter requests retain author-approved global outline/guidance and selected chapter source identities. Chapters each consume a model attempt. Host assembly maps local display references onto the frozen master selection, then saves a host artifact and citation map atomically. Whole-candidate review is bounded; no silent partial-review success. Citation-map sourceEntry quote associations are candidates, not per-claim support. Marker/neighbor offsets are structural, not a natural-language/Markdown parser. Adoption creates the manuscript/map/checkpoint together; later manuscript revisions mark maps stale.

Old tasks omit extension fields and retain old hashes/behavior. Migration1..5->6 is additive and explicit, never run by code installation. Independent-server conformance, Windows subprocess cleanup and real-model research quality require separate evidence. See extensions-protocol.md and the paired extension guides.

## v0.0.8 shared product services

CLI product commands, numbered guides, and future view adapters share applications under apps/cli/src/application. This is incremental extraction, not a second runtime or a new network server. The existing foreground runner owns grants, lease fencing, attempts and transactions.

ConnectionStore owns user-level connections.sqlite schema1, independent of workspace schema6. Versioned settings have a credential mode/ref, not a key. A local binding fixes workspace identity/path, run, slot, preset version and destination hash; merely importing a reference cannot unlock local credentials. Host-only resolver/assertCurrent callbacks check local versions before/after inference and during workflow pulses, and are omitted from provider descriptions and prompts. No network wait holds either database transaction. OS writes use random entry journals; compensation removes only this operation's unreferenced item. Explicit self-tests have their own recoverable journal. Session credentials are process-local, and Linux OS storage requires Secret Service explicitly.

Official MCP SDK2.0.0 owns Client/lifecycle. Host bounded Transport/fetch maintains byte limits, strict schema assertions, callback rejection, endpoint policy and limited child environment. Former native protocol execution is removed; old fingerprints cannot silently authorize the new adapter. Ordinary models and offline commands do not require loading a keyring or connecting SDK transports.

Optional workflow navigationSummary adds one successful cached navigation artifact per input through the existing budgeted attempt mechanism. It pins source quotes and fallible notes. Selected original evidence remains in outline/draft/review requests; summary adds navigation, not a promised net compression or fact certificate. Chapter projection drops notes missing any referenced source. Legacy omitted fields keep original decoding/hash behavior.

Static report snapshots are assembled from explicit content-group flags, escaped, rendered without JS/remote resources and published without overwriting. Generated status is frozen, not real time. Source/guidance fields are omitted when not selected, but model/manuscript prose may already reproduce private content; this is not semantic redaction. Product diagnostics use metadata only by default. Explicit probes have nonsecret durable state; model trials use disposable synthetic workspaces, MCP checks do discovery only, and keyring self-test never enumerates other apps.
