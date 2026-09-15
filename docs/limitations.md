# Known limitations — v0.0.2

Use disposable/test manuscripts and separate backups.

1. **Not a complete writing IDE.** No GUI, autonomous research, source snapshots, Claim Ledger, intent contract, streaming, embeddings, learned preferences, MCP or Skills execution.
2. **Rules/notes are not semantic verification.** Four lexical checks can miss meaning changes or flag harmless edits. Model notes are unverified and transient; no source-support or intent verdict is promised.
3. **Block-level edits.** Splitting at blank lines is lossless text segmentation, not a Markdown AST. Code fences can span blocks. One block per change; no sentence-level selection, structural edits, automatic rebase or dependency graph.
4. **Conservative conflicts.** Any later same-block edit invalidates old proposals/reverts, even if text returns to an earlier value. A fresh proposal is needed. The whole generated batch must still target the current document head when saved.
5. **Single storage authority.** SQLite schema v1 remains canonical. Markdown import creates a new document; export creates a new file without overwriting. No external file watcher.
6. **Prototype persistence.** Full revision snapshots duplicate text. No compaction, data migrations, automatic backups or encryption. Owner-controlled database files are not tamper-proof. Runtime limits are unchanged from v0.0.1.
7. **Platform validation is separate.** CI is configured for Node 22/24 on Linux/Windows. A previous version's passing CI does not establish that this update passes; consult the delivery validation report and new CI results. node:sqlite is experimental on Node 22.
8. **Model/provider compatibility.** Two non-streaming HTTP formats are implemented, not every compatible service/model or Responses API. Unsupported fields/response modes can fail. Explicit switches are available; no retries, JSON repair, automatic fallback, model download or model discovery. A structurally valid edit can still be semantically wrong.
9. **Not automatically private inference.** --send transmits the full selected document to the selected endpoint. A localhost server may itself proxy a cloud model. Real offline use requires a downloaded local model and independently verified server configuration. Ollama Cloud is not a supported advertised target for the native structured-output adapter.
10. **No OS credential store or dollar budget.** Process environment keys exist in memory. Output-token/timeout/byte limits are not exact billing limits; cancellation does not guarantee upstream inference stops. Provider service/weight terms are separate from Apache-2.0.
11. **Limited model-run history.** Schema v1 stores changes and explicit decisions, not persistent network run traces, token-usage costs or model notes. Invalid/cancelled requests save no proposals. Future audit/history expansion requires explicit design.
12. **Synthetic testing is not real inference evidence.** Fake HTTP tests verify protocol/error handling. Real API credentials and Ollama model weights were not supplied to the authoring environment; no actual provider-quality result is claimed by those tests.
