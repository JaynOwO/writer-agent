# Claims and semantic review — Siglum v0.0.4

[English](review.md) | [简体中文](review.zh-CN.md)

This is an experimental CLI workflow, not a factual certification service. The deterministic layer checks identities, exact quotations, revisions and persistence. Model interpretations of meaning and evidence remain attributed assessments. Real-model extraction/review quality has not been evaluated for this release.

## Try it without a model account

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo:review
```

In Windows PowerShell, use `pnpm.cmd` instead of `pnpm` if the PowerShell shim is blocked. Do not change your system security policy for these commands. The demo uses a scripted loopback HTTP service and synthetic sources, not a language model. It ends with `REVIEW_DEMO_OK`, retains its disposable workspace and prints the path. It tests annotation, confirmation, review, feedback without manuscript changes, explicit accept/revert, staleness and reopening.

## Prepare a workspace

New workspaces use schema v3. Updating code does not update any private writing database. Existing v1 workspaces retain original text operations; v2 retains sources. New claim/review operations require an explicit migration:

```sh
pnpm siglum migrate ../my-writing
pnpm siglum migrate ../my-writing --apply
```

The first command is a preview. Close other sessions using this workspace before the second. The migration creates a verified SQLite backup under `.writer/backups/schema-v1-…/` or `schema-v2-…/`, adds tables transactionally and preserves previous records. Do not delete an active migration lock or overwrite database/WAL files to recover from an error. Use disposable copies first; see [source migration and recovery](sources.md#existing-workspaces).

## Manual annotations

A logical claim has a host-generated `claimId`; each occurrence has its own `id`, immutable `revisionId` and exact anchors. Annotation confirmation describes the author's wording, **not whether that wording is true**. Model extraction creates candidates; manual annotation starts confirmed.

```sh
pnpm siglum show ../my-writing DOC_ID
pnpm siglum claim add ../my-writing DOC_ID ./annotation.json
pnpm siglum claim list ../my-writing DOC_ID
pnpm siglum claim show ../my-writing OCCURRENCE_ID
```

Replace the uppercase ID placeholders with actual IDs from your workspace. `annotation.json` must match the existing text, not this example by assumption. For a block containing exactly `Some teams may improve.`, the complete annotation is:

```json
{
  "ref": "manual-1",
  "statement": "Some teams may improve.",
  "kind": "inference",
  "anchors": [
    {"blockId": "ACTUAL_BLOCK_ID", "start": 0, "end": 23, "quote": "Some teams may improve."}
  ]
}
```

Positions are UTF-16 code-unit offsets within `block.text`, starting at zero, with an exclusive end. Emoji commonly take two code units. Boundaries may not split a surrogate pair. Quotes must match exactly, including whitespace/Unicode; the program never guesses which occurrence of repeated text you meant. Classification is one of `testable`, `inference`, `attributed`, `value-judgment`, `unclassified`. `ref` is a local label, not a database ID. Unknown JSON fields and duplicate JSON keys are rejected.

To explicitly identify another occurrence as the same logical claim, add `--claim CLAIM_ID` to `claim add`. The claim must belong to the same document. Model equivalence/split/merge mappings do not automatically make this decision.

```sh
pnpm siglum claim confirm ../my-writing OCCURRENCE_ID "This describes my wording."
pnpm siglum claim important ../my-writing OCCURRENCE_ID "Keep this point in the article."
pnpm siglum claim unimportant ../my-writing OCCURRENCE_ID "No longer a protected point."
pnpm siglum claim dismiss ../my-writing OCCURRENCE_ID "This is not the assertion I made."
pnpm siglum claim correct ../my-writing OCCURRENCE_ID ./corrected-annotation.json "Correct the interpretation."
```

Correction appends a new manual occurrence under the same claim and supersedes the old annotation; it does not rewrite history. A later modification of any anchored block makes the old occurrence stale even if the characters eventually return. Annotate the new revision instead of treating old confirmation as current. Important claims are explicit document constraints, not learned writing preferences. All current confirmed important occurrences within the inspected scope are included; important claims without a qualifying occurrence are disclosed as excluded.

## Model-assisted extraction

Use your installed model name in place of `MY_MODEL`. This command **previews only**:

```sh
pnpm siglum claim extract ../my-writing DOC_ID --blocks BLOCK_ID --provider ollama --model MY_MODEL --instruction "Extract the assertions without treating them as facts."
```

For document-wide extraction use `--document-scope` instead of `--blocks`. Append `--send` only after inspecting the destination and scope. Multiple block IDs are comma-separated without spaces. Selected sources may be included explicitly using `--sources SNAPSHOT_ID` or `--excerpts EXCERPT_ID`; private research notes and unselected sources are not selected for you.

Candidate extraction and the saved report commit in one transaction. A bad quote, wrong identity, cancelled call or stale document/claim context saves no candidate batch. Candidates can be listed without confirming each one. Confirm only the annotations you need to rely on or mark important.

## Review pending text changes

First create pending changes with the existing `suggest` workflow or an explicit proposal JSON; inspect their IDs with `changes`. Review is a separate request, not an automatic second paid call:

```sh
pnpm siglum changes ../my-writing DOC_ID
pnpm siglum review run ../my-writing DOC_ID --changes CHANGE_ID --provider ollama --model MY_MODEL --instruction "Check certainty, attribution and whether the core point was preserved."
```

The default review scope is the blocks affected by the selected changes. Add `--document-scope` to inspect the entire document, including places where an argument might have moved. Select compatible pending changes from one document; repeated changes to one block or stale operations are refused. The host constructs the proposed snapshot in memory; no draft is accepted.

All provider options match `suggest`: `--base-url`, `--key-env`, `--timeout-ms`, `--max-output-tokens`, `--instruction-file`, explicit source selection, and compatible adapter modes. Remote inference requires HTTPS and `--allow-remote` as well as `--send`. There is no automatic retry, response repair, endpoint fallback, source fetch or tool execution. See [providers](providers.md). CLI flags accept an environment-variable name, never a literal API key.

## Read a report

```sh
pnpm siglum review list ../my-writing DOC_ID
pnpm siglum review show ../my-writing RUN_ID
pnpm siglum review export ../my-writing RUN_ID ../private-review.json
```

Reports contain the exact input snapshot, declared scope, selected sources, requested model/settings, output, runtime, available token usage, prompt version, feedback and freshness. Source text is pinned to immutable snapshots. `review list` returns the most recent 100 runs; individual older IDs still work with `show`. `claim list` refuses documents exceeding the prototype's 1000-occurrence listing limit rather than silently implying complete coverage.

The three layers are separate:

- `observations`: mechanically constructed before/after text spans and hashes. The deterministic diff is a single changed span per block using common prefix/suffix, not a minimal semantic edit script. An absent literal quote does not establish that a meaning or argument was removed.
- `output`: model-local before/after candidates, explicit mappings, findings and selected-evidence assessments, labelled `model-assessment-not-verified`.
- `feedback`: author judgments on those interpretations, independent of manuscript decisions. Human agreement is not a universal truth certificate.

Mappings are `equivalent`, `reformulated`, `reversed`, `split`, `merged`, `removed`, `added`, `uncertain`. They stay in the report rather than silently linking durable claim IDs or inventing proposed occurrences in the actual document history.

Evidence relations are `not-assessed`, `supports`, `partially-supports`, `contradicts`, `insufficient`, `uncertain`. The derived `evidenceView` gives every returned candidate an explicit relation, defaulting omitted assessments to **not-assessed**. Supporting/conflicting assessments require exact quotations from the selected source items. `insufficient` concerns only selected material; it does not say no evidence exists anywhere. The host verifies quotation coordinates, not the soundness of the reasoning.

Empty findings mean no findings were returned for this scope, not “safe to accept.” Failed/refused/invalid/timed-out/cancelled requests terminate with errors and do not create a successful report. Failure transcripts are not saved. Token usage is recorded only when returned; missing usage is null and no dollar cost is inferred. The recorded model name is the configured/requested name, not independent attestation of what a server ran.

## Give feedback without changing the manuscript

```sh
pnpm siglum review decide ../my-writing RUN_ID FINDING_REF disagree "The original meaning was preserved."
pnpm siglum review decide ../my-writing RUN_ID mapping:0 needs-review "This may be a split, not a deletion."
pnpm siglum review decide ../my-writing RUN_ID assessment:0 correct "This supports only a weaker wording." "Partially supports the qualified assertion."
```

`mapping:N` and `assessment:N` are zero-based positions in this immutable report; findings use the model-local validated `ref`. Actions: `agree`, `disagree`, `needs-review`, `correct`. Only `correct` takes the additional correction text. Feedback is append-only and can be added to historical reports. It never changes the original model output or calls `accept`, `reject` or `revert`.

Existing text decisions remain separate:

```sh
pnpm siglum accept ../my-writing CHANGE_ID "Keep this edit."
pnpm siglum reject ../my-writing OTHER_CHANGE_ID "Keep the original wording."
pnpm siglum revert ../my-writing ACCEPTED_CHANGE_ID "Restore the earlier block."
```

Those are examples of different changes, not a sequence valid for one already-accepted change. Editing remains **block-level**. Sentence-level anchors do not introduce arbitrary substring acceptance or rollback.

## Human evidence assessments

`claim assess <workspace> <occurrenceId> <evidence.json>` records a separate human interpretation. The file has exactly `selection`, `relation`, `sourceQuotes`, `explanation`. Selection has only optional `snapshots` and `excerpts` arrays. A quote has `itemIndex`, `start`, `end`, `quote`: itemIndex is the zero-based selected-context index (snapshots first, then excerpts); offsets are within that selected item's text, not the full original HTML. Inspect the exact selected snapshot/excerpt before calculating coordinates.

`claim evidence <workspace> <occurrenceId>` shows all assessments with their pinned materials. Conflicting human assessments coexist; there is no majority-vote truth decision. Assessing a historical occurrence describes that old wording, not current wording.

## Freshness, storage and limits

A manuscript revision change, changed pending-change status or changed claim decisions makes a semantic report stale. Restoring identical text does not make an old report current. Extracting candidates changes the ledger itself, so an extraction report's freshness is governed by its manuscript revision; it is not a claim that its annotations remain confirmed. A different instruction/source selection requires a new run; the old report remains about its original input, with no global mutable “current brief.” Source refreshes do not invalidate reports about the saved older snapshot.

At most 100 extracted candidates per side, 100 findings, 200 mappings and 200 evidence assessments; 8 anchors/source quotes per item; 2000-character statements/explanations; 20 notes; 6 MB serialized analysis input/output safety bound; existing 8-item/80000-byte selected-context and transport limits still apply. A model's real context window/output budget may be much smaller. Oversized work is refused, never silently chunked or truncated.

All reports/candidates/feedback live in the private workspace SQLite database. They include sensitive manuscript/source text; JSON exports do too. No encryption or automatic backup schedule is provided. Keep exported reports out of the public repository.

See [protocol](analysis-protocol.md), [specification](v0.0.4-spec.md), [limitations](limitations.md) and [evaluation scaffold](../evaluation/README.md).
