# Proposal protocol v1

The model sees one selected document snapshot, one instruction and any explicitly selected source context. It does not receive a Workspace, database handle, other documents, environment variables, API credentials or tool definitions.

## Request

Internal ModelRequest retains `documentId`, `baseRevisionId`, `snapshot: { blocks }`, and `instruction`. Each block contains a stable `id`, monotonically increasing `version`, verbatim `text` and `separator`. The provider deep-copies this baseline before waiting on HTTP. The application retains a separate copy from the one passed to a provider.

## Wire response

```json
{
  "protocolVersion": 1,
  "documentId": "doc_example",
  "baseRevisionId": "rev_example",
  "edits": [
    {
      "blockId": "blk_example",
      "before": "一些研究认为，这项工具可能影响部分岗位。",
      "after": "一些研究认为，这项工具可能改变部分岗位的工作内容。",
      "summary": "明确影响的对象，但保留归因和不确定性。"
    }
  ],
  "notes": ["这是编辑意见，不是事实核查。"]
}
```

All displayed IDs are fictional. `before` must match the complete current block exactly, including line endings and Unicode. There are no model-controlled status, providerId, confidence, sourceSupported or autoAccept fields. Additional properties are refused. The host supplies providerId from the selected adapter/model.

An empty `edits` array is valid. At most 100 edits, one per block; summaries at most 1000 characters. At most 20 notes, each at most 2000 characters. All edits must preserve the existing 2,000,000-byte maximum document size. No partial batch is persisted. The initial maximum document size is not a model context-window guarantee; large documents may need to be split manually.

`proposalSchema()` supplies a portable JSON Schema with required fields and `additionalProperties: false`. Server-side schema support is helpful, not trusted. `parseProposal()` and `validateProposal()` enforce the stronger local rules independently, including when compatibility mode omits server-side schema constraints. Parsing uses JSON.parse; Markdown fences, incomplete JSON and trailing prose are rejected. There is no repair/fallback model request.

## Validation flow

1. Capture the current document revision.
2. Validate and copy the request; make one bounded HTTP request.
3. Validate completion envelope and finish state; parse JSON text.
4. Validate exact response shape, identity, original text and projected size.
5. Application revalidates response/provider identity against its own retained baseline.
6. Storage checks the document head and validates the full batch in a transaction, storing only pending changes.
7. User separately invokes accept/reject/revert. Each operation retains v0.0.1 conflict and transaction semantics.

Model notes are returned to the CLI with `verified: false, persisted: false`. They are deliberately not saved as enduring semantic judgments or preferences in either supported schema. Existing lexical hints remain independent and fallible.

## Model compatibility

OpenAI-compatible means the Chat Completions request/response shape implemented here, not the Responses API, all providers, all models, or every JSON Schema feature. The user chooses compatible models and switches explicitly. Ollama uses native chat rather than its compatibility API. Non-streaming only. No automatic model discovery, selection, downloads, thinking-output display, retries, tool calls or provider switching.

## v0.0.3 source context (response protocol remains v1)

ModelRequest has optional `sources: SourceContextItem[]`. Each item pins sourceId/snapshotId/optional excerptId, locator, reported title, full extracted-text hash, selected-content hash, extracted-text line range and exact selected text. The request must contain at most 8 items and 80000 serialized UTF-8 bytes. No implicit selection, truncation or note inclusion is permitted. Source text is untrusted user-data context, never system instructions.

The host retains its own captured baseline, validates the response as before and saves pending changes plus the selected source context in one transaction. Provenance is `supplied-not-verified`: no automatic assertion of actual model use, citation correctness or evidence support. The model cannot author/override this stored context record. Raw HTML and private absolute file paths are not model inputs. Excerpts/pinned snapshots do not drift when a source is refreshed. See [sources](sources.md).
