# Providers and real-model smoke tests

v0.0.2 implements HTTP adapters. Protocol tests use synthetic local servers; passing them does not demonstrate real-model quality or provider compatibility. No real model is bundled or downloaded automatically.

## First run: no key, no model installation

From the repository after dependencies are installed:

```powershell
pnpm.cmd check
pnpm.cmd demo
pnpm.cmd demo:provider
```

The last command runs a fake HTTP server on loopback and exercises both adapter formats. Success ends in `PROVIDER_DEMO_OK`. It is not actual AI inference and incurs no external model API calls. First-time dependency installation still needs network access. On non-Windows shells, `pnpm` replaces `pnpm.cmd`. Keep the pinned pnpm version and existing lockfile.

## Prepare a disposable document

```powershell
pnpm.cmd build
pnpm.cmd writer init "..\writer-smoke" "模型试验"
pnpm.cmd writer import "..\writer-smoke" ".\examples\sample.md" "测试文稿"
pnpm.cmd writer list "..\writer-smoke"
```

Read the returned document ID. Replace `DOC_ID` below with that actual ID; do not paste the literal placeholder. Do not initialize a workspace inside the source repository. Use test text, not your only manuscript copy.

## Local Ollama

Install/start Ollama and download a suitable text model separately. Find its exact local model name using Ollama's own tools. Replace `YOUR_INSTALLED_MODEL` below; the example does not select or recommend a specific model.

```powershell
pnpm.cmd writer suggest "..\writer-smoke" DOC_ID --provider ollama --model YOUR_INSTALLED_MODEL --instruction "精简句子，保留归因和不确定性。"
```

This prints a preview only. It uses `http://127.0.0.1:11434/api/chat`. To actually request a proposal, repeat with `--send`:

```powershell
pnpm.cmd writer suggest "..\writer-smoke" DOC_ID --provider ollama --model YOUR_INSTALLED_MODEL --instruction "精简句子，保留归因和不确定性。" --send
```

No key is needed for an ordinary local Ollama server. Real success depends on the installed server/model and hardware. The model must follow the protocol; weak/incompatible output will be refused, not silently repaired. A slow model may need `--timeout-ms 300000` (up to 600000). The adapter does not set `think`; it never treats separate thinking output as the answer. Ollama Cloud is not an advertised supported target for this schema-based native adapter. A local server may route to the cloud; verify its model/configuration yourself.

## OpenAI Chat Completions-compatible endpoint

Use an exact model name and an API **base**, such as `https://api.openai.com/v1`, not the full `/chat/completions` URL. This adapter is not the Responses API and does not cover all providers/models. For a remote endpoint, review which service receives your entire selected document. ChatGPT/Codex usage entitlements are not used by this project.

Store an API key only in the current PowerShell process, using a concealed prompt rather than putting its literal value in shell history:

```powershell
$secret = Read-Host "API Key (do not screenshot)" -AsSecureString
$env:WRITER_AGENT_API_KEY = [System.Net.NetworkCredential]::new("", $secret).Password
Remove-Variable secret
```

This is temporary process memory, not encrypted persistent storage. The key must never be sent to the maintainer/chat or committed to Git. The software does not load `.env` files. Preview without sending:

```powershell
pnpm.cmd writer suggest "..\writer-smoke" DOC_ID --provider openai-compatible --model YOUR_SUPPORTED_MODEL --base-url "https://api.openai.com/v1" --allow-remote --key-env WRITER_AGENT_API_KEY --instruction "精简，但不改变意思。"
```

After reviewing the destination, add `--send` to make a potentially billable request. Remove the variable when done:

```powershell
Remove-Item Env:WRITER_AGENT_API_KEY
```

Default wire options are `response_format: json_schema` with strict schema, `max_completion_tokens: 4096`, `stream: false`. A service without strict schema support can be explicitly configured with `--response-format json` or `--response-format prompt`. Older compatible endpoints can use `--token-parameter max_tokens`. These never disable the local protocol validation. A failed request does not trigger retries or automatic switching to cheaper/other providers. The max-output setting does not guarantee a dollar budget.

## Review, then decide

A successful request reports `status: pending-review`, `manuscriptChanged: false` and pending changes. Model notes are labeled unverified, not saved as facts/preferences. Review original text, replacement, lexical warnings and notes:

```powershell
pnpm.cmd writer changes "..\writer-smoke" DOC_ID
pnpm.cmd writer accept "..\writer-smoke" CHANGE_ID "接受这一项"
pnpm.cmd writer reject "..\writer-smoke" OTHER_CHANGE_ID "不接受改变语气"
pnpm.cmd writer revert "..\writer-smoke" CHANGE_ID "恢复原句"
```

Replace each ID with the exact returned ID. These commands are independent examples, not something to paste unchanged as a batch. Same-block later modifications can cause a safe conflict, as in v0.0.1.

## Error interpretation

| Code | Meaning / next check |
|---|---|
| PROVIDER_CONFIG | Endpoint/model/option invalid, or remote use not explicitly permitted |
| PROVIDER_AUTH | Key missing/malformed, 401 or 403; check chosen environment variable and permissions |
| PROVIDER_RATE_LIMIT | 429: quota/rate limit; no automatic retry |
| PROVIDER_HTTP | Other non-2xx response; check model, base and supported wire options |
| PROVIDER_NETWORK | Service unavailable or connection broken |
| PROVIDER_TIMEOUT / PROVIDER_CANCELLED | No proposal saved; upstream compute/billing may still continue |
| PROVIDER_REDIRECT | Configure the final intended API base explicitly |
| PROVIDER_BAD_RESPONSE | Invalid envelope, finish state, JSON, UTF-8, tool call or content type |
| PROVIDER_TRUNCATED | Incomplete generation; no partial edits saved |
| PROVIDER_REFUSAL | Refusal/filter; no edits saved |
| PROVIDER_TOO_LARGE | Request/response exceeds byte limit |
| PROVIDER_INVALID_PROPOSAL | Wrong IDs/before text/schema/size/extra fields; no entries saved |
| STALE_REVISION | User changed document during inference; request a fresh proposal |

Real smoke evidence should name the provider, exact model, selected modes, server version where known, and result. Use synthetic text and redact credentials. Do not describe fake-server results as real model tests.

## v0.0.3：明确提供来源资料

`suggest` 新增 `--sources <snapshotId,...>` 与 `--excerpts <excerptId,...>`，先用 `source` 命令采集并选定资料。默认仍只预览，`--send` 才发送。最多 8 项、序列化后 80000 UTF-8 字节；不会自动截断或发送笔记。`writer provenance <workspace> <changeId>` 查询当次提供的原文和来源 ID，标记为 `supplied-not-verified`，不证明内容为真或足以支持某条断言。完整例子见[简中来源指南](sources.zh-CN.md)。
