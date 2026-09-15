# Claim extraction and semantic review protocol v1

These tasks are separate from the unchanged [editing Proposal Protocol v1](provider-protocol.md). All three can use the same explicitly selected Ollama native or OpenAI Chat Completions-compatible adapter. Neither new task returns an executable edit or receives a storage capability.

## Host packet

`AnalysisRequest` is an immutable JSON value captured by the application:

- `protocolVersion: 1`, `task: "claim-extraction" | "semantic-review"`;
- `documentId`, `baseRevisionId`, `instruction`;
- `scope: "blocks" | "document"`, original `documentBlockCount`;
- inspected `before: Snapshot`, proposed `after: Snapshot | null`;
- `changes: { id, hash }[]`, `sources: SourceContextItem[]`;
- `protectedClaims: {claimId, occurrenceId, statement, anchors}[]`;
- `excludedProtectedClaimIds: string[]`, `ledgerStamp`.

Only the selected data fields, explicit author brief and identifying scope enter the model user message. `changes` hashes and `ledgerStamp` are host-side preconditions, not model decisions. No notes, raw HTML, environment values, hidden files or arbitrary database records are silently included. Current confirmed important occurrences are explicit author constraints, not inferred preferences. Multiple occurrences can express the same claim. Excluded important claims cannot be treated as checked.

The host constructs `after` by applying compatible pending block changes to a captured revision in memory. It does not save a content revision. Requests are bounded and copied before any asynchronous call; persistence independently rebuilds and checks the packet against current state after inference. Sources are pinned selections, not live URLs.

## Anchors

`TextAnchor` contains exactly `{blockId, start, end, quote}`. Offsets are UTF-16 code units within block text; end is exclusive. They must be integers, in range, at surrogate boundaries, and describe the exact quote. Multiple anchors are allowed; duplicate coordinates are refused. The host adds `blockVersion` and `quoteHash` when saving an occurrence.

A `SourceQuote` is `{itemIndex, start, end, quote}` with offsets in the exact selected source-context item's text. `itemIndex` is zero-based. The enclosing packet pins source/snapshot/excerpt identifiers and hashes, so no model can cite an unselected arbitrary record. Coordinates refer to extracted text, not PDF pages or original HTML source locations.

## Extraction response

The only top-level fields are:

```json
{
  "protocolVersion": 1,
  "task": "claim-extraction",
  "documentId": "doc_example",
  "baseRevisionId": "rev_example",
  "candidates": [],
  "notes": []
}
```

Each candidate has `ref`, `statement`, `kind`, `anchors`. Candidate refs are unique ASCII local identifiers within the response. Kind describes the assertion: `testable`, `inference`, `attributed`, `value-judgment`, `unclassified`. Candidate extraction is not factual approval. Empty candidates is valid.

Host-assigned run, claim and occurrence IDs are created only after complete validation. The saved extraction run and all new candidate annotations commit atomically. No partial batch is retained on invalid output, stale input or an SQL failure. Manual annotation is separately supported without calling a model.

## Semantic review response

Top-level fields:

```json
{
  "protocolVersion": 1,
  "task": "semantic-review",
  "documentId": "doc_example",
  "baseRevisionId": "rev_example",
  "beforeClaims": [],
  "afterClaims": [],
  "mappings": [],
  "findings": [],
  "assessments": [],
  "notes": []
}
```

Before and after candidates have the same shape as extraction candidates and reference their own snapshot. IDs are local to that side; the same ref string on both sides is permitted without implying identity.

A mapping contains exactly `beforeRefs`, `afterRefs`, `relation`, `explanation`. Each candidate participates exactly once across mappings. `equivalent`, `reformulated`, `reversed` are 1-to-1; `split` 1-to-many; `merged` many-to-1; `added` 0-to-1; `removed` 1-to-0. `uncertain` can represent unresolved associations. Mappings remain model assessments, not automatically accepted claim identity changes. They are reviewable with `mapping:N` feedback.

A finding contains exactly `ref`, `category`, `before`, `after`, `beforeRefs`, `afterRefs`, `sourceQuotes`, `importantClaimIds`, `explanation`. Existing sides use exact anchors; a missing side uses `[]`, never invented quotations. Categories: `certainty`, `attribution`, `scope`, `time`, `numeric`, `causality`, `claim-added`, `claim-unmapped`, `claim-reversed`, `claim-reformulated`, `evidence-shift`, `protected-claim`.

Both sides require anchors for comparison categories. A newly added claim requires after anchors; an unmapped claim requires before anchors. Evidence-shift findings require selected source quotations; protected-claim findings require valid supplied important claim IDs. Local candidate references must resolve. At least one side must contain an anchor. The host validates structure and coordinates, not whether the explanation follows from them.

An assessment is `{side, claimRef, relation, sourceQuotes, explanation}`. Each side/candidate can have at most one model assessment in this report; different reports and human assessments coexist. Relations: `not-assessed`, `supports`, `partially-supports`, `contradicts`, `insufficient`, `uncertain`. With no selected material, only not-assessed is valid. Supporting/partial/conflicting conclusions need source quotations; not-assessed must have none. Omitted assessments are displayed as not-assessed in the derived report view. Assessment feedback targets `assessment:N` without changing the original output.

## Envelope, parser and provider behavior

The selected adapter returns `{providerId, output, usage}`. The host, not the model, sets the provider ID and obtains a whitelisted `AnalysisProviderInfo` from the adapter. This records requested model, endpoint, response mode, token parameter, timeout and output-token limit, not a secret environment value. Usage fields are nullable input/output/total tokens from the response envelope. No cost estimate or calibrated confidence is generated.

Portable schemas use required fields and `additionalProperties: false`; local validation independently checks all stronger bounds, anchors, references and scope. The new task parser refuses duplicate JSON keys, including escaped equivalents, depth over 64, excessive JSON node counts, Markdown fences, trailing prose and partial JSON. Editing Proposal Protocol v1 retains its existing parser behavior.

Existing bounded transport remains authoritative: explicit send permission, HTTPS/remote opt-in, headers/body limits, timeout/cancellation, no redirects/retries, no hidden service switch. Refused/truncated/tool-call envelopes fail. There is no automatic JSON repair or paid second judge. Streaming and Responses API are not added.

## Records, feedback and freshness

Schema v3 adds `ledger_claims`, `claim_occurrences`, `claim_decisions`, `analysis_runs`, `analysis_feedback`, `claim_evidence`. Original content/source tables are retained. Payload hashes and append-only triggers protect against accidental changes, not a hostile database owner. A report retains the exact input packet and validated concise model output; no hidden reasoning trace is requested or saved.

Analysis never invokes text acceptance. Confirmation/correction of an annotation, evidence relations, report feedback and text acceptance are distinct actions. Agree/disagree/correct feedback is appended; it never revises an already-saved model assessment. Historical feedback records the actual document revision at decision time.

A review run is stale if its document revision, selected pending changes or captured claim-ledger state changes. Source refreshes do not change pinned evidence. Another brief requires another analysis; the old report remains bound to the old brief. Extraction intentionally adds ledger candidates, so its own stamp change is not used to invalidate that extraction report. Exact text restored by a later revision never resets age.

Only successful analyses are stored. Authentication failures, refusal, cancellation, timeout, invalid output or staleness produce typed errors and no successful run. Existing completed reports remain readable offline, without a new model request. Request/response bodies are private workspace data; diagnostic errors do not echo them.

## Resource and evaluation boundaries

6,000,000 serialized UTF-8 bytes for an analysis packet/output, at most 100 candidates per side/findings, 200 mappings/assessments, 8 anchors/quotes per item, 16000 quote characters, 2000 statement/explanation characters, 20 notes of 2000 characters. Source context retains 8 items/80000 bytes, original document and transport limits remain enforced. These are safety caps, not promises that every model accepts such a request. No automatic batching/truncation happens.

Correct coordinates, valid JSON, source hashes or agreement between models do not establish semantic correctness. An empty finding list is not a guarantee of unchanged meaning. Exact text observation uses a single prefix/suffix-delimited span per changed block; “quote absent in inspected scope” is not a document-wide deletion verdict. See [evaluation scaffold](../evaluation/README.md) for the explicitly unreviewed 80-case draft.
