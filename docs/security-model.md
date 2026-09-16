# Security and privacy model — development preview

## Trust boundaries

Models and their output are untrusted data. The core, storage and locally installed application/provider code are trusted executable code; this is not a sandbox against malicious plugins or a hostile local account. Prompt instructions ask the model to preserve meaning but do not guarantee it. Providers return untrusted proposals, assessments or workflow candidates. They cannot approve text, alter grants, accept/reject/revert or execute arbitrary tools.

The current application validates at the HTTP/protocol boundary, the application boundary and the transactional storage boundary. A document modified while the model is generating rejects that old response entirely. No network wait happens inside a SQLite transaction. Interrupts, malformed responses and failures do not create partial proposals. Cancelling the client does NOT guarantee the upstream server stops inference or billing.

## Outbound data and consent

`writer suggest` without `--send` only prints a destination/model/size preview. `--send` transmits the full selected document snapshot (including block IDs and version), instruction, protocol schema and explicitly selected source context. Other workspace documents, file paths, stored decisions and secrets are not included in the model prompt by this application. Using a remote endpoint requires `--allow-remote` and HTTPS. These are local CLI consent flags, not a general operating-system network firewall.

Loopback endpoints are 127.0.0.1 or ::1; localhost is normalized to 127.0.0.1. Local HTTP is allowed. Remote HTTP, URL userinfo, query strings and fragments are rejected. All HTTP redirects are refused: a response cannot redirect a bearer token/manuscript elsewhere. No arbitrary tool calls, shell commands, browser browsing or MCP/Skills are exposed to the model.

A local Ollama or compatible server can itself relay to a cloud provider. Names visibly tagged `cloud` require remote permission, but that name check cannot establish where inference actually occurs. Use a locally downloaded model and verify your server's configuration for offline/private inference. Do not infer privacy merely from a localhost URL. Non-loopback private-LAN servers also require HTTPS and explicit remote permission in this version.

## Credentials

Only a configured environment-variable NAME is stored in provider settings. The value is fetched just before sending and used as the Authorization header. There is no dotenv loader, login automation, browser-session reuse or subscription-token workaround. Missing or malformed keys fail before HTTP. Non-loopback OpenAI-compatible endpoints default to WRITER_AGENT_API_KEY; local compatible services and Ollama default to no key. An explicit --key-env can enable auth for either adapter.

Credentials are not encrypted by environment variables; they exist in process memory and can be visible to privileged local software. They are not an OS credential vault. They must not appear in a command-line argument, committed config, manuscript, database, terminal screenshot or support chat. Do not set keys in shared CI environments. Error messages use fixed descriptions, not raw response bodies, network causes or abort reasons. There is no telemetry. The chosen remote service still receives the Authorization header and applies its own data/billing policies.

## Resource and cost boundaries

Requests/responses are limited to 8 MiB (including encoded JSON), and streamed body reads count actual bytes even without Content-Length. Defaults: one attempt, 120 seconds across headers and body, 4096 output tokens. No silent fallback, automatic retry or repair request. The user may adjust the deadline/token settings within documented limits. These bounds do not predict input tokens, enforce a dollar budget or guarantee the upstream provider honors a request limit. Provider quotas/billing limits remain separate.

## Storage and rendering

New workspaces use schema v5. Legacy v1–v4 retain their original feature levels; newer features require the explicit backed-up migration below. Private workspaces remain separate from the code repository; routine backups remain the user's responsibility. Data is not encrypted. CLI results use JSON escaping so model text is not directly rendered as terminal control sequences. Model-response notes are unverified and transient; user-authored research notes are stored locally; accepted/rejected decisions remain explicit. Do not use the prototype as the sole storage of important manuscripts.

Report reproducible bugs without keys or personal text. Supply minimized synthetic examples, command option names, version and error code, not raw provider responses containing secrets.

## v0.0.3 source intake and provenance boundary

Public-page intake is a separate explicitly invoked host capability, not a model tool. Preview performs no DNS/HTTP. --fetch restricts HTTP(S) default ports, refuses URL credentials/backslashes/control characters, checks all DNS answers against a conservative public-address policy and pins one checked address. Pooling, redirects, retries, cookies and auth are not used. TLS validation remains enabled. Time/headers/streaming-byte/media-type/UTF-8 guards bound intake. Compression, browser rendering, subresource loading and script execution are unsupported. Local-source import is an explicit user-selected file operation, not a URL-controlled filesystem read.

Raw bytes and extracted text are preserved separately. Snapshots, notes and snippets are private, unencrypted database content. Do not upload them by default. HTML extraction is not a browser/security sanitizer for rendering: raw.bin must not be rendered as trusted HTML. Hash validation detects accidental drift, not a hostile database owner who also replaces hashes. Egress controls are still necessary for strong network isolation; public-address routing and local OS behavior are outside the application boundary.

Only explicit snapshots/excerpts enter model context; raw HTML, notes and local absolute file paths do not. No source is promoted to trusted instructions, and all model output passes the original approval boundary. Context metadata is host-derived and revalidated at atomic proposal insertion. "supplied-not-verified" must not become a source-support verdict. Source bindings are author-created and become stale after same-block edits.

Source tables were introduced in schema v2; current new databases use v5. Old databases require explicit backed-up migration for newer tables; original editing remains compatible. A cooperative migration lock and data-version recheck detect common concurrent writes. Close older clients before migration. Backups remain on failure; do not overwrite a live database for recovery or automatically remove an unexplained migration lock. No code-updater step migrates user data.

## v0.0.4 analysis controls

Claim extraction and review are separate explicitly authorized model calls, preview-only until --send; remote destinations retain --allow-remote. Analysis uses value snapshots only, never database/approval/source-fetch tools. All source/manuscript text remains untrusted. This limits side effects, not persuasive prompt injection or factual errors.

Independent host validation checks exact quote coordinates, local candidate references, selected-source quotations, pending operation fingerprints and document/annotation freshness. Schema validation is not proof of semantic validity. Positive/conflicting selected-evidence assessments require exact quotations, but their reasoning remains attributed and challengeable. No selected material means not-assessed. No auto-accept, retry, repair, source lookup, model escalation or inferred persistent preference is added.

Reports retain full selected text inside the private, unencrypted workspace. JSON exports are explicit and refuse existing paths; they are not sanitized for public distribution. Never commit them. Provider diagnostics do not include raw error bodies or keys. Returned usage is recorded, not estimated money; cancellation may not prevent upstream billing. Successful records are append-only with hashes, not tamper-proof against an owner of the database.

Feedback can target historical reports and records the current manuscript revision at the time of feedback. It is not a reanalysis or approval of the current text. Changed briefs require a new run, and absence of findings is not a safety signal.

## v0.0.5 author-guidance boundaries

Stored rules are data, not tools, code, factual proof or system-permission changes. Only author confirmation activates model/import candidates. A webpage, quoted example, repeated rejection or model output cannot directly activate preferences. Each intent draft, preference draft, writing request and review has separate explicit send authorization. Existing keys, source-only permission, no retries/redirects and bounded transport stay intact.

Only selected profiles/languages/tasks and independently authorized examples enter requests. Reasons without selected contrast permission omit manuscript before/after text. No background preference mining or OS/global file scanning occurs. Important claim changes, intent or applicable rule changes invalidate captured work before persistence; no transaction spans a network wait. Changes/usage are saved atomically. Neither feedback nor mechanical-rule warnings approve or silently rewrite text.

Profile import is preview/candidate-only and never auto-attaches. Export defaults to no examples/history IDs and cannot overwrite files; arbitrary rule text is not secret-redacted. The guide strips terminal controls from displayed text and refuses nonTTY mode rather than treating piped input as consent. This is not an OS sandbox or a complete terminal-security audit.

Disable stops new selection only: old snapshots, SQLite backups and service copies can retain text. User data is unencrypted. There is no secure deletion, automatic cross-workspace synchronization or new credential manager. Code update never migrates private workspaces; explicit schema4 migration retains a verified backup and preserves original records.

## v0.0.6 workflow grants and search

Standalone sends/fetches remain individually authorized. A WorkflowGrant is a separate opt-in host record that permits a bounded set of stages/tasks under fixed inputs, endpoint/model, search public brief and resource quotas. No model-controlled next-action, approval, budget increase, path execution or memory activation is trusted. Stage execution is foreground-only.

The query planner receives only the separately approved public brief/language, not private drafts, profile examples, research notes or author follow-up from the outline discussion. Tavily receives bounded queries and approved filters; its key is sent only to the fixed API endpoint. Model credentials never follow search URLs. Discovery strings are untrusted, scores are not credibility, and snippets cannot become fetched evidence. Dynamic result URLs retain existing public-IP validation and DNS pinning, no redirects or scripts.

Checkpointed attempts precede dispatch; expired/revoked workers are generation-fenced. Unknown external outcomes cannot silently replay. Local effects and artifacts share short transactions, no network waits. Author adoption is idempotent; no run/template can approve its own manuscript or permanent rules. Budgets constrain attempts/output/time, not an absolute monetary bill. Cancellation does not guarantee server cancellation/refund. Preserve private historical material and inspect exports before sharing; this is not a security sandbox against the local account owner.

## v0.0.7 explicit Skills/MCP boundary

Skills import bounded text, not executable packages. Enablement is distinct from import and stage consent; changed activation/package versions invalidate captures. References require explicit relative path/line selections. Compatibility descriptions and allowed-tools are not authority. Neither Skill text nor tool results can activate preferences, accept manuscripts, run source-supplied code or create connections.

MCP connection trust authorizes external launch/contact and is required even for discovery. Stdio runs with the current user's permissions: not an OS sandbox. Only known installed executables are allowed without shell/npx, inherited environment names are bounded, executable/direct file arguments are fingerprinted; this does not authenticate transitive dependencies, prevent disk secret reads or guarantee grandchild termination. Remote HTTP uses explicit destinations and optional bearer env names without redirects/OAuth fallback. Tool readOnly hints do not prove safety. Only author-selected read/compute-purpose calls with exact arguments/descriptors enter phases; destructive-declared tools are refused. Limits/schema restrictions are fail-closed, not claimed full protocol conformance.

Every logical MCP call uses durable pre-dispatch reservation and shared fetch quota. Credentials never enter model evidence. Third-party returned text retains origin, is not a direct-page-fetch attestation and does not trigger URL/resource fetching. Late/revoked results cannot persist as current. Invalid/timed-out post-dispatch results are not silently retried; unknown service effects/costs remain unknown. The owned test fixtures prove software pathways, not trustworthiness of actual servers.

Research ranking/heading normalization are derived; raw source coordinates and hashes stay pinned. Indexing a source does not mean the model read it. Citation maps verify source-entry quotations and structural locations only, not entailment or author truth. Source/map exports may be private, are unencrypted and refuse overwrites. Existing source SSRF protections do not attest that a separate MCP server applied them to its own network calls.

## v0.0.8 product and credential boundary

Official SDK adoption does not authorize additional tools, callback handlers, destinations or default environment inheritance. The SDK is lazy-loaded behind bounded host transports; changed adapter identity requires renewed trust. Cached/history data does not obtain retroactive SDK verification.

API tokens live in an explicitly selected OS store, process environment or process-only session map, never normal preset/workspace values. Host resolver/assertCurrent callbacks do not serialize to provider descriptions. User-local bindings prevent a copied workspace credential ref from silently selecting an installed key. Local filesystem owners/trusted malicious processes can still compromise data; hashes and OS-store access are not adversarial sandboxing. Linux Secret Service is explicitly pinned, with no keyutils fallback. Keyring/config operations are not cross-database atomic; new random entries are journalled and cleanup targets only owned unreferenced entries. Self-test cleanup failures remain explicitly recoverable. No other application credentials are enumerated.

Navigation notes cannot replace or certify original evidence. They and external MCP text remain data, not tool/permission/memory instructions. Reports are read-only static snapshots: private groups are explicitly selected, raw HTML escaped, no JavaScript/remote assets/forms, restricted CSP and no-referrer external links. Excluded structured data is not hidden in DOM; prose itself can repeat secrets, so export flags are not automatic semantic redaction. Never share reports as though they were automatically scrubbed.

`product doctor` only resolves package paths and reads local metadata. Live probes need their own bounded confirmed fingerprint; cancelled/unconfigured/unknown states are not success. Diagnostic model trials are synthetic, isolated and not a substitute for actual manuscript quality review. No runtime Updater manipulation, Git execution, hidden retry, account creation or payment is added.
