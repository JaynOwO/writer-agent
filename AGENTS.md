# Repository instructions — Siglum

## Collaboration and authorized scope

The owner sets product scope; ChatGPT authors source, tests and delivery bundles. The owner uses the separately installed Writer Agent Updater v0.1.2 as the local integrator. Do not require Codex/Spark or a long manual Git workflow. Retain repository JaynOwO/writer-agent, package IDs @writer-agent/*, .writer data path and writer-agent-v*-delivery.zip filenames; product-facing name is Siglum. `pnpm siglum` aliases `pnpm writer`.

v0.0.3 authorizes bilingual READMEs, static public URL/file intake, immutable source snapshots, local search, excerpts/notes, paragraph source links, explicit model source selections/provenance, an additive backed-up source schema upgrade, tests and docs. Read docs/v0.0.3-spec.md, docs/sources.md, docs/provider-protocol.md and docs/security-model.md. Do not turn this into autonomous web search, a full HTML browser, GUI, Claim Ledger, semantic-support verdict, learned memory or Skills/MCP runtime. No unapproved dependencies or license changes.

## Git and delivery boundaries

- Work from a freshly verified main commit/tree and preserve user changes. Do not silently overwrite a changed baseline.
- The application runtime never executes Git or merges PRs. ChatGPT delivers source artifacts rather than directly pushing main.
- The owner has separately authorized each FULL_AUTO updater invocation to create a feature branch, validate, push, open a PR, wait for CI, merge its pinned head and clean up only its verified integration branch. Preserve its format-1 manifest contract. Do not generalize that authorization to other branches or arbitrary remote writes.
- Never force-push, reset/clean away work, leak credentials, commit databases/private manuscripts/node_modules/dist, or guess a token. A failed safety check stops the integration.
- Keep the genuine dependency lockfile. Unknown workspace schema requires an explicit refusal, not automatic deletion or recreation.

## Required verification and documentation

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo
pnpm demo:provider
pnpm demo:sources
```

The updater already calls check and the two existing demos; the source workflow is exercised within the test suite. CI additionally runs demo:sources. Tests use synthetic sources and loopback HTTP, no public websites/paid model keys. Record the actual OS/Node/dependency environment and failed/unrun checks. A successful fixture test is not a semantic accuracy guarantee or proof of live-site/provider interoperability.

Update README.md and README.zh-CN.md together for user-visible changes. Keep their language links, feature/limit markers, command examples and version facts aligned. scripts/check-readme-parity.mjs checks mechanical consistency, not translation meaning. Update paired source guides when changing source CLI behavior. Apache-2.0 remains the standard unmodified license; do not claim exclusive naming rights or license the user's sources/manuscripts by implication.

## Invariants

1. Models receive value snapshots, not SQL/filesystem/approval/tool handles. All responses and research text are untrusted data.
2. source add/refresh previews until --fetch; suggest previews until --send. Source selection is explicit. Remote models additionally require --allow-remote.
3. No silent source selection, secret/notes inclusion, truncation, retries, redirects or source-instruction execution. Do not remove DNS/IP pinning or byte limits to make tests pass.
4. A source snapshot is immutable. Preserve raw bytes separately from extracted text, extractor version, metadata and capture time. Unknown metadata stays null.
5. Excerpts are exact saved-text slices. Line references must not masquerade as PDF or HTML-original locations. Hashes are not authenticity proofs.
6. A source provided to the model is not necessarily used or supportive; context is labelled supplied-not-verified. Author links are user-linked-not-verified and version-pinned.
7. Every proposal still requires exact original text, block ID and monotonic block version. Stale document heads and stale same-block operations are refused.
8. Save pending proposals/context atomically; no transaction over a network wait. Only explicit human accept/reject/revert changes manuscript approval state.
9. Old source links become stale on their block's change, including ABA. Never silently approve/rebase a citation.
10. Code updates never migrate user data. v1-to-v2 workspace migration is explicit, backed up and transactional; close other sessions first. Backups are private and unencrypted.
