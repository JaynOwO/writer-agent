# Siglum

[English](README.md) | [简体中文](README.zh-CN.md)

<!-- siglum:version=0.0.9 -->
<!-- siglum:license=Apache-2.0 -->
<!-- section:intro -->
A local-first agent harness for research, writing, and review.

**Models propose. Sources stay traceable. Authors decide.**

**v0.0.9** · Desktop and CLI development preview · **Apache-2.0**

Keep manuscript revisions, source snapshots, claim annotations, review reports and author-confirmed writing guidance in your own workspace. A model may draft intent, suggest preferences, propose edits or review changes; it cannot approve its own output. Bounded, author-authorized templates now coordinate research and writing; this is not a complete desktop IDE or an unrestricted autonomous agent.

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
pnpm demo:workflow
pnpm demo:extensions
```

Windows PowerShell can use `pnpm.cmd` when its `.ps1` shim is restricted. No execution-policy change is required:

```powershell
pnpm.cmd check
pnpm.cmd demo:memory
```

Expected markers: `DEMO_OK`, `PROVIDER_DEMO_OK`, `SOURCES_DEMO_OK`, `REVIEW_DEMO_OK`, `MEMORY_DEMO_OK`, `WORKFLOW_DEMO_OK`, `EXTENSIONS_DEMO_OK`. **They validate software workflows, not real-model editing quality or memory learning accuracy.**

<!-- section:workflows -->
## Phase-authorized writing workflows

Three fixed templates: research a new article, revise an existing article, or review selected pending changes. Explicit phase consent fixes the inputs, model, endpoint, source scope and quotas. The runtime advances within that phase and stops for an outline decision or final adoption. Independent commands keep their original per-call consent.

```sh
pnpm siglum workflow help
pnpm siglum workflow guide ../my-writing --lang en
pnpm siglum workflow guide ../my-writing --lang zh-CN
```

New-article web mode uses your own Tavily key (`TAVILY_API_KEY`) and compatible model; no account/balance is included. Only the separate public brief reaches query planning. Search uses fixed basic depth with automatic parameters, generated answers/raw content/images disabled. Actual fetched pages become immutable source snapshots; unavailable pages remain unavailable, not proof from snippets. Inspect selection coverage and gaps.

Outline approval grants no implicit composition permission. Candidate A, critique and optional candidate B remain private artifacts; author adoption creates a manuscript. Existing-article alternatives stay pending against the original baseline. One successful automatic revision maximum per task; no self-scored loops.

Default aggregate limits are 8 model attempts, 3 searches, 5 shared page/MCP read attempts and 900000 ms active execution, with separate stage limits. Saved matching results are reusable. Unknown outcomes require explicit acknowledgement before a possibly repeated/charged request. An expired lease needs explicit recovery; two workers cannot commit the same step. No background daemon or automatic retry. Monetary cost remains unknown without reliable billing data.

See [workflow guide](docs/workflows.md), [简中指南](docs/workflows.zh-CN.md), [workflow protocol](docs/workflow-protocol.md). Real search/model interoperability and output quality are unvalidated until an opt-in live run; the demo uses loopback fixtures.

<!-- section:extensions -->
## Skills, MCP and question-based evidence

The optional extension layer imports/activates **instruction-only Skills**, loads selected reference lines, discovers trusted MCP tools/text resources and executes author-selected fixed-argument read/compute calls inside approved new-article phases. Stdio and Streamable HTTP support explicit 2026-07-28 / 2025-11-25 subsets; no automatic installer, OAuth, arbitrary scripts or general model tool loop. Connection trust is separate from tool/stage approval. **A local MCP process is not an OS sandbox.**

```sh
pnpm siglum extensions help
pnpm siglum extensions guide ../my-writing --lang en
pnpm siglum extensions guide ../my-writing --lang zh-CN
pnpm eval:retrieval
```

Enhanced new tasks search across bounded saved text with deterministic Latin/Han matching and neighboring passages, instead of always taking the first40 lines. Plans disclose actual coverage and omissions; retrieval ranking is not reliability. Chapter drafting is opt-in, uses the approved outline/global intent and frozen chapter evidence, and ends with a bounded whole-candidate review. Each chapter is a budgeted model request.

Host-generated footnotes and citation maps keep stable source/excerpt identities and exact offsets while display numbers can change. They associate source-entry quotation candidates, not proven claim support; later manuscript changes make maps stale. The actual stdio/HTTP integration tests use owned synthetic servers, **not independent interoperability certification**. The installed official SDK handles MCP protocol execution; host JSON Schema/frontmatter and capability restrictions remain. Read the [English guide](docs/extensions.md), [简中指南](docs/extensions.zh-CN.md) and [compatibility matrix](docs/extensions-protocol.md) before connecting programs/services.

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

A successful edit request stores pending proposals and the selected source/guidance snapshot atomically; manuscript text is unchanged. Accept/reject/revert remain separate author actions. `provenance` means supplied-not-verified, not necessarily used, cited or supportive. Legacy commands use named process environment variables, never literal key flags. Explicit desktop/product presets may instead use the system store or current-session mode. See [provider instructions](docs/providers.md).

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

<!-- section:product -->
## Connections, verification and reading reports

```sh
pnpm demo:product
pnpm siglum product doctor
pnpm siglum product guide ../extensions-playground --lang en
pnpm siglum product guide ../extensions-playground --lang zh-CN
```

The existing writing workspace must already exist; do not initialize over private material. Saved model presets are also available in the writing/workflow guide. The product guide manages user-local connections, masked credential input, explicit keyring/service tests, optional navigation summaries and static HTML export. It does not execute probes or unlock keys by default.

| Capability | Implemented boundary |
|---|---|
| <!-- feature:connection-presets --> Connections | Versioned local defaults, explicit task binding; no automatic permission |
| <!-- feature:os-credentials --> Secrets | Lazy OS keyring adapter, separate references, explicit environment/session alternatives |
| <!-- feature:navigation-summaries --> Summaries | Optional, budgeted navigation notes; original selected evidence retained |
| <!-- feature:html-reports --> Reading | Static bilingual HTML snapshots, opt-in private groups, no scripts or remote assets |
| <!-- feature:validation-guide --> Verification | Local metadata by default; bounded live probes separately authorized and recorded |

<!-- limit:product-validation --> **Implementation is not platform/provider certification.** OS binding tests, application tests, official SDK server fixtures and independent service tests are distinct. No credentials are supplied; missing/unsupported/not-run is never a pass. Summaries may increase total input and cost. HTML is read-only and frozen, not a GUI editor or live status screen.

See [product guide](docs/product.md) and [dependency / compatibility notes](docs/dependencies.md). SDK2.0.0 and keyring2.1.0 are now locked dependencies. New writing workspaces use schema7; user-level nonsecret configuration has its own schema1. Old MCP registrations need an explicit current-adapter registration/trust/discovery, not an automatic protocol fallback.

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
| <!-- feature:workflows --> Workflows | Phase consent, 3 templates, candidate artifacts and explicit adoption |
| <!-- feature:web-search --> Web search | Tavily basic adapter, public query isolation and saved source provenance |
| <!-- feature:durable-resume --> Resume | Durable attempts, quotas, lease fencing, unknown outcomes and idempotent local adoption |

| <!-- feature:skills --> Skills | Immutable text-only packages, explicit activation and selected reference spans |
| <!-- feature:mcp --> MCP | Trusted stdio/HTTP clients, fixed-argument author grants, text tools/resources, explicit compatibility limits |
| <!-- feature:research-index --> Evidence | Whole-saved-text index, literal relevance/diversity/dedup, bounded windows and coverage |
| <!-- feature:citations --> Citations | Host numbering, exact stable source-entry maps and stale manuscript mappings |
| <!-- feature:chapters --> Chapters | Opt-in approved-outline sections, stable-source assembly and bounded final review |

<!-- limit:desktop-preview --> **Desktop is a Windows x64 development preview.** Portable distribution includes an explicit user-level install flow, not a signed Setup.exe. It is a stable-block Markdown editor, not a rich-text/collaborative editor. Advanced configuration remains in the CLI guides.

<!-- limit:bounded-web-search --> **Bounded real web search, not unrestricted browsing.** New-article research uses Tavily Search and public static pages. Search snippets are discovery records, not fetched evidence. Existing-article templates use explicitly selected saved sources.

<!-- limit:no-semantic-verdict --> **No factual certification or guaranteed intent understanding.** Mechanical checks cannot validate model conclusions or all free-text conflicts.

<!-- limit:range-boundaries --> **Range operations stay within stable blocks.** Independent accept/reject/revert is implemented with strict history/conflict checks; cross-block structural moves are not. Word highlights do not certify unchanged meaning.

<!-- limit:static-extraction --> **Static UTF-8 extraction only.** No PDF, JS rendering, browser login, compression, redirects or full HTML5 parser.

<!-- limit:manual-migration --> **No implicit data migration.** New workspaces use schema v7. Legacy v1–v6 retain their respective editing/source/analysis/memory capabilities; workflows require an explicit backed-up upgrade. Code updates never migrate private writing.

<!-- limit:no-background-learning --> **No background learning, fine-tuning or vector database.** Candidate inference requires an explicit request; author activation is separate. Title is a rule-scope tag, not a new title-generation command.

<!-- limit:memory-retention --> **Disable is not erase.** Old requests, databases, backups and remote services may retain past content. Export excludes examples by default, not secrets manually typed into rule text. Review what you export/send. This version does not promise secure deletion.

<!-- limit:extension-subset --> **Extension support is bounded, not universal.** Skills do not run scripts. MCP uses the official SDK with an explicit host capability/schema subset and author-selected parameters, not arbitrary callbacks or a sandbox. Independent third-party services and real-model quality need separate tests.

<!-- section:privacy -->
## Local storage, explicit transmission

Local-first is not a guarantee of local inference: a loopback model server can relay to the cloud. Memory examples require separate per-request selection. Export/import is explicit; imported preferences start as candidates in a new profile and do not attach or activate themselves. Model/page text never grants filesystem, SQL, approval or credential privileges.

Private databases and exports are unencrypted; do not commit them. Network source intake has bounded bodies, DNS/IP checks and address pinning, but is not a network sandbox. Close other sessions before migrating. Backups remain under `.writer/backups/`; never copy a backup over an open SQLite/WAL database.

<!-- section:development -->
## Development and validation

Pinned official MCP SDK and OS credential binding dependencies are added; the lockfile is genuinely generated by pnpm. See docs/dependencies.md. Node's SQLite, test runner, fetch and readline are used through bounded code paths. Default tests never call paid providers; real OS/model/install results must be reported separately.

[Architecture](docs/architecture.md) · [CLI](docs/cli.md) · [v0.0.9 specification](docs/v0.0.9-spec.md) · [Limitations](docs/limitations.md) · [Contributing](CONTRIBUTING.md)


<!-- section:desktop -->
## Desktop and independently reviewable edits

<!-- feature:desktop --> Open the Windows portable folder and run Siglum.exe. No separate Node/Git is required for ordinary writing. The optional **Install locally** action copies a verified version for the current user. Code is not application-signed; actual Windows installation and system-keyring validation remain separate checks. Existing CLI and read-only reports remain available.

<!-- feature:range-decisions --> The desktop hosts a separate writing utility process and restricted preload. Pending block proposals can become range sets. Accept/reject one range, or revert one accepted range without restoring unrelated edits. Overlap, missing history and later manual edits block ambiguous decisions. Autosaved editing buffers and approved model changes stay separate. Range-aware semantic review pins exactly the selected operations.

Developer source commands (runtime acquisition is an explicit network action):

```sh
pnpm desktop:runtime
pnpm desktop
pnpm desktop:smoke
```

[Desktop guide](docs/desktop.md) · [简中桌面指南](docs/desktop.zh-CN.md) · [Range protocol](docs/range-edit-protocol.md) · [Packaging](docs/packaging.md)

<!-- section:updater -->
## Developer source integration

<!-- feature:updater --> **Siglum Updater 0.2.0** is a separate developer tool under tools/updater; it is not embedded in writing-model capabilities. A fixed local launcher opens an authenticated panel. ZIP selection fixes the exact package, independent worktrees preserve the ordinary checkout, and phase records reconcile unknown GitHub outcomes before retry. Repository host/ID (github.com / 1370967185) is stable while names resolve dynamically. Renaming does not authorize a different owner/repository or a different base commit. Public Release downloads require the documented product descriptor and an explicit choice.

[Updater guide](tools/updater/README.md) · [简中更新器指南](tools/updater/README.zh-CN.md). Source updates do not publish Releases, sign installers, migrate private workspaces or rename the repository.

<!-- section:license -->
## License

**Apache-2.0** — see [LICENSE](LICENSE), [NOTICE](NOTICE) and [license notes](docs/license-status.md). All project packages stay `private: true` to prevent accidental npm publication; this does not restrict the license. The software license does not automatically license your manuscripts, imported research, models or external services.
