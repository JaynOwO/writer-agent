# Repository instructions

## Collaboration and authorized scope

The owner decides product scope. ChatGPT authors implementations; the owner currently integrates/tests/publishes them with GitHub Desktop. Do not require Codex/Spark access. Give the owner one small, actionable integration step at a time.

v0.0.2 is authorized for Apache-2.0 adoption, proposal protocol v1, bounded HTTP transport, native Ollama and OpenAI Chat Completions-compatible adapters, CLI suggest/review workflow, tests and docs. Read docs/v0.0.2-spec.md, docs/provider-protocol.md, docs/security-model.md and docs/limitations.md.

Do not add GUI, autonomous research, streaming, source/claim graphs, learned preferences, MCP/Skills execution, hosted services, extra dependencies or data migrations without a separate scope decision. Do not choose another license, add restrictions to Apache-2.0, claim trademark registration, or publish packages on the owner's behalf.

## Git and source integration

- Target repository: JaynOwO/writer-agent. Verify origin before any push.
- Use a feature branch, e.g. feat/v0.0.2-model-providers. Never push directly to main/master.
- Never force-push, delete branches, rewrite shared history, reset/clean away work or auto-merge.
- Import updates only against the verified baseline and a clean worktree. Refuse collisions, modified source, symlinks and wrong repositories. Do not overwrite private data.
- Review all staged files. Exclude manuscripts, databases, .env, credentials, runtime exports, node_modules and build outputs.
- Authentication failures must be reported; never ask the user to paste keys or tokens into the conversation.

## Required validation

Dependencies and pnpm-lock.yaml remain unchanged from v0.0.1. Use `pnpm install --frozen-lockfile`. Do not fabricate or casually regenerate the lockfile.

```sh
pnpm check
pnpm demo
pnpm demo:provider
```

Windows PowerShell users with blocked .ps1 shims can use pnpm.cmd without changing execution policy. CI tests Linux/Windows with Node 22/24. Default tests and the provider demo use only synthetic loopback HTTP, never paid endpoints or model downloads. Real inference is opt-in and must be reported separately. Never claim installs, tests, smoke checks, Git writes or CI succeeded unless actually verified.

## Invariants

1. Providers never receive storage APIs or authority to accept edits. Model output is untrusted data, not executable code.
2. CLI suggest previews by default. Only --send invokes HTTP. Remote endpoints additionally require --allow-remote and HTTPS.
3. No automatic retry, repair, credential fallback, redirect following or provider switching.
4. Read secrets only from configured process environment names at send time. No literal key flags, prompt inclusion, logging or database persistence.
5. Validate the full output before saving any proposal. Preserve exact block ID/text and monotonic version checks. Reject a stale document head after inference.
6. No database transaction over network waits. Revision/head/change/decision updates remain atomic.
7. Accept/reject/revert require explicit user actions. Revert never destroys unrelated accepted edits.
8. Notes/lexical hints are not facts, evidence support, calibrated confidence or permanent preferences.
9. Schema v1 is unchanged. Markdown is explicitly imported/exported, not live-synced.
10. A loopback server can still relay to cloud inference. Never promise privacy based solely on its URL.
