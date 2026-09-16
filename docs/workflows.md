# Writing workflows — Siglum v0.0.6

[English](workflows.md) | [简体中文](workflows.zh-CN.md)

## Start without a real API account

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo:workflow
```

Expected `WORKFLOW_DEMO_OK`. This uses a synthetic loopback model endpoint and a synthetic loopback search endpoint with the production adapters. Page content is injected fictional data. No real Tavily search, model inference, payments or external publication occurs. The printed temporary workspace is separate from the code repository; candidates are adopted only by explicit simulated author actions. Existing demos remain available.

## Use the numbered guide

```sh
pnpm build
pnpm siglum init ../workflow-playground "Workflow playground"
pnpm siglum workflow guide ../workflow-playground --lang en
pnpm siglum workflow guide ../workflow-playground --lang zh-CN
```

Run `init` only for a new/empty workspace, never on the code repository or an existing writing directory. Windows PowerShell may use `pnpm.cmd`; no administrator rights or execution-policy change is needed. The existing `guide` also contains a workflow entry. Menus use numbers, `0`/empty returns, `n`/`p` page, `q`/EOF/Ctrl+C cancels without implicit approval. Workflow execution is foreground-only; closing the terminal does not schedule background work.

Choose new-article, revise-article or review-changes. New-article can use web research or explicit saved sources. Existing-article templates currently use saved sources only and their existing intent/profile. Select language, model settings, source selections, optional profile and at most one automatic revision. Public query planning uses a separately entered PUBLIC brief. Do not put secrets in that brief.

Creating a task does not call any service. Open the task and inspect the stage preview: actual captured goal/guidance/sources, provider, endpoint, search permissions, outline when applicable and attempt/time limits. Authorize exactly that preview. Within the phase, allowed steps proceed without repeated questions. Model or page content cannot grant permissions. Each new phase, changed input, provider or budget needs new consent. Ordinary standalone commands retain their original --send/--fetch behavior.

The workflow guide offers creation/resume, stage preview/consent, outline approval/amendment, discussion follow-up, artifacts/export, candidate adoption, old-article per-change decisions, expired-worker recovery, explicit retry, budget changes and cancellation. It calls the same services as noninteractive commands, not a separate implementation.

## Genuine services and privacy

Tavily Search is a separate service from inference. Put your own legitimate search credential in the local process environment named `TAVILY_API_KEY`; do not paste its value into chat, JSON, command arguments or Git. Configure the model and its key using the existing provider guide. No account, model download or search credit is bundled. Missing credentials stop preflight before starting the model/query sequence; no silent downgrade to local search.

Tavily requests use basic depth, `auto_parameters:false`, no generated answer/raw content/images, and reported usage when present. Only generated public queries plus bounded domain/time/result options reach search. Only the approved public brief reaches the query planner, never the manuscript or profile examples. Search/model keys are sent solely to their corresponding API hosts, not discovered webpages. A loopback model may still proxy cloud inference.

Retrieved search snippets are discovery records, not source snapshots. URLs undergo the original public URL/DNS/IP-pinning checks. No redirects, login, cookies, JS, PDF, compression or external extraction fallback. Unreadable pages are recorded as unavailable. The host preserves complete bounded raw content; automatic model context includes at most the first 40 complete extracted-text lines within 8000 UTF-8 bytes per fetched page, with omissions disclosed. No usable saved text means blocked, not a fabricated successful synthesis. Explicit saved-source selections cannot be silently truncated and retain 8-item/80000-byte limits.

Selection is deterministic first-per-host then result order, with blocked/duplicate/page-budget exclusions. This is not an exhaustive or reliability-ranked literature review. A quoted source can be incomplete, wrong or conflicting; coordinate validation is not factual verification.

## Workspaces and migration

```sh
pnpm siglum migrate ../existing-writing
pnpm siglum migrate ../existing-writing --apply
```

New workspaces use schema v5. Old v1/v2/v3/v4 retain their prior capabilities. Workflow features require explicit backed-up migration; code updates do not search for or migrate private workspaces. The guide can show this preview and request one confirmation. Close other sessions first. Backups stay private/unencrypted. Never overwrite an open SQLite/WAL database.

## Noninteractive config and stage consent

Copy `examples/workflow-config.json` to `my-workflow-config.json`, choose an actually available model, and review public/private text and domain permissions. The supplied model ID is a placeholder, not a recommendation or auto-download. Paths with spaces must be quoted. All uppercase IDs/fingerprints below must be replaced by returned values; the guide avoids copying IDs.

```sh
pnpm siglum workflow create ../workflow-playground ./my-workflow-config.json
pnpm siglum workflow list ../workflow-playground
pnpm siglum workflow preview ../workflow-playground RUN_ID
pnpm siglum workflow authorize ../workflow-playground RUN_ID PREVIEW_FINGERPRINT
pnpm siglum workflow run ../workflow-playground RUN_ID
```

`workflow create` persists config and an immutable capture; `preview` performs no model/DNS/HTTP call. `authorize` records its exact fingerprint but does not run it. `run` may spend approved model/search requests. Stage limits default to at most three model attempts (one for audit), plus configured remaining research quotas. A custom four-field limits JSON may be supplied to both preview/authorize. Limits cannot exceed the remaining task budget.

New-article config may contain a manual run-owned intent card; it cannot reference nonexistent document occurrences. Author-owned goal/profile/intent guide content generation, not query planning. Memory examples must remain separately selected in `memoryOptions`, not implicitly all sent. Use existing memory commands to manage reusable profiles.

## Outline gate, candidates and final adoption

```sh
pnpm siglum workflow artifacts ../workflow-playground RUN_ID
pnpm siglum workflow approve-outline ../workflow-playground RUN_ID OUTLINE_ARTIFACT_ID
pnpm siglum workflow preview ../workflow-playground RUN_ID
pnpm siglum workflow authorize ../workflow-playground RUN_ID NEW_PREVIEW_FINGERPRINT
pnpm siglum workflow run ../workflow-playground RUN_ID
pnpm siglum workflow compare ../workflow-playground RUN_ID CANDIDATE_A_ID CANDIDATE_B_ID
pnpm siglum workflow adopt ../workflow-playground RUN_ID CHOSEN_CANDIDATE_ID
pnpm siglum workflow export-draft ../workflow-playground CHOSEN_CANDIDATE_ID ../candidate-export.md
```

Research stops at a proposed synthesis/direction/outline with questions and gaps. Amend its output or reply through the guide, then approve the exact latest artifact. A reply changes private content requirements, not the public search brief. It needs renewed research consent and may consume another model attempt; matching query/search/page outputs are reused. Composition needs a new grant.

Composition saves candidate A, an anchored fallible critique, and optionally B if authorized and issues were returned. B is a new candidate; it receives no additional hidden review. At most one successful automatic revision per task, including after retries/refreshes. Zero findings are not approval. Mechanical writing-rule checks are stored separately from model critique.

Candidate citations use `[^S1]` indices into the actual selected sources, with independently checked source quote spans. Host-generated export footnotes contain source locators/snapshot IDs/line ranges; not claims of verified support. No fake document/revision is created for draft review. `compare` gives exact A/B strings and prefix/suffix spans, not minimal semantic diff, word-level revert or a truth verdict.

Only `adopt` at the final gate creates a manuscript. Repeating adoption of the same candidate returns the same document, not a duplicate; adopting another candidate into the same completed task is refused. Export never overwrites and never publishes externally. Revision-template A/B are pending proposals against the official original baseline; choose individual changes, never automatically accept A in order to generate B. Review-only saves analysis and never adds edits.

## Interrupted execution and explicit recovery

```sh
pnpm siglum workflow attempts ../workflow-playground RUN_ID
pnpm siglum workflow recover ../workflow-playground RUN_ID
pnpm siglum workflow retry ../workflow-playground RUN_ID ATTEMPT_ID
pnpm siglum workflow retry ../workflow-playground RUN_ID UNKNOWN_ATTEMPT_ID --ack-duplicate
pnpm siglum workflow run ../workflow-playground RUN_ID
```

These are alternatives, not commands to blindly run in sequence. Inspect the attempt first. A live 45-second renewable lease cannot be stolen; close the old worker and wait for expiry before recover. An interrupted reserved step is marked NOT_SENT; a dispatched step without a saved result becomes `outcome-unknown`. The provider may already have processed/charged it. Unknown retry requires `--ack-duplicate`; ordinary known-failure retry does not. Both retain prior budget consumption. No automatic retry/fallback or end-to-end exactly-once claim.

Completed matching artifacts are reused and local effects are transactionally checkpointed. Two terminals cannot own the same run generation; a late worker cannot commit after its authority expires/revokes. Recovery only edits local state and does not send requests; run/continue is explicit. Ctrl+C cancels local waiting, not a promise that the provider stopped or refunded a request.

## Budgets, changed inputs and history

```sh
pnpm siglum workflow revoke ../workflow-playground RUN_ID
pnpm siglum workflow cancel ../workflow-playground RUN_ID
pnpm siglum workflow budget ../workflow-playground RUN_ID ./budget.json
pnpm siglum workflow refresh ../workflow-playground RUN_ID
pnpm siglum workflow refresh ../workflow-playground RUN_ID ./replacement-config.json
pnpm siglum workflow amend-outline ../workflow-playground RUN_ID CURRENT_OUTLINE_ID ./amended-outline-output.json
pnpm siglum workflow events ../workflow-playground RUN_ID
pnpm siglum workflow show ../workflow-playground RUN_ID
```

Example `budget.json`:

```json
{"models":12,"searches":3,"fetches":5,"activeMs":900000}
```

Totals count failed/dispatched/retried attempts too: by default 8 model attempts,3 searches,5 page attempts,900000 active ms. Waiting for the author is not active execution. A crashed worker conservatively accounts until lease expiry. Dollar cost remains unknown without reliable usage/rates; token/credit observations are not a strict billing ceiling.

Budget-only changes revoke the grant while preserving matching outputs. Input refresh starts a new epoch and invalidates dependent private outputs; public data stays cached only for matching request/service/policy inputs. Increasing budgets does not auto-authorize. Preserve old results for inspection, do not reset/clean the workspace. Select a smaller scope or provide more material when blocked. Arbitrary workflow code, user-defined tools, a daemon, GUI and Skills/MCP remain outside this release.

`events` and `attempts` explain what happened; their inputs/artifacts contain private material and must not be committed to Git. Diagnostic errors omit raw provider bodies/keys, but user-authored text can itself contain secrets; review exports before sharing.

## Optional real smoke test

After configuring real keys/models, use a disposable workspace and a small PUBLIC technical topic. Set small quotas, authorize research, inspect actual captured pages and omissions, approve the outline, authorize composition, compare candidates and adopt only after reading them. Reopen at the outline gate once to validate continuity. Record real provider/model, successful and failed requests, returned usage, elapsed time and manual corrections. This is an opt-in live test, not something the delivery has run for you.

See [protocol](workflow-protocol.md), [security](security-model.md), [memory](memory.md), [sources](sources.md) and [limitations](limitations.md).

## v0.0.7 extension opt-in

This guide's original prefix/no-tool behavior remains the interpretation for old task records. New guide-created schema6 tasks include an empty extensions object by default, enabling question-based source windows and citation maps. Select Tools/skills/chapters in the run menu to attach authorized skills, fixed MCP read arguments and opt-in section drafting. These changes require refresh/new stage consent. MCP reads and page reads share the existing fetches quota. See [English extension guide](extensions.md) / [简中扩展指南](extensions.zh-CN.md); old configs are not silently upgraded.
