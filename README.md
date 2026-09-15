# Siglum

[English](README.md) | [简体中文](README.zh-CN.md)

<!-- siglum:version=0.0.3 -->
<!-- siglum:license=Apache-2.0 -->
<!-- section:intro -->
A local-first agent harness for research, writing, and review.

**Models propose. Sources stay traceable. Authors decide.**

**v0.0.3** · CLI development preview · **Apache-2.0**

Siglum keeps manuscript revisions, review decisions and immutable source snapshots locally. It can ask a configured model to propose edits using explicitly selected source text. A model response cannot accept its own changes. This is a working development core, not a finished writing IDE or an autonomous researcher.

The product is now **Siglum**. The repository remains `JaynOwO/writer-agent`, workspace state remains `.writer`, and internal packages remain `@writer-agent/*` so existing automation continues to work.

<!-- section:quickstart -->
## Try the offline demonstrations

Use Node.js **22.16+** (CI targets the 22 and 24 lines) and **pnpm 10.11.0**. Install development dependencies once; demonstrations and tests then use synthetic sources, scripted responses and loopback HTTP only. No model account, API key or Ollama installation is needed for these checks.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo
pnpm demo:provider
pnpm demo:sources
```

In Windows PowerShell, use the `.cmd` shim when `.ps1` execution is restricted; there is no need to change execution policy:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd check
pnpm.cmd demo:sources
```

Expected demonstration markers: `DEMO_OK`, `PROVIDER_DEMO_OK`, `SOURCES_DEMO_OK`. The source demo captures a synthetic HTML fixture, saves an excerpt and note, supplies that excerpt to a scripted provider, records provenance, accepts/reverts a proposal and exports the preserved source. **These markers are software checks, not evidence of real model quality.**

<!-- section:sources -->
## Keep sources, not just URLs

Each capture has its own snapshot ID, original response/file bytes, extracted text, SHA-256 hashes, capture time, extractor version and reported metadata. Missing author/publication fields stay `null`. Recapturing a URL appends a new snapshot; it does not rewrite the one an older proposal referenced.

```sh
pnpm build
pnpm siglum init ../my-writing "My writing workspace"
pnpm siglum source import ../my-writing ./examples/research-fixture.html
pnpm siglum source list ../my-writing
pnpm siglum source search ../my-writing "correlation"
pnpm siglum source help
```

`pnpm siglum` and `pnpm writer` are equivalent. `source add <workspace> <url>` only previews; add `--fetch` to contact a public site. Excerpts use 1-based inclusive line numbers in the **extracted text**, not HTML line numbers or PDF pages. Local `source search` searches saved latest snapshots, not the internet.

Use the [source guide](docs/sources.md) for capture, refresh, excerpts, notes, paragraph links and exports. Exports contain `raw.bin`, `text.txt` and metadata; raw HTML is not opened or executed. Do not use this preview as the only copy of important research.

<!-- section:models -->
## Supply selected evidence to a model

Model adapters: `ollama` and `openai-compatible` (Chat Completions, not Responses API).

```sh
pnpm siglum model
pnpm siglum help
```

`suggest` accepts `--sources <snapshotId,...>` and `--excerpts <excerptId,...>`. No source is selected automatically; private research notes are not added to model context. The preview shows the endpoint, model, manuscript size and selected source IDs/byte counts without printing the bodies. `--send` transmits the selected manuscript, editing instruction and source context. Remote inference also requires `--allow-remote` and may incur provider charges.

Successful inference creates **pending** changes only. `changes`, `accept`, `reject` and `revert` remain explicit author actions. `provenance <workspace> <changeId>` reports exactly which selected texts were supplied to that request, with snapshot/excerpt identifiers and hashes. **Supplied does not mean used, cited, true or supportive of a claim.**

See [provider instructions](docs/providers.md) and the [proposal protocol](docs/provider-protocol.md). Provider credentials are read from named process environment variables; they do not belong in manuscripts, source snapshots, Git or chat messages.

<!-- section:status -->
## Implemented and deliberately not implemented

| Area | Available in this preview |
| --- | --- |
| <!-- feature:revisions --> Revisions | Local SQLite, block-level proposals, exact-text/version conflict checks, accept/reject/revert and decision reasons |
| <!-- feature:providers --> Models | Scripted Mock, native Ollama chat, OpenAI Chat Completions-compatible adapter |
| <!-- feature:sources --> Sources | Explicit URL capture and local UTF-8 HTML/Markdown/text import; immutable snapshots and local substring search |
| <!-- feature:excerpts --> Excerpts | Exact source-text line ranges and quote hashes |
| <!-- feature:notes --> Research notes | Locally stored notes bound to a snapshot or excerpt; not automatic memory |
| <!-- feature:provenance --> Proposal context | Atomic recording of source text supplied with pending model proposals |
| <!-- feature:bindings --> Paragraph links | Author-created excerpt links pinned to a block version; edits make old links visibly stale |
| <!-- feature:bilingual --> Documentation | English and Simplified Chinese README, paired source guides and mechanical README parity checks |

<!-- limit:no-gui --> **No GUI or packaged desktop app yet.** Use the CLI and demonstrations.

<!-- limit:no-web-search --> **No global web search, crawler or autonomous research loop.** Provide individual URLs or files; source search is local.

<!-- limit:no-semantic-verdict --> **No full Semantic Diff, Claim Ledger or evidence-support verdict.** Lexical hints can be wrong or miss changes; no accuracy claim follows from passing tests.

<!-- limit:block-edits --> **Edits still replace whole text blocks.** Reverting an older same-block edit conflicts rather than erasing later work. A reverted block's previous source link remains stale until explicitly linked again.

<!-- limit:static-extraction --> **Static extraction is limited.** UTF-8 HTML/text/Markdown only; no PDFs, JavaScript rendering, logins, embedded resources, compressed responses or redirects. The small extractor is not a full HTML parser, article reader or visual page snapshot; uncommon named entities and page layout may differ. Check original bytes when quoting.

<!-- limit:manual-migration --> **Existing workspaces are not silently upgraded.** v1 workspaces retain original editing; source features need an explicit backed-up schema-v2 migration. Updating source code never migrates manuscripts.

<!-- limit:no-memory-tools --> **No learned writing preferences, Skills or MCP execution yet.** Research notes and refusal reasons are records, not learned rules.

<!-- section:privacy -->
## Privacy and trust boundaries

Local-first describes storage, not a guarantee of local inference. A loopback model server may itself relay to a cloud service. Only send documents and source content you are authorized to transmit. Source snapshots and exported files are not encrypted.

Public-page intake rejects local/private/special-use addresses, checks every DNS answer and pins one approved address for the connection. It does not follow redirects or run source instructions. This reduces network risk; it is not a substitute for egress controls or a security audit. Source text is always untrusted model context, and no model is given filesystem, SQL or approval capabilities.

Close other programs using an old workspace before running the migration preview and then explicitly applying it. A verified SQLite backup is retained under `.writer/backups/`. See [migration and recovery](docs/sources.md#existing-workspaces) and the [security model](docs/security-model.md).

<!-- section:development -->
## Development

[Architecture](docs/architecture.md) · [CLI](docs/cli.md) · [v0.0.3 specification](docs/v0.0.3-spec.md) · [Limitations](docs/limitations.md) · [Contributing](CONTRIBUTING.md)

The repository still has no third-party runtime dependencies. The dependency lockfile is unchanged from v0.0.2. CI is configured for Windows/Linux and Node 22/24; report actual job results separately. Real provider/public-site smoke tests are opt-in and separate from offline regression tests.

Update both READMEs together. `docs:check` checks versions, license, declared sections/features/limitations, command parity and local link targets. It does not prove translation accuracy or validate prose claims.

<!-- section:license -->
## License

Licensed under the **Apache License, Version 2.0**. See [LICENSE](LICENSE), [NOTICE](NOTICE) and [license notes](docs/license-status.md).

This software license does not relicense your manuscripts, imported sources, models or third-party services. Project packages stay `private: true` to prevent accidental npm publication; this does not remove Apache-2.0 rights. No trademark registration or exclusive rights in the product name are claimed here.
