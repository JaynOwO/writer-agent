# Connections, verification and reading reports — Siglum v0.0.8

[English](product.md) | [简体中文](product.zh-CN.md)

## 1. Entry points and compatibility

The workspace below is a **separate writing directory**, not the source repository. Do not initialize over existing manuscripts. RUN_ID and DOC_ID are placeholders; the numbered guide avoids manual ID copying.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo:product
pnpm siglum product doctor
pnpm siglum product guide ../existing-writing --lang en
pnpm siglum product guide ../existing-writing --lang zh-CN
```

Windows PowerShell can use `pnpm.cmd` without loosening security policy. `demo:product` creates a disposable workspace, uses this repository's fictional MCP program, fake model HTTP and an **in-memory fake credential backend**, and ends with `PRODUCT_DEMO_OK`. The official SDK executes, but this is not independent service interoperability, real keyring or real inference validation.

Workspace schema6 is retained; code installation never upgrades private data. Earlier workspaces retain the existing explicit backed-up migration path. New user-local connection metadata is in a separate `connections.sqlite` schema1. Old tasks without `navigationSummary`/`connectionRefs` retain their behavior; historical reports do not acquire invented SDK, credential or summary usage.

## 2. Named connections and credentials

The product guide creates, replaces, disables and explicitly binds presets to tasks. The ordinary writing/review guide and workflow model chooser can also select a saved model. Selecting a preset is not permission to send: inspect and authorize the exact request/stage.

Presets describe a model, fixed Tavily Search endpoint, or registered MCP connection. Normal settings contain the model, destination, timeout/output caps and a reference, not the key. Choose exactly one credential source; **there is no automatic fallback**:

- OS store: Windows Credential Manager, macOS Keychain, or explicitly Linux Secret Service. No kernel-keyring fallback, plaintext file or encryption with its key stored beside the ciphertext.
- Environment: save a variable **name**, resolve it from the local process only at use time.
- Session: process memory only. After exit the saved reference has no secret; reopening reports it missing instead of searching for another key.
- None: for services not requiring authentication.

Keys use masked terminal entry, not command arguments, normal JSON, URLs, logs or model packets. EOF/Ctrl+C does not consent to save. An unavailable/locked/denied store is not a successful empty credential. Authorized process memory necessarily contains secrets transiently; JavaScript strings are not guaranteed to be securely erased and a compromised local machine is outside this protection.

Configuration directory: Windows `%LOCALAPPDATA%\Siglum`, macOS `~/Library/Application Support/Siglum`, Linux `$XDG_CONFIG_HOME/siglum` or `~/.config/siglum`. Keep it out of Git/reports. It is nonsecret metadata, not the OS vault, and does not encrypt manuscripts/backups. The OS item namespace is `Siglum/credentials/v1`.

Replacing creates a new version; affected tasks need re-selection and consent. Keys do not silently move to a changed destination. OS/config databases have no shared transaction: journal a random new item, write the new reference, compensate only this attempt's unreferenced item on failure. The explicit orphan-recovery menu handles only Siglum-owned records. Old unreferenced versions can be cleaned explicitly. Removing a **local** key does not revoke it at the provider.

A workspace credential reference cannot unlock a local key by itself: an author-created local task/destination binding is required. Copied tasks, forged references and changed endpoints stop. Stdio still uses explicitly named environment variables; an HTTP OS token is not silently injected into a process. Stdio presets allow only the no-HTTP-credential mode.

## 3. Official MCP SDK and old registrations

`@modelcontextprotocol/client@2.0.0` is actually installed and locked. The SDK owns protocol/lifecycle/client requests. The host retains bounded stdio framing, guarded HTTP responses, schema subset, consent and quotas. No native protocol fallback executes. See the [compatibility matrix](extensions-protocol.md).

The adapter is part of launch identity. **Old v0.0.7 MCP registrations cannot automatically inherit execution trust.** The extensions server menu can re-register the current program/SDK after showing its configuration, then trust/discover separately and select the new catalog in affected tasks. Old records remain historical. Equivalent noninteractive commands:

```sh
pnpm siglum mcp renew ../existing-writing OLD_SERVER_ID
pnpm siglum mcp renew ../existing-writing OLD_SERVER_ID --apply
pnpm siglum extensions guide ../existing-writing --lang zh-CN
```

Renew previews by default. Apply only creates a new registration: it does not trust/start/rewrite tasks. For HTTP MCP authenticated by an OS preset, choose the product guide's saved-credential catalog discovery. It requires an exactly matching trusted registration and sends the key only to that endpoint. Then select exact tool arguments and bind the preset to the task.

No OAuth, arbitrary callbacks, automatic reconnect/fallback, binary results or OS sandbox is introduced. Text tools/resources are the supported scope. An SDK capability is not author authorization; read-only annotations are not safety proofs. Trusted child programs can still access files/network. Shutdown manages direct child processes/pipes, not arbitrary grandchildren.

## 4. Three levels of validation and recovery

`product doctor` reads local metadata and resolves package entry locations. It does not validate an account, resolve external DNS, read/unlock keys or launch a third-party program. A package `passed` result only means its entry was located, not that a service works.

The product guide separately authorizes real checks:

- Model: at most two requests to revise/review a synthetic sentence using normal workflow/proposal validation; no manuscript adoption. Whether text is changed depends on model output.
- Search: one fixed basic Tavily query, no generated answer or automatic depth upgrade.
- MCP: connect/launch and discover tools/resources only. Discovery can still cause service-side behavior or costs.
- Credentials: one random synthetic item, create/read/replace/delete/verify missing. No other-app enumeration. Failed cleanup leaves an owned operation record for explicit recovery.

The preview pins destination, model, synthetic input, timeout, request/output caps and launch hash. States distinguish `passed`, `failed`, `not-run`, `not-configured`, `unsupported`, `cancelled` and `outcome-unknown`. Pre-dispatch cancellation is not success. A possibly dispatched failure is conservatively uncertain and never silently retried. Raw provider error bodies and keys are excluded; returned tokens/credits can be recorded, monetary cost is unknown without pricing.

Local probe records include OS, Node, SDK version and time. The bounded synthetic model trial removes its disposable workspace afterward and retains a nonsecret summary; it is not a private manuscript recovery mechanism. Actual writing tasks retain the existing runner:

```sh
pnpm siglum product recovery ../existing-writing RUN_ID
pnpm siglum workflow guide ../existing-writing --lang zh-CN
```

Recovery explanations list saved artifacts, status, quota and potential duplicate processing, but execute no action. Changed inputs/permissions still require consent. Closing the foreground terminal does not leave a background worker.

## 5. Optional navigation summaries

Enabling `navigationSummary` on a new-article task refreshes the capture and revokes old consent. Research produces at most one successfully cached navigation summary over **selected original passages**; failed/retried attempts still count. No whole-library scan, private-to-public query leakage or one-call-per-chunk behavior is added.

Summary artifacts retain exact original ranges, model/prompt version, input/output, omissions and returned usage, labelled `derived-navigation-not-evidence`. Outline/chapters still receive originals. A multi-source note is included for a chapter only when all its quoted sources are present; half the supporting context is not silently removed. Quotations must match the actual supplied text.

**This is conservative navigation assistance, not guaranteed context compression.** Original selected evidence remains, so inputs, time and cost may increase. Real inference comparisons are needed for savings or quality claims. Changed evidence selection/question/model/version changes cache identity. Saved matching summaries survive later-step retry without an extra call. No recursive summary-of-summary loop is implemented.

Disabled means no new summary task. Summaries cannot approve text, activate preferences or certify facts. They cannot be cited as an original report; unavailable/oversize/mismatched originals remain errors or unresolved evidence, not invented quotations.

## 6. Private static HTML reports

The guide exports a manuscript, task, or metadata-only diagnostic snapshot. Noninteractive examples:

```sh
pnpm siglum product report ../existing-writing run RUN_ID ../reading.html --text --sources --guidance --lang zh-CN
pnpm siglum product report ../existing-writing document DOC_ID ../document.html --text --lang en
pnpm siglum product report ../existing-writing run RUN_ID ../metadata-only.html --lang zh-CN
```

Reports are **read-only time-point snapshots**, not GUI editors or live database views. They show candidates, exact full before/after text (not minimal word diff), assessments/feedback, evidence ranges, supplied guidance and recovery status at generation. Export makes no new model call and has no accept/revert/resume buttons.

No text is included by default. `--text`, `--sources`, `--guidance` allow the corresponding structured content groups separately. Excluded fields are absent from the file, not hidden in CSS/DOM. However, manuscript/model prose can already repeat evidence or preferences: the switches are not semantic redaction. Inspect before sharing; metadata-only is preferable for debugging.

Raw Markdown/HTML is escaped as text, not executed. No JavaScript, external CSS/fonts/images/forms; restrictive CSP is an extra layer. HTTP(S) source links are visited only by explicit clicks, without referrer or prefetch. Output directory must exist, destination must not; a sibling temporary file and atomic no-overwrite publication are used. Filesystems without hardlink support return an error rather than overwriting. Oversize reports fail explicitly, not silently truncating history.

Rendering and file-opening policy are distinct: exact HTML can be tested in Chromium, while `file://` access may be administrator-blocked. Do not disable system protection or equate browser component tests with Windows/Edge validation.

## 7. Validation boundaries

The supplied Windows Node24.18.0 preparation report demonstrates basic SDK stdio and isolated keyring2.1.0 binding roundtrip/reopen/cleanup; **not the full v0.0.8 Windows application**. Default regressions/demos use owned HTTP/MCP fixtures and fake credential backends. Official SDK server fixtures are SDK-to-SDK, not independent third-party certification.

Linux Secret Service can be unavailable without a login session. macOS, Windows application behavior and real OS store tests are separately reported. Real Tavily/model/independent MCP interoperability and summary quality require explicit configured trials; software includes no private credentials or quota.

See [dependencies](dependencies.md), [extension compatibility](extensions-protocol.md), [architecture](architecture.md), [security](security-model.md) and [limitations](limitations.md).
