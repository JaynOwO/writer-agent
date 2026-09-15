# writer-agent

A local-first agent harness designed for research, writing, revision, and semantic diff.

**v0.0.1 — executable revision-core preview, not a complete writing app.**

当前版本先验证最重要的底层：文稿不会被模型悄悄覆盖；每项修改可被审查、接受、拒绝，并在无冲突时单独撤回。还没有图形界面、在线搜索、真实模型调用或长期偏好学习。

## Run the offline demo

使用 Node.js **22.16+**（建议使用仍受维护的 22/24 分支的最新补丁）与 pnpm 10。本版本固定 pnpm 10.11.0、TypeScript 5.8.3、Node 类型定义 22.19.7；这些是本交付的版本选择，不表示最新版本。

```sh
pnpm install --no-frozen-lockfile
pnpm check
pnpm demo
```

第一次导入源码包时，正常联网安装会生成 `pnpm-lock.yaml`，请与初始化代码一起提交。之后使用 `pnpm install --frozen-lockfile`。不要手写锁文件。首次安装需要联网下载开发依赖；**安装完成后的演示和测试不需要网络、模型账户或 API Key**。

`pnpm demo` 自动建立独立临时工作区，返回保存路径，最后输出 `DEMO_OK`。演示使用预先写好的 Mock 数据：接受两项修改、拒绝一项，再撤回第一项；第二项的润色保持不变。演示目录不会自动删除，可按输出路径查看导出的 Markdown。

当前版本通过 Node 自带的 `node:sqlite` 访问 SQLite。Node 22 上出现 `ExperimentalWarning` 是预期的运行时提示，不等同于测试失败；这项依赖尚不是长期兼容承诺，已隔离在 storage 包内。

## Included

| Module | Implemented in v0.0.1 |
| --- | --- |
| `packages/core` | 无损文本分块、稳定 block ID、单调版本、精确修改前置条件、规则型风险提示 |
| `packages/storage` | 本地 SQLite、事务、文稿、追加式版本、修改提案、接受/拒绝/撤回、决策理由 |
| `packages/models` | `ModelProvider` 接口与离线 `MockModelProvider`，未接入真实服务 |
| `apps/cli` | 工作区、Markdown 导入/导出、提案审查操作、历史查询、完整离线演示 |
| `tests` | 规则样例、事务故障注入、版本冲突、Unicode、持久化和 CLI 集成测试 |

### Review hints are not semantic understanding

规则只匹配少量中英文用词变化，例如“可能”消失、归因消失、增加“导致”、删除“部分”。它可能误报、漏报，既不查证来源，也不判断作者真实意图。`tests/src/review.test.ts` 包含明确的漏报案例。**不能把测试通过解释成语义审稿准确率。**

### Local data boundary

文稿保存在用户选择的工作区，数据库为 `.writer/workspace.sqlite`。v0.0.1 以 SQLite 为唯一持久化权威来源；Markdown 通过显式命令导入/导出，不存在文件监听或双向自动同步。工作区默认生成忽略私有内容的 `.gitignore`。数据未加密，不应将原型用于唯一一份重要稿件。

### Selective revert boundary

当前修改单位是**文本块**，通常对应由空行分隔的段落。每项提案替换一个完整块，同一批不能重复修改同一块。不同块可独立接受/撤回；同一块后来被改动时，旧提案或旧撤回会报告冲突，不能强行覆盖。句子级 patch、结构移动、依赖图和自动重定位尚未实现。

## Commands and documentation

```sh
pnpm build
pnpm writer help
pnpm writer init ../my-writing "My writing workspace"
pnpm writer import ../my-writing ./examples/sample.md "试验文稿"
pnpm writer list ../my-writing
```

命令行详解见 [docs/cli.md](docs/cli.md)；架构见 [docs/architecture.md](docs/architecture.md)；验收边界见 [docs/v0.0.1-spec.md](docs/v0.0.1-spec.md)；已知限制见 [docs/limitations.md](docs/limitations.md)。

## Next milestones (not implemented)

后续依次验证真实模型的结构化编辑接口、来源与论断链接、作者意图及显式偏好，再建设编辑器 UI、MCP/Skills 权限边界。不会为了让演示好看，把关键词规则伪装成完整 Semantic Diff。

## License status

开源许可证尚未选择，当前包的 `license` 明确标为 `UNLICENSED`，不自动发布到 npm。正式开源发布前需由维护者选择并添加许可证。见 [docs/license-status.md](docs/license-status.md)。
