# Contributing

Writer Agent is licensed under Apache-2.0; see LICENSE and NOTICE. Unless explicitly stated otherwise, contributions intentionally submitted for inclusion are under that license, as described by its section 5. Contributors retain their rights; this project does not require copyright assignment or introduce a separate CLA in v0.0.2. Submit only work you have the right to contribute and preserve applicable third-party notices. AI assistance does not remove that responsibility.

Read AGENTS.md, docs/v0.0.2-spec.md, docs/provider-protocol.md and docs/security-model.md. Keep PRs focused. Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm demo`, and `pnpm demo:provider`. Add regression tests; never weaken original text/version matching or hide real test failures to pass CI.

Default automated tests must not use external model endpoints, real API keys or paid calls. Mark fake-server evidence as synthetic. Real-provider smoke tests are opt-in and reported separately. Do not commit personal manuscripts, workspace databases, credentials, node_modules or compiled files. API credentials belong only in a local process environment for this preview. Report reproduced issues using minimized synthetic documents and safe error codes.

Use feature branches and PRs. Do not auto-merge, force-push, rewrite shared history, or publish a package/release without explicit authorization. Keep license and notices intact; record substantive changes clearly.

## Siglum v0.0.3 additions

Keep English/Simplified Chinese READMEs and paired source guides aligned. Run `pnpm check` and all three demos. Use synthetic fixtures, never commit real private research. Source snapshots are evidence records, not verified facts. Do not weaken URL/DNS/response guards, reinterpret supplied context as source support, or silently migrate a workspace. Add migration/integrity/provenance regressions for changes to source storage.

## Review contributions

Update both review guides and READMEs. Add tests for exact anchors, source references, stale-run rejection and non-mutating feedback. Never interpret a valid schema or agreeing models as truth. Draft evaluation labels need independent human review before benchmark claims; synthetic predictions are not live evaluations. Default CI must remain key-free and use fixtures/loopback HTTP only.
