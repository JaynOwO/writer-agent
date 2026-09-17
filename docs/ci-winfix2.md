# CI repair notes / CI 修复说明 — winfix2

## Evidence / 已有证据

The failed source is PR #9 head `48faa54c23fda6743c2147688496abc78c1694f3`, bundle SHA-256 `f841113a32b930a110b597d7d3d2f8d6973f6ae727592d797dfb6c6a112175b7`. The attached task points to that exact package, not a later patch.

Windows Actions logs show `RUNNER~1` temporary ancestors and 20 updater tests failing at the repository-root equality guard. They do not print both compared paths. A DOS8.3/long-name mismatch is therefore strongly indicated, not yet a directly instrumented Windows reproduction in the authoring environment. The repair uses native realpath plus bigint filesystem identity instead of relying on spelling. New tests retain root rejection and run a real short-path roundtrip under Windows; POSIX alias tests are separate evidence.

Linux Node24 fails before desktop tests because its SUID helper is not correctly configured. Node22's green job had skipped desktop smoke. The new CI step verifies the cached official archive and extracted helper, installs only that helper into a new root-owned `/opt/siglum-ci-sandbox-<run>-<attempt>` directory, verifies bytes and root:root mode4755, uses `CHROME_DEVEL_SANDBOX`, and removes the helper in an `always()` step. No sandbox-disabling switch or global policy change is added.

A clean local Electron smoke run then exposed a separate existing test path error: `../../cli/package.json` from the desktop root incorrectly addresses `source/cli`. The correct sibling is `../cli/package.json`. The actual native-binding check is retained and the test path corrected.

## 中文摘要

这次针对同一目录被 Windows 路径校验误判、Linux CI 沙箱未配置两类失败进行修正，并在干净本地桌面测试中发现、修正了凭据绑定测试的依赖路径多退一级问题。没有删除失败测试、关闭沙箱、修改私稿或直接更改远端 PR。

Windows 原日志没有打印两个待比较路径，因此短／长名是有力线索，不冒称已在这里复现 Windows。新增回归会在 Windows CI 实际获取短路径进行校验；本地 POSIX 分支不等于 Windows 通过。Node22／24 的四个检查均保留。单任务超时为 20 分钟，检查失败仍会阻止合并。

## Apply / 应用

Select the new `writer-agent-v0.0.9-delivery-winfix2.zip` in the existing, working Updater v0.2. Preview and approve a new task. Do not continue the old hash-pinned task expecting new source, edit PR #9 in place, change a cached manifest, or manually reset/clean worktrees.

在正常工作的 v0.2 面板选择新修正包，预览后授权新任务。旧任务／PR #9／旧包保留，不手改已批准的状态。运行中的更新器本体不会被源码导入自动替换。最终是否通过 Windows 与托管 Linux CI，应以修正包的新任务结果为准。

## Primary implementation references

- Node filesystem APIs: https://nodejs.org/api/fs.html#fsrealpathsyncnativepath-options and https://nodejs.org/api/fs.html#class-fsstats
- Chromium user namespace restrictions / SUID helper option: https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md
- Chromium SUID sandbox development: https://chromium.googlesource.com/chromium/src/+/main/docs/linux/suid_sandbox_development.md

Actual authoring-run results and untested environments are recorded in the delivery VALIDATION.md, not asserted by these design notes.
