# Workflow protocol and execution invariants — v1 (Siglum v0.0.6)

## Scope and layers

This protocol is separate from Proposal v1, Analysis v1 and the memory tasks. The runtime does not give a model DB/file/approval/shell handles. It invokes only fixed stage tasks after checking a persisted author grant. Stage consent is not manuscript adoption, fact certification or permanent-memory activation. Standalone --send/--fetch semantics are unchanged.

Templates: new-article (research -> author outline gate -> compose -> adoption gate), revise-article (propose -> review -> optional alternate proposal -> explicit edit decisions), review-changes (one selected pending-change report, no new edits). New research may use Tavily basic or selected saved material. Existing-document templates currently use selected saved sources only.

## Request/response values

`WorkflowRequest` and `WorkflowOutput` are typed/discriminated JSON, protocolVersion 1. Each has task,runId,requestId. The host derives the request ID from exact task inputs; models echo IDs, never assign persistent run/artifact/grant/claim IDs. Duplicate keys, deep JSON nesting, unknown fields and mismatched identity are rejected.

query-plan input is exactly protocolVersion/task/runId/requestId/publicBrief/language/maxQueries. No manuscript, profile, history, prior private discussion, sources or API keys. Output is 1–3 unique bounded queries, each at most 400 UTF-16 units. Plan language follows the explicit zh-CN/en field.

Content tasks receive the goal, selected guidance, selected SourceContextItems, disclosed gaps/feedback and applicable parent outline/draft/review. They never receive unselected sources/private notes or credential values. Source context retains the existing maximum8 items/80000 bytes; full serialized task input is bounded at6000000 bytes. Parent structures and source quotations are independently validated.

- outline output: proposed direction, summary, 1–20 sections (heading, points, sourceQuotes), gaps and questions.
- draft/draft-revision output: title, markdown (max200000 UTF-16 units), exact citations, limitations. `[\^S1]` conceptually identifies selected source index0; actual syntax is `[^S1]`. Model-authored URL destinations and footnote definitions are refused. The host resolves footnotes to saved snapshots. An exact source quote is not evidence that the cited conclusion is true.
- draft-review output: at most50 issues with exact start/end/quote in candidate markdown, concise explanations and optional sourceQuotes; needsRevision and notes. A requested revision needs at least one anchored issue. No minimal diff is invented for a draft that has no original manuscript. B is not automatically reviewed again.

Source quote offsets and candidate review offsets use UTF-16, end-exclusive, with unpaired Unicode rejected. Returned output is at most1000000 serialized bytes. Partial/invalid responses never become successful artifacts. No implicit repair/fallback/retry or added reasoning trace. New candidates have separate artifact identity; accepting a new candidate creates the first document revision only upon author adoption.

## Tavily adapter and intake

Direct POST to `https://api.tavily.com/search`; bearer credential read from configured environment NAME at send time. Endpoint is fixed for real operation; loopback-only test injection is not a CLI/provider setting. Explicit basic depth, auto_parameters false, include_answer/raw_content/images false, include_usage true, max_results5 and topic general. Optional domain/time filtering comes from consent. Language maps zh-CN -> zh-cn, en -> en; filter_by_language is false (boost, not a promise all results have one language). Responses preserve query, bounded title/URL/snippet, relevance score, returned request ID, usage or null, discovery time.

HTTP errors, redirects, invalid MIME/JSON, oversized bodies, connection loss and cancellation stop the adapter; no billing/account mutation. 432/433 are quota errors. A 200 result is discovery, not a fetched page or support certification. Result selection validates public URL/domain rules, deduplicates fragments/URLs, and chooses one per host then remaining rank order, with reasons. HTTP page fetching reuses the original DNS/IP-pinned source intake; no search/model key reaches a webpage.

Each fetch stores full bounded raw bytes/extracted snapshot. Automatic source selection uses first up to40 complete extracted-text lines within8000 bytes per page; total context and omitted-line counts are explicit. A first line too large is not truncated; the page can stay saved without being supplied. Search snippets never substitute for unavailable pages. At least one usable saved source is required for new-article outline generation.

## Grants, budgets and locking

A grant binds run fingerprint, template/stage, exact permitted task names, inputs, model/endpoint/settings, source policy, limits, revision permission and approved outline when applicable. Preview -> exact-fingerprint authorize -> explicit execute. Revoke/cancel or any input/service/outline change prevents the old grant from authorizing new work.

Defaults: task totals model8/search3/page5/active900000ms. Each new grant is bounded by remaining totals and normally up to3 model calls (audit1); output/HTTP/body limits still apply. Step kinds are checked against task names to prevent charging a model call to a different quota. Failed attempts/retries count; no implicit refund. A successful optional revision is allowed only once per run, even across epochs. Larger total budget must be explicitly saved and reauthorized. Dollar cost remains unknown; observed tokens/credits are not exact billing or a refund promise.

Acquisition and writes require owner + generation + live45s lease. Heartbeat accounts active time and renews; author waiting is not counted. Reserve input/quota before dispatch, mark dispatched before the call, then validate and checkpoint. Host writes use short transactions/SAVEPOINTs; no await inside. Fencing prevents late workers from committing. Nested local source/proposal/report/adoption effects share the checkpoint transaction.

## Recovery and history

Completed matching step artifacts are reusable; public query keys also include model settings, searches include request/service credential-name identity, pages include URL/policy. Private task keys include epoch/request/model; budget-only changes preserve them. Meaningful input refresh increments epoch, revokes grant and resets current downstream pointers, while old artifacts and spent attempts remain.

An abandoned reserved attempt is NOT_SENT; a dispatched attempt without a saved response is outcome-unknown. Explicit recover refuses a live lease. Explicit retry of unknown outcomes needs acknowledgement of possible duplicate processing/charges. No background auto-resend, no end-to-end exactly-once claim. Error diagnostics store safe codes, not raw provider bodies. A cancellation can outlive local waiting on the server.

Approvals and candidate adoption are host actions. A selected outline version must be current. Adoption is atomic across new document/intent/profile/run/event; the same candidate returns the same document on repeat. Alternative candidate adoption after completion refuses. Old text-change approval still uses the original engine and per-block preconditions, independent from report feedback.

## Validation boundaries

Default tests use fixed outputs and loopback HTTP, including the production search/model adapters; real website/model effects require separate opt-in testing. Scope/quote guards do not guarantee fidelity or complete evidence discovery. Full-screen UI, streaming, PDF, unrestricted crawling, Skills/MCP and arbitrary workflow code remain outside v0.0.6.

## v0.0.7 opt-in extension fields

Optional config.extensions is captured and fingerprinted; absence preserves legacy fields. Content requests may carry skills and draft section metadata, never public query-plan. Sources may carry exact mcp origin. Shared fetch quotas cover author-selected MCP reads; no model-defined arbitrary function calls. New chapter candidates support bounded larger quote arrays; old request validation remains intact. See extensions-protocol.md.
