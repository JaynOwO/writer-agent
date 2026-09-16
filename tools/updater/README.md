# Siglum Updater 0.2.0 preview

[English](README.md) | [简体中文](README.zh-CN.md)

This is the developer's source integration tool, **not the desktop writer or its ordinary end-user installer**. It is a separate authenticated local browser panel. No GitHub write occurs from opening the panel, selecting a ZIP, or previewing a Release.

## One-time setup

Extract the bootstrap ZIP into its own folder, not into your repository and not over v0.1.2. In a terminal run the included bootstrap.mjs using your existing Node22.16+ (the owner's Node24 is suitable). Node, Git, pnpm10.11 and GitHub CLI still belong to the developer toolchain. Existing gh login is reused; no token is copied into updater config. The bootstrap copies this verified version into the user's stable application-state location and creates Windows Desktop/Start-menu shortcuts; it does not disable OS protections, install services, or request administrator elevation. Run from a trusted package only; its hashes are integrity checks, not publisher signatures.

```text
node bootstrap.mjs
```

The stable root is Windows Known Folder LocalApplicationData/SiglumUpdater (Linux XDG state home/siglum-updater). A versioned current.json/start.mjs launcher verifies file hashes before loading program code. Previous program versions and configuration backups remain. Do not overwrite an updater while a task is running. A subsequent updater version requires its own explicit bootstrap/migration; arbitrary self-update is not automatic.

In the panel, confirm your existing repository path. Known old Downloads/v0.1 layouts offer a path hint only; unusual locations can be selected by entering the repository root once. The first preview verifies Git and the approved GitHub numeric repository identity. Existing custom push URLs, unsupported SSH aliases, inaccessible old names or a mismatching origin may require inspection; they are not globally rewritten. No blanket takeover of arbitrary Git repositories is supported.

After setup, use the Siglum Updater shortcut. Closing a browser tab does not stop the host: use Quit to pause and exit. The temporary local session link includes authorization; do not share it. Refresh reuses only this local browser session, not a GitHub credential.

## Source ZIP integration

Drop/select the **source delivery** ZIP. Names such as `(1).zip` are accepted; selection uses the manifest, stable identity, exact base and complete SHA-256 map, not filename or modification time. The original ZIP is copied into a fixed hash cache. A newer download never replaces a running task's package.

Preview then choose full integration or PR-only. This explicit choice authorizes the trusted project's install/build/test recipe, feature push and PR; full mode additionally allows CI-gated pinned-head merge and safe local finishing. Project tests execute code. A worktree is not an OS sandbox. Do not import untrusted project bundles.

The tool uses a separate task branch/worktree, preserving the original checkout and index. It records applied/validated/committed/pushed/PR/CI/merge/local-sync phases. Pending external outcomes are read back before retry. Source and lockfile changes require revalidation; no failed test is treated as success. It waits at most15 minutes per foreground continuation, then keeps state for Continue. The trusted required matrix is Ubuntu/Windows × Node22/24, not any random green status. The client locks PR head and rechecks base but cannot replace strict server-side branch rules atomically.

After remote merge, the original checkout is advanced only when on the approved main branch, clean, and safe to fast-forward. Otherwise remote success is displayed separately from pending local sync. No automatic stash/reset/clean/force push. Cleanup removes only verified owned unchanged task refs/worktrees; ignored build output may make Git refuse removal. Retention produces a warning, not a false failed merge or unsafe deletion. These retained directories can use disk space; this preview intentionally does not recursively delete unknown output.

Continue uses recorded task/package IDs. A same-version patch is a different package identity. Do not hand-edit manifests or rerun an old repair script. Modified managed worktree contents are retained and diagnosed rather than automatically three-way overwritten; patch replacement of an unfinished old task may require an explicit new validated task. Incomplete v0.1.2 histories are not blindly adopted as v0.2 records.

## Rename and identity

This configured project is github.com repository1370967185 / node R_kgDOUbdMkQ / owner255999131, currently named JaynOwO/writer-agent. Before external operations the GitHub adapter resolves the same stable ID to current canonical name and URLs. Normal same-owner renames and owner login changes keep tasks/PR/cache/Release associations. A fork, replacement same-name repo, different ownerID, inaccessible/archived target or changed base blocks execution. Names are presentation/history only; local config/worktree/credential namespaces do not follow repository slug changes. Existing historical bundles remain byte-identical.

The first identity binding is explicit. A bound v0.2 project can survive reuse of its old name; an unbound old origin pointing to a different repository cannot be accepted merely because it shares commits. Custom origin/pushurl/SSH configurations are preserved, not rewritten. No production rename is performed by setup or tests. The updater does not rename the GitHub repository or change third-party hardcoded links.

## Public Release download

Local delivery remains necessary for development not yet pushed to GitHub. The optional Release view only reads the bound repository's public Releases, with a GitHub-digested `siglum-release.json` describing recognized source/updater/desktop products. No descriptor means “unrecognized”, not guessing that main/tag is an installer. Prerelease filtering and the two product version streams stay separate.

Descriptor schema:

```json
{"format":1,"repositoryId":"1370967185","products":[{"product":"siglum","kind":"source-delivery","version":"0.0.9","assetId":123456789,"sha256":"REPLACE_WITH_THE_ACTUAL_ASSET_SHA256"}]}
```

The above is documentation only (placeholder ID/hash), not a publishable descriptor. An authorized Release publisher must replace it using the **actual uploaded asset ID and actual file hash**. No Release is published by this version. Supported kinds: source-delivery, updater-bootstrap, desktop-portable, desktop-installer; product is siglum or siglum-updater. The updater refuses mismatched kinds. Desktop files are downloaded only; installation is a separate app action. Asset ID/digest/size/update-time are rechecked; public redirects do not receive a GitHub token. Private authenticated asset download is deliberately unsupported in this preview.

## Diagnostics and boundaries

Metadata diagnostics exclude ordinary paths and source/private-writing contents. Live project stdout may contain sensitive text; inspect before sharing logs. The complete state/cache database is not a public diagnostic attachment. GitHub main merge, local sync, cleanup, CI, release publication and desktop installation are distinct facts. Errors do not justify bypassing any guard.

Tests use temporary real Git repositories and a fake GitHub service. The browser integration fixture has an explicit simulated author and mocked validation hook. Neither proves real rename/Release/CI/Windows bootstrap behavior. Linux and Windows evidence are reported separately. Apache-2.0 remains unchanged; keep the included LICENSE.


## Windows rename correction (winfix1)

A bootstrap self-test reported `EPERM` on Windows while publishing its temporary version directory. Directory and `current.json` publication now allow at most 11 rename attempts with 10 waits totaling 5.5 seconds (excluding filesystem operation time). Only `EPERM`, `EACCES` and `EBUSY` are eligible; the error alone does not identify antivirus or indexing as its cause.

Recheck the package and destination state before each attempt. A competing destination, changed current pointer or changed package fails without deleting the installed destination/pointer. Persistent denial still fails, and no test is disabled. Retry only the local rename, not GitHub requests or whole installation steps.

An already installed, working v0.2 panel can import `writer-agent-v0.0.9-delivery-winfix1.zip` directly. A same-version corrected ZIP has its own hash, unapproved task and managed worktree; explicitly preview and authorize it. Keep the failed old task/cache intact. Continuing the old task deliberately continues its old pinned bytes, not the corrected ZIP. This correction changes neither the desktop application, dependency lock nor private writing.
