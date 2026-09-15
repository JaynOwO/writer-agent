# Known limitations

This is a core development preview; use disposable/test copies of manuscripts.

1. **No production writing assistant yet.** No GUI, autonomous research, source snapshotting, Claim Ledger, intent contract, real provider call, streaming, embeddings, learned preferences, MCP or Skills execution.
2. **Rules are not semantic diff.** Four lexical checks can miss changed meaning entirely, and can also flag harmless edits. No calibrated confidence, citation validation, evidence deletion verdict or intention verdict is produced.
3. **Block-level edits only.** Initial splitting is lossless text segmentation at blank lines, not Markdown parsing. Fenced code can be split. Editing a block can introduce blank lines without re-segmenting it. One block per change; no per-sentence acceptance, reordering, automatic rebase or dependency-aware selective revert.
4. **Conservative conflicts.** Any later edit to the same block invalidates an old pending proposal or revert, even if the characters eventually match again. A fresh proposal is required.
5. **Single storage authority.** SQLite is canonical. Markdown import creates a new document; export creates a new file and will not overwrite. No file watcher reconciles external edits.
6. **Prototype storage.** Complete snapshots duplicate text per revision; no compaction, migrations, background backup or encryption. Application identity and schema are checked, and unknown formats are refused. Local file owners can still tamper with databases.
7. **Runtime dependency.** Node 22's `node:sqlite` API is experimental. The code uses the supported subset available at Node 22.16; synchronous storage would need isolation in a future desktop UI. Windows and Node 24 must be verified by the integrator/CI rather than assumed from Linux results.
8. **Dependency installation not verified in the author's sandbox.** DNS access to the npm registry was unavailable. Local validation used preinstalled exact TypeScript 5.8.3 and Node type definitions 22.19.7 with disposable workspace symlinks, excluded from the bundle. The integrator must run a real pnpm install and commit the generated lockfile.
9. **No secret storage yet.** No model API key is requested or used. A future provider configuration must add OS-appropriate secret storage and permission controls before a UI asks for credentials.
10. **License pending.** The project has not selected an open-source license. Package metadata intentionally says UNLICENSED until the owner decides.
