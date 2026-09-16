# Tools and research — Siglum v0.0.7

[English](extensions.md) | [简体中文](extensions.zh-CN.md)

## 1. A local fixture before connecting anything

Use an independent test writing workspace, not the source repository. Existing workspaces must not be reinitialized. This demo launches only a **synthetic MCP program supplied in this repository** and a synthetic loopback model server. It does not use a real API, third-party MCP service, or factual source.

```sh
pnpm build
pnpm demo:extensions
pnpm eval:retrieval
pnpm siglum init ../extensions-playground "Extensions playground"
pnpm siglum extensions guide ../extensions-playground --lang en
pnpm siglum extensions guide ../extensions-playground --lang zh-CN
```

The end marker is `EXTENSIONS_DEMO_OK`. The integrated scenario loads a chosen skill, calls MCP via actual stdio, retrieves a passage near the end of synthetic material, approves an outline, writes two chapters, reviews, retains alternatives, and explicitly simulates author adoption. `eval:retrieval` measures exact target-string inclusion in twelve synthetic bilingual cases; it is not real-model accuracy.

The numbered guide handles selection. `0`/empty returns, `q` exits, EOF/Ctrl+C never approves. On Windows use `pnpm.cmd` when the PowerShell shim is restricted; no administrator privileges or policy change is needed. Windows interaction/child cleanup requires separate verification; Linux results are not Windows evidence.

## 2. Importing an instruction-only Skill

```sh
pnpm siglum skill import ../extensions-playground ./examples/skills/source-check
pnpm siglum skill import ../extensions-playground ./examples/skills/source-check --apply
pnpm siglum skill list ../extensions-playground
pnpm siglum skill enable ../extensions-playground SKILL_ID
pnpm siglum skill read ../extensions-playground SKILL_ID references/checklist.md 1 2
pnpm siglum skill disable ../extensions-playground SKILL_ID
```

Upper-case IDs in these examples are placeholders. The guide avoids copying them. Import previews until `--apply`; imported content remains disabled until enabled. A package is an immutable local copy, not a live watched directory. Import a changed directory as a new version. Activating a new same-name version disables the old one, invalidating affected captures. Disabling then reenabling does not resurrect old approval.

This is an **explicit subset of Agent Skills**: required `SKILL.md`, supported YAML string/frontmatter fields, Markdown instructions and explicitly selected relative reference-text line ranges. Supported scalar forms are plain/quoted strings, `|`, `>`, `|-`, `>-`, and a two-space-indented string `metadata` map. General YAML aliases/tags/sequences, scripts and binary assets are refused. A supported text file can live in references/assets; it is never executed. Names must match the directory and use lower-case ASCII/digits/single hyphens. Package limits are 64 text files/256000 serialized bytes, three loaded skills/48000 bytes, eight references per skill. Unknown required capabilities are not installed or executed. Declared free-text compatibility is displayed for author inspection, not certified by the host.

Only selected packages and selected reference lines reach a content task; public web-query planning receives no private skills. `allowed-tools` only narrows selected MCP method names/host IDs, not grant rights; it is not an implementation of shell wildcard permissions. Instruction loading is not proof the model followed it, and it cannot change intent, activate memory or approve text.

## 3. MCP connection trust versus tool authority

MCP support is a **bounded native client**, not a full protocol implementation. The official SDK was evaluated but could not be installed in the author's DNS-blocked environment. No SDK/JSON Schema/YAML dependency was added, and the genuine lockfile was not fabricated. See the exact [compatibility matrix](extensions-protocol.md); unsupported schema assertions are excluded rather than ignored.

For stdio, explicitly register an already-installed executable, argument array and working directory. This starts a program **with the current user's operating-system permissions**. MCP is not a sandbox, and an environment allowlist or directory setting cannot confine a malicious program. Trust only known programs. No automatic `npx`, installers, shell command concatenation or script execution is supplied. Hash checks include the executable and directly referenced argument files; they do not authenticate an entire dependency tree or prevent a malicious trusted program from reading disk secrets.

HTTP connections are explicit endpoints, using loopback HTTP or approved remote HTTPS. Optional bearer credentials come from an environment variable **name**, not a literal key flag. No OAuth flow, automatic redirect or discovery of new endpoints occurs. A local server may forward traffic to the cloud. A server's `readOnlyHint` is only a claim; even a read may disclose data or incur charges.

Save `connection.json` using the guide or the JSON shape in the compatibility guide, then:

```sh
pnpm siglum mcp register ../extensions-playground ./connection.json
pnpm siglum mcp register ../extensions-playground ./connection.json --apply
pnpm siglum mcp list ../extensions-playground
pnpm siglum mcp trust ../extensions-playground SERVER_ID LAUNCH_HASH
pnpm siglum mcp discover ../extensions-playground SERVER_ID
pnpm siglum mcp discover ../extensions-playground SERVER_ID --connect
pnpm siglum mcp catalog ../extensions-playground SERVER_ID
pnpm siglum mcp revoke ../extensions-playground SERVER_ID
```

Registering does not launch/connect. Trust authorizes that connection/launch, not arbitrary tools. Discover only contacts the trusted service with `--connect`; it does not call its tools. Discovery itself may have service-side effects/costs. Known destructive-declared tools cannot be selected for automatic read/compute workflows. Descriptors include server ID and name/URI plus schema/description hashes. Observed changes require reselection and a new grant, including changed-then-restored descriptors. A lying server can still change behavior without changing its descriptor; this is not a hostile-code isolation guarantee.

## 4. Use them in one writing task

Open the existing workflow guide, create/select a new-article task, and select **Tools/skills/chapters**. Choose enabled skills and reference ranges; choose trusted, discovered tool/resource descriptors, the **exact JSON arguments** and author-checked read/compute purpose. Optionally enable chapter drafting. Saving selections refreshes captures and revokes the previous grant. Inspect and authorize the new stage preview before running.

```sh
pnpm siglum workflow guide ../extensions-playground --lang en
pnpm siglum workflow guide ../extensions-playground --lang zh-CN
```

This version executes **author-selected, fixed-argument calls**, not an unrestricted model-selected tool loop. Up to five calls join the research phase, using the same durable attempt/lease/checkpoint path as built-in search/fetch. Each logical MCP call (including bounded metadata RPCs) consumes one shared `fetches` read/page attempt. The grant shows its target and parameters; a changed service, skill version, arguments or data scope needs reauthorization. More calls/chapters may require a larger explicitly approved budget. Unknown outcomes are not retried silently. Revocation fences late result persistence; it cannot undo a request already processed outside Siglum.

New guide-created schema6 tasks opt into improved research/citations. Existing configs without `extensions` retain legacy behavior. JSON config opt-in:

```json
{"skills":[],"calls":[],"chapterDrafting":false}
```

Put that object under the config's `extensions` field. It enables question-based research/citations even with no Skill/MCP connection. Add selected IDs through the guide; MCP and chapter drafting currently apply only to **new-article** tasks. Existing-article templates can load skills but keep original text-block proposals and selected-source behavior.

MCP returned text is imported with explicit `external-service-unverified` provenance. It is not disguised as a direct website fetch or independent source. Result URLs/resources are not recursively followed. Only text content (or supported structured output rendered as text) is accepted; binary, resource-link and callback requests fail explicitly. Prompts from tools remain untrusted data.

## 5. Evidence across the saved text

```sh
pnpm siglum source list ../extensions-playground
pnpm siglum research query ../extensions-playground SNAPSHOT_ID "battery endurance limitations"
```

The source index covers the complete **bounded saved extracted text**. Chunks retain original UTF-16 offsets, line ranges, hashes, heading labels and neighbors. Only ranking fields are normalized; original source bytes are not rewritten. Heading navigation labels are capped at 256 code units with an ellipsis; exact source quotations remain intact.

Selection uses Latin-word/Han-bigram literal relevance and adjacent passages, not embeddings or a second model. The default automatic selection is at most two windows/8000 bytes per acquired source, subject to the overall eight-item/80000-byte context cap. Required explicit material is not silently clipped. Oversized windows and missing literal matches are disclosed. `indexedEntireText` is **not** a claim the model read it; the plan lists included/omitted lines. Automatically returned index scores are retrieval preferences, not truth/reliability probabilities. No-match navigation samples are labelled as such.

Search discovery ordering uses question-term matches, host diversity and duplicate normalized URLs/substantial identical snippets. Full-source text hashes catch duplicate imported text. Dates and primary-source roles that cannot be established remain unknown; capture time is not publication time. Different hosts are not necessarily independent evidence. Selected windows can still miss a distant qualification; no complete evidence/conflict detection is claimed. Manually selected snapshots keep the existing full-material budget, so use explicit excerpts for oversized inputs.

Chapter mode drafts each approved outline section against the global author guidance and chapter-relevant **frozen evidence packet**. Its source indices are mapped to stable evidence identities when joined. Earlier successful sections are reused after an explicit retry. The host joins chapters locally, then requests one bounded whole-candidate review; optional revision remains one successful round. If the full candidate cannot fit review/output limits, the task stops rather than certifying unchecked chapters. Term consistency remains a fallible model check, not a deterministic semantic guarantee.

## 6. References and exact coordinates

```sh
pnpm siglum citations show ../extensions-playground CANDIDATE_OR_DOCUMENT_ID
pnpm siglum citations export ../extensions-playground CANDIDATE_OR_DOCUMENT_ID ../references.json
```

The host renumbers Markdown footnotes by appearance and retains source snapshot/excerpt identities independently of S1/S2. Candidate maps record marker offsets plus a simple neighboring-text boundary, exact selected-source quote offsets/hashes, metadata, capture time and MCP origin when applicable. Offsets on sources are relative to the **saved selected text** with its pinned extracted-text line range, not HTML bytes/PDF pages.

The model's protocol supplies quotes by source entry, not a separate proof for every sentence. Bindings therefore explicitly say `source-entry-candidates-not-claim-support`: all matching selected quotes are candidate evidence at that source marker. The neighboring-text boundary is not a Markdown/linguistic sentence parser. Validate support with semantic review/human judgment. Missing/malformed/orphan references and wrong quotes are refused. Marker/map size bounds stop pathological fanout. This is structural consistency, **not factual certification**.

Adopting a new candidate saves manuscript, citation map and workflow checkpoint atomically. Re-adoption returns the original document. After any later manuscript revision (including same-text ABA), old mappings become stale. Historical candidate maps remain pinned to their candidate, not asserted current for a later task epoch. Export refuses existing files and includes potentially private evidence: inspect before sharing. No Word/bibliography-style engine or sentence-level text rollback was added.

## 7. Migration, limits and verification

```sh
pnpm siglum migrate ../existing-writing
pnpm siglum migrate ../existing-writing --apply
```

New workspaces use schema6; old schemas1–5 remain usable within their earlier capability sets. Extensions require explicit backed-up migration. Code updates do not open/migrate private workspaces. Close other sessions before migration; backups are private and unencrypted. Old workflow records are not fabricated into new extension-aware records.

All regressions and seven demos are part of verification; the existing updater still runs check plus its original demos, while CI explicitly adds `demo:extensions`. Actual stdio/HTTP tests use **owned synthetic servers**, not proof of SDK/third-party interoperability. Windows, Node24, real Tavily, real models and independent MCP servers must be reported separately. The twelve retrieval comparisons are target-string fixtures, not a representative research-quality benchmark.

See [compatibility/protocol](extensions-protocol.md), [architecture](architecture.md), [security](security-model.md), [workflows](workflows.md) and [v0.0.7 scope](v0.0.7-spec.md).

Joined chapters with more than 20 unique limitation notices are refused rather than silently truncating them. The source-selection preview summarizes additional notices beyond 60 and retains detailed selection artifacts.
