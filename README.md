# Siglum

[English](README.md) | [简体中文](README.zh-CN.md)

<!-- siglum:version=0.0.5 -->
<!-- siglum:license=Apache-2.0 -->
<!-- section:intro -->
A local-first agent harness for research, writing, and review.

**Models propose. Sources stay traceable. Authors decide.**

**v0.0.5** · CLI development preview · **Apache-2.0**

Keep manuscript revisions, source snapshots, claim annotations, review reports and author-confirmed writing guidance in your own workspace. A model may draft intent, suggest preferences, propose edits or review changes; it cannot approve its own output. This is not a complete desktop writing IDE or an autonomous researcher.

The product is Siglum. Repository `JaynOwO/writer-agent`, package IDs `@writer-agent/*`, `.writer` data path and delivery filenames stay compatible with the existing updater. `pnpm siglum` and `pnpm writer` are equivalent.

<!-- section:quickstart -->
## Try without a model key

Use Node.js **22.16+** and pinned **pnpm 10.11.0**. CI targets Node 22/24 on Linux/Windows. First installation needs internet; the default tests/demos use synthetic text, scripted fixtures and loopback HTTP, not paid providers or automatic model downloads.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo
pnpm demo:provider
pnpm demo:sources
pnpm demo:review
pnpm demo:memory
```

Windows PowerShell can use `pnpm.cmd` when its `.ps1` shim is restricted. No execution-policy change is required:

```powershell
pnpm.cmd check
pnpm.cmd demo:memory
```

Expected markers: `DEMO_OK`, `PROVIDER_DEMO_OK`, `SOURCES_DEMO_OK`, `REVIEW_DEMO_OK`, `MEMORY_DEMO_OK`. **They validate software workflows, not real-model editing quality or memory learning accuracy.**

<!-- section:writing-memory -->
## Intent and writing memory, with author control

Describe the article in a few sentences, or use a template in the numbered guide. Model-authored intent cards remain drafts until confirmed. Manual save is an explicit confirmation. Choose a reusable profile; rules are scoped to that profile, language and task. No profile is chosen automatically.

```sh
pnpm build
pnpm siglum init ../my-writing "My writing workspace"
pnpm siglum import ../my-writing ./examples/sample.md "Test article"
pnpm siglum guide ../my-writing --lang en
```

For Simplified Chinese menus:

```sh
pnpm siglum guide ../my-writing --lang zh-CN
```

The guide selects documents, profiles, pending edits, reports and preference candidates by number, not copied IDs. It supports returning/cancelling and has no default model-send or approval. Rejection reasons are optional. Preference distillation runs only when explicitly requested on selected reasoned feedback; its output stays candidate-only until you choose to activate it. Repeated reasonless rejection is not evidence of a style preference.

One-request exceptions override ordinary article/profile defaults without rewriting them. Conflicting required structured rules need an explicit exact-rule waiver; free-text conflicts are not automatically understood. Selection uses deterministic profile/language/task filtering, priority and stable IDs: at most 20 profile rules, 3 separately authorized examples and 24,000 serialized UTF-8 bytes. Required/explicit content is never silently truncated. No embedding database or extra retrieval-model call is used.

Usage snapshots show exactly which intent/rule versions were supplied. Applicable guidance changes invalidate captured requests/reports, while unrelated profiles do not. Literal phrase/code-point checks are mechanical; style and meaning remain model assessments. See the [memory guide](docs/memory.md), [protocol](docs/memory-protocol.md) and [Chinese guide](docs/memory.zh-CN.md).

<!-- section:sources -->
## Keep sources, not just URLs

Capture a selected public URL or import UTF-8 HTML, Markdown or text. Preserve raw bytes, extracted text, reported metadata, capture time, extractor version and hashes. Refresh appends a snapshot instead of rewriting old evidence. Unknown metadata remains null.

```sh
pnpm siglum source import ../my-writing ./examples/research-fixture.html
pnpm siglum source list ../my-writing
pnpm siglum source search ../my-writing "correlation"
pnpm siglum source help
```

`source add`/`refresh` previews until `--fetch`; local search is not web search. Excerpts identify lines in extracted text, not original HTML coordinates or PDF pages. Notes stay local and are not silently converted into preferences or sent to models. See the [source guide](docs/sources.md).

<!-- section:models -->
## Models propose; you approve

Adapters: `ollama` and `openai-compatible` (Chat Completions, not Responses API). Set up a compatible model/server yourself; no model or API balance is bundled.

```sh
pnpm siglum model
pnpm siglum help
```

`suggest` previews the destination, source choices and writing-guidance plan. `--send` authorizes one inference request; remote inference also requires `--allow-remote`. Intent drafting, preference drafting and semantic review each require their own explicit send. The guide previews the exact selected data and obtains confirmation. No automatic retry, repair call, provider switch or extra judge is hidden in a request.

A successful edit request stores pending proposals and the selected source/guidance snapshot atomically; manuscript text is unchanged. Accept/reject/revert remain separate author actions. `provenance` means supplied-not-verified, not necessarily used, cited or supportive. Secrets come only from named process environment variables, never from literal key flags. See [provider instructions](docs/providers.md).

<!-- section:semantic-review -->
## Claim ledger and semantic review

Extract candidate claims or annotate manually; exact quotations and offsets are checked against pinned text. Confirming an annotation does not certify its truth. Important claims and intent constraints are explicit author choices.

```sh
pnpm siglum claim help
pnpm siglum review help
pnpm siglum memory help
```

Review selected pending changes with an independently selected model, optionally in full-document scope. Reports distinguish mechanical observations, `model-assessment-not-verified` interpretations and author feedback. Guidance-aware review adds possible intent/style deviations; it cannot change manuscript approval. Exact quotes do not prove sound reasoning, and no findings is not a safe-to-accept verdict.

Reports retain their input/version history. Later relevant document, pending-change, claim or guidance changes make them stale. Older reports that predate memory retain absent guidance, not invented historical preferences. See [review guide](docs/review.md). Real-model quality is unvalidated; the 80 bilingual evaluation cases have draft labels pending human review.

<!-- section:status -->
## Included, with clear boundaries

| Area | Implemented |
| --- | --- |
| <!-- feature:revisions --> Revisions | SQLite, exact block/text/version checks, pending proposals and independent-block accept/reject/revert |
| <!-- feature:providers --> Models | Scripted Mock, native Ollama chat, Chat Completions-compatible adapters |
| <!-- feature:sources --> Sources | Explicit URL/file intake, immutable snapshots, local substring search |
| <!-- feature:excerpts --> Excerpts | Exact extracted-text lines/offsets and quote hashes |
| <!-- feature:notes --> Notes | Local snapshot/excerpt notes; not silently supplied to models |
| <!-- feature:provenance --> Provenance | Atomic selected-source context for proposals |
| <!-- feature:bindings --> Links | Version-pinned paragraph/source links; changed blocks make them stale |
| <!-- feature:claims --> Claims | Manual/candidate annotations, author decisions, protected claims |
| <!-- feature:semantic-review --> Review | Separate task, selected-evidence assessments, historical reports and author feedback |
| <!-- feature:intent --> Intent | Versioned manual/model-draft cards, templates, confirmation and existing important-claim references |
| <!-- feature:writing-memory --> Memory | Scoped profiles, candidate approvals, request exceptions, bounded selection and exact usage history |
| <!-- feature:terminal-guide --> Guide | English/Simplified Chinese numbered menus, cancellation and explicit send/approval |
| <!-- feature:bilingual --> Docs | Paired README/source/review/memory guides and mechanical parity checks |

<!-- limit:no-gui --> **No GUI or packaged desktop editor.** The guide is an interactive terminal, not a visual rich-text editor.

<!-- limit:no-web-search --> **No autonomous web research or global search.** Provide URLs/files; saved-source search is local.

<!-- limit:no-semantic-verdict --> **No factual certification or guaranteed intent understanding.** Mechanical checks cannot validate model conclusions or all free-text conflicts.

<!-- limit:block-edits --> **Text changes remain whole-block operations.** Fine-grained sentence-level rollback is not implemented.

<!-- limit:static-extraction --> **Static UTF-8 extraction only.** No PDF, JS rendering, browser login, compression, redirects or full HTML5 parser.

<!-- limit:manual-migration --> **No implicit data migration.** New workspaces use schema v4. Old v1/v2/v3 retain their existing editing/source/analysis capabilities; memory needs explicit backed-up migration. Updating source code never upgrades private manuscripts.

<!-- limit:no-background-learning --> **No background learning, fine-tuning, vectors or Skills/MCP execution.** Candidate inference requires an explicit request; author activation is separate. Title is a rule-scope tag, not a new title-generation command.

<!-- limit:memory-retention --> **Disable is not erase.** Old requests, databases, backups and remote services may retain past content. Export excludes examples by default, not secrets manually typed into rule text. Review what you export/send. This version does not promise secure deletion.

<!-- section:privacy -->
## Local storage, explicit transmission

Local-first is not a guarantee of local inference: a loopback model server can relay to the cloud. Memory examples require separate per-request selection. Export/import is explicit; imported preferences start as candidates in a new profile and do not attach or activate themselves. Model/page text never grants filesystem, SQL, approval or credential privileges.

Private databases and exports are unencrypted; do not commit them. Network source intake has bounded bodies, DNS/IP checks and address pinning, but is not a network sandbox. Close other sessions before migrating. Backups remain under `.writer/backups/`; never copy a backup over an open SQLite/WAL database.

<!-- section:development -->
## Development and validation

No new third-party runtime dependency was added. Existing pnpm lockfile is retained. Node's SQLite, test runner, fetch and readline are used through bounded code paths. Default tests never call paid providers; real OS/model/install results must be reported separately.

[Architecture](docs/architecture.md) · [CLI](docs/cli.md) · [v0.0.5 specification](docs/v0.0.5-spec.md) · [Limitations](docs/limitations.md) · [Contributing](CONTRIBUTING.md)

<!-- section:license -->
## License

**Apache-2.0** — see [LICENSE](LICENSE), [NOTICE](NOTICE) and [license notes](docs/license-status.md). All project packages stay `private: true` to prevent accidental npm publication; this does not restrict the license. The software license does not automatically license your manuscripts, imported research, models or external services.
