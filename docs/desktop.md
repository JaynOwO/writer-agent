# Siglum v0.0.9 desktop preview

## What this build is

A local Electron desktop writer, not a remote website or a generated HTML report. SQLite remains canonical. The UI calls a restricted preload; storage, credentials and work run in a separate utility process. It does not expose Git, arbitrary commands, SQL or renderer-selected filesystem paths.

Windows x64 distribution is a **portable folder with an explicit built-in current-user install action**, not a separately signed Setup.exe/MSI. Extract the entire package, keep DESKTOP_MANIFEST.json with Siglum.exe, and open Siglum.exe. Opening an app does not authorize network calls. “Install locally” copies verified program files into a version directory under LocalApplicationData/Programs/Siglum and adds Desktop/Start-menu links and a current-user uninstall entry. Old versions and private data are retained. Uninstall verifies owned files and does not delete writing, connections or OS keys. The Windows registry/shortcut/install path must be exercised on Windows; Linux filesystem tests do not certify it. Application code is not Authenticode-signed. Do not disable Smart App Control or SmartScreen.

Ordinary writers need neither Git nor a separate Node installation for the desktop folder. Developers building source still need the documented Node/pnpm tools. The source-integration Updater is a different application and permission boundary.

## First writing session

Open or create a writing workspace using the native dialog. A v1–v6 workspace requires a separate, backed-up schema7 migration before range editing. Close other sessions first. Installing/updating code does not migrate any writing database.

Import a UTF-8 Markdown/text article or create one. Editing preserves stable blocks. An editing buffer is automatically saved locally after composition finishes; choose **Save article** to commit it. A saved buffer is not an accepted model proposal. Conflicting old buffers are retained, not force-applied. Copy needed text before explicitly discarding a conflicting buffer. Last characters not yet saved cannot be guaranteed after power loss. Cross-block split/merge/move is not a first-version editing operation.

Create/select a model connection. Supported adapters remain Ollama and Chat Completions-compatible; a model or API balance is not bundled. Credential modes are explicit (OS store / environment / current session / none), and credentials are not returned to the renderer. Advanced Skill/MCP configuration, preference distillation/import and some detailed source/excerpt management remain available through the existing CLI guides. The desktop can continue existing extended workflows; new desktop workflows currently select stored sources and built-in search rather than configure arbitrary new tool grants.

## Review actual ranges

Request edits, choose evidence, and confirm the exact preview before dispatch. Model output remains a pending block proposal. **Split into reviewable ranges** makes a separate host-derived range set pinned to that proposal and baseline; the original history is not rewritten. Check only desired ranges. Accept/reject/revert is explicit and atomic for the selected set.

The first-class operation unit is a replacement/insertion/deletion within a stable block, not a model-provided sentence number or a first string match. Nonintersecting history is mapped deterministically. Same-position insertion ambiguity, grapheme splitting, dependencies, overlap or missing history refuse mutation. A compensating revert preserves unrelated accepted edits. Later manual work overlapping the range blocks direct revert instead of restoring an old paragraph snapshot. Accepted legacy whole-block changes keep the original explicit revert path.

Semantic review of pending ranges combines the selected operations against current mapped text. Exact quotation/offset checks, mechanical observations and model assessments are separate. Range rejection can stale a report even when the article head did not change. Citation maps pin source entries and versioned text; they do not certify factual support. Later edits conservatively stale affected associations.

## Writing runs and connections

Three templates remain: new article, revise existing article, review selected pending block proposals. Range review is available on the article sidebar. New-article navigation summaries and chapter drafting are opt-in; existing-article templates retain current intent and profile. Stage previews fix model, sources, budget and exact inputs. Confirm outline separately, then authorize composition. Candidate adoption is idempotent; a preview or autosave never approves AI text.

The task page shows saved artifacts, paused/unknown attempts and explicit retry/recovery. Closing a window asks before abandoning unsaved typing or active jobs. Saved results remain; a dispatched request may have an unknown outcome. There is no hidden permanent daemon or automatic retry. A loopback model can itself relay to cloud services.

HTML reading reports remain escaped, static time-point exports and do not gain write buttons. Export only selected groups; prose may already contain private quotes, so metadata exclusion is not complete semantic redaction. All writing databases/backups/exports remain private and unencrypted.

## Source development

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm desktop:runtime
pnpm desktop
```

`desktop:runtime` explicitly downloads the pinned official runtime in apps/desktop/runtime-lock.json and verifies size/SHA-256; it does not install packages, run downloaded apps or access credentials. `desktop` never downloads implicitly. A trusted existing runtime directory can be passed as `--runtime`. The official runtime is pinned separately from the genuine pnpm lockfile; no fabricated npm Electron installation is claimed.

```sh
pnpm desktop:smoke
pnpm test:interfaces
```

The smoke fixture creates temporary synthetic workspaces and a loopback model server, not real inference. Linux requires a graphical display or xvfb and an unprivileged sandbox-capable user. Do not add --no-sandbox. Windows runs the desktop directly. Source test success, a real Electron window, Windows installation, system keyring sessions, GitHub CI and real service quality are distinct evidence.

See packaging.md, range-edit-protocol.md, and ../tools/updater/README.md. Keep LICENSE, NOTICE, upstream runtime LICENSE/LICENSES.chromium.html and dependency licenses with distributions.
