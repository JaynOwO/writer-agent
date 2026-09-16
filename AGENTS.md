# Repository instructions — Siglum

## Collaboration and authorized scope

The owner sets product scope; ChatGPT authors source, tests and delivery bundles. The owner uses the separately installed Writer Agent Updater v0.1.2 as the local integrator. Do not require Codex/Spark or a long manual Git workflow. Retain repository JaynOwO/writer-agent, package IDs @writer-agent/*, .writer data path and writer-agent-v*-delivery.zip filenames; product-facing name is Siglum. `pnpm siglum` aliases `pnpm writer`.

v0.0.8 authorizes choices 1C/2B/3C/4C/5C: local diagnostics and explicit live validation, pinned official MCP SDK, optional navigation summaries, private static HTML reports, user-local versioned presets and OS credentials. Read docs/v0.0.8-spec.md, product.md/product.zh-CN.md and dependencies.md. SDK2.0.0 and keyring2.1.0 are locked actual dependencies, not native protocol fallbacks. Retain host trust/schema/byte limits and all previous manuscript/source/analysis/memory/workflow guards. No GUI, daemon, hidden retries, implicit real calls or plaintext key fallback.


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
pnpm demo:review
pnpm demo:memory
pnpm demo:workflow
pnpm demo:extensions
pnpm demo:product
```

The updater already calls check and the two existing demos; the source workflow is exercised within the test suite. CI additionally runs demo:sources, demo:review and demo:memory. Tests use synthetic sources and loopback HTTP, no public websites/paid model keys. Record the actual OS/Node/dependency environment and failed/unrun checks. A successful fixture test is not a semantic accuracy guarantee or proof of live-site/provider interoperability.

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
10. Code updates never migrate user data. v1/v2/v3/v4/v5-to-v6 workspace migration is explicit, backed up and transactional; close other sessions first. Backups are private and unencrypted.

## Analysis additions

- Each extract/review call needs its own explicit send permission. Never reuse writing permission to silently call another model.
- Providers never choose persistent claim IDs or approve annotations/text. Candidate refs exist only in the validated response; mappings do not auto-merge ledger identities.
- Reconstruct host inputs before save; stale document/annotation/selected-change state saves no current report. No transaction over network waits.
- Keep exact observations, model assessments and human decisions separate. Correct quotes are not correct reasoning. Empty findings are not safe-to-accept.
- Retain inputs, selected source text, model metadata, versioned protocol/prompt and returned usage locally; no secret fields or hidden reasoning. Unknown usage/cost is unknown.
- Preserve all regression tests. Update schema-version assertions only when adding the tested v6 migration. Draft evaluation labels cannot become human-reviewed by automatic script.
- Update README.md, README.zh-CN.md, paired review guides and commands together. Keep updater format 1 and original delivery filename prefix.

## Intent/memory invariants

- Never activate model/import candidates or silently infer motives from reasonless rejection. Manual author save is explicit confirmation.
- One-request overrides do not rewrite long-term versions. Required conflicts need explicit exact-rule waivers; free-text contradictions are not claimed solved.
- Profiles/languages/tasks remain isolated. Preview every exact selected intent/rule/example packet; examples need separate consent. No background model calls or all-history prompts.
- Store applicable-version captures with pending proposals atomically. Reject stale guidance after inference; unrelated profiles must not invalidate everything. Old reports do not acquire fabricated memory fields.
- Numbered guide uses shared services, no implicit default Yes on EOF/cancel. Close SQLite connections before temp cleanup. Never treat Linux success as Windows success.
- Update paired README/memory guides and fact markers together. Explicitly select the delivery ZIP when invoking updater; never ask the user to clean/reset unknown work or hand-edit manifests.

## Workflow-specific authority

- Independent commands keep --send/--fetch semantics. Only explicit workflow grants authorize a bounded multi-call stage; author input/outline adoption remains separate. A model cannot change grants, limits or approval states.
- Plan queries from the public brief only; never include manuscripts/profile examples or search/model key values in query planning. Source snippets are not fetched snapshots. Preserve static URL/DNS/IP pinning and selection coverage.
- Store attempts before dispatch and reserve quotas durably. Never silently retry outcome-unknown calls, reset spent counters, steal live leases, or claim end-to-end exactly-once. Changing budgets revokes grants; input refresh preserves historical artifacts.
- Keep run-private candidate drafts outside official documents until explicit adoption. Existing-article alternatives stay against the official baseline. Use short nested savepoint-safe transactions for local side effects/checkpoints; no network awaits inside.
- All new tests/demo use synthetic loopback services. Close every SQLite connection before cleaning Windows test directories. Use an explicit delivery ZIP argument; do not require Codex, reset/clean, hand-edited manifests, or updater upgrades.

## v0.0.7 extensions and research

- Never equate Skill import, activation, MCP connection trust, catalogue discovery, fixed tool-argument approval, phase consent or manuscript adoption. These are separate author decisions. No untrusted code installer, shell-string executor, full MCP conformance claim or OS sandbox claim.
- Hash executable and direct argument files before launch; close every direct child/pipe on exit. A process with user permissions can still access disk/network; transitive dependencies/grandchildren are not sandboxed.
- Captures include skill activation/version, trusted connection/version and descriptor/arguments. Re-observed changes require fresh selection. Tools share durable read/fetch quotas; outcome-unknown is never silently retried.
- MCP text is external-service-unverified origin, not directly fetched web evidence. Do not strip its origin when copying context or reinterpret returned URLs as approved requests.
- New research uses full saved-text indexing, bounded exact windows and clear omissions. No-match is navigation only; ranking is not truth. Keep Chinese/English/Unicode coordinates exact and prevent oversized heading/citation fanout.
- Chapter draft/assembly remains run-private until explicit adoption, then atomic manuscript+citation/checkpoint. Source-entry candidate quotes are not per-claim support. Relevant later revisions make maps stale. Old tasks retain old fields/behavior.
- All tests/demo use owned synthetic services. Report SDK/third-party interoperability, Windows, real search/model calls and clean dependency installation separately. Keep explicit ZIP integration and no manual reset/clean.

## v0.0.8 product boundaries

- Workspace schema remains6. User-local nonsecret connections.sqlite uses schema1; never copy secrets into workspace/Git/reports. Loading metadata is not reading/unlocking a credential.
- Preset creation, OS key writes, live connection tests, task-local binding, stage consent and manuscript adoption are distinct. Credential callbacks are host-only and stripped from model descriptions; local bindings protect imported task references.
- No implicit OS-store fallback. Linux explicitly selects Secret Service, not kernel-keyring auto-fallback. Journal random new items and compensate only unreferenced owned operations. No other-app enumeration. Removal is not service-side key revocation.
- SDK-backed transport retains the declared supported subset. Old registrations require explicit renewal. Self-authored SDK fixtures are not independent third-party interoperability evidence.
- Navigation summaries are derived-navigation-not-evidence; preserve original selected text, account for summary calls and omissions. They currently add guidance rather than claiming guaranteed context compression.
- HTML is an escaped static time-point snapshot with private content groups. Excluded structured groups must be absent, not hidden. Text itself may already quote evidence; no semantic secret-redaction claim. Do not add executable approval actions.
- Keep Windows full-app validation distinct from uploaded Windows binding self-tests; Linux/Chromium/set_content is not Windows/Edge/file:// evidence.
