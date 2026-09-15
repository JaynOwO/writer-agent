# Security and privacy model — development preview

## Trust boundaries

Models and their output are untrusted data. The core, storage and locally installed application/provider code are trusted executable code; this is not a sandbox against malicious plugins or a hostile local account. Prompt instructions ask the model to preserve meaning but do not guarantee it. The program's safety property is that a provider can only submit pending proposals, not accept/reject/revert or execute tools.

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

New workspaces use schema v2. Old schema-v1 workspaces remain usable for original manuscript operations; source features require the explicit backed-up migration below. Private workspaces remain separate from the code repository; routine backups remain the user's responsibility. Data is not encrypted. CLI results use JSON escaping so model text is not directly rendered as terminal control sequences. Model-response notes are unverified and transient; user-authored research notes are stored locally; accepted/rejected decisions remain explicit. Do not use the prototype as the sole storage of important manuscripts.

Report reproducible bugs without keys or personal text. Supply minimized synthetic examples, command option names, version and error code, not raw provider responses containing secrets.

## v0.0.3 source intake and provenance boundary

Public-page intake is a separate explicitly invoked host capability, not a model tool. Preview performs no DNS/HTTP. --fetch restricts HTTP(S) default ports, refuses URL credentials/backslashes/control characters, checks all DNS answers against a conservative public-address policy and pins one checked address. Pooling, redirects, retries, cookies and auth are not used. TLS validation remains enabled. Time/headers/streaming-byte/media-type/UTF-8 guards bound intake. Compression, browser rendering, subresource loading and script execution are unsupported. Local-source import is an explicit user-selected file operation, not a URL-controlled filesystem read.

Raw bytes and extracted text are preserved separately. Snapshots, notes and snippets are private, unencrypted database content. Do not upload them by default. HTML extraction is not a browser/security sanitizer for rendering: raw.bin must not be rendered as trusted HTML. Hash validation detects accidental drift, not a hostile database owner who also replaces hashes. Egress controls are still necessary for strong network isolation; public-address routing and local OS behavior are outside the application boundary.

Only explicit snapshots/excerpts enter model context; raw HTML, notes and local absolute file paths do not. No source is promoted to trusted instructions, and all model output passes the original approval boundary. Context metadata is host-derived and revalidated at atomic proposal insertion. "supplied-not-verified" must not become a source-support verdict. Source bindings are author-created and become stale after same-block edits.

New databases use schema v2. Old databases require explicit backed-up migration for source tables; original editing remains compatible. A cooperative migration lock and data-version recheck detect common concurrent writes. Close older clients before migration. Backups remain on failure; do not overwrite a live database for recovery or automatically remove an unexplained migration lock. No code-updater step migrates user data.
