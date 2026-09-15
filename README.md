# Writer Agent

A local-first writing agent harness with reviewable model proposals.

**v0.0.2 — Apache-2.0 / model-provider development preview.**

让 AI 提出修改，让作者决定是否采用。现在支持本地文稿版本、逐项接受/拒绝/撤回、Ollama 与 OpenAI Chat Completions-compatible 接口。模型不能直接改写正文。**还没有图形界面、自动研究、来源库或完整语义审稿。**

## 不需要 API Key 的验证

使用 Node.js 22.16+（已配置 CI 覆盖 22/24）和固定 pnpm 10.11.0。已有锁文件，不要手写或无故重建它。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo
pnpm demo:provider
```

Windows PowerShell 可将 `pnpm` 写成 `pnpm.cmd`。首次安装开发依赖需要网络；之后测试只使用离线夹具和本机假 HTTP 服务，不需要模型账户、API Key、Ollama 安装或外部推理请求。

`demo` 验证原有修改接受/拒绝/撤回流程，结束为 `DEMO_OK`。`demo:provider` 验证两个 HTTP 适配器的完整提案流程，结束为 `PROVIDER_DEMO_OK`；**它返回预设测试内容，不是真正的 AI**。演示会返回独立临时工作区路径，不会把测试文稿写进仓库。

## 实际调用模型

```sh
pnpm build
pnpm writer model
pnpm writer help
```

`writer suggest` 默认只预览发送目标、模型与文稿大小。加 `--send` 才发送当前选定文稿与编辑指令；远端还须加 `--allow-remote`。调用成功只生成 pending changes，正文不变。用户之后通过 `writer changes` 审查，再单独 `accept`、`reject` 或 `revert`。

使用自己的本地模型或合法 API 凭据。真实模型/服务需自行安装或取得访问权限，软件不下载模型、不复用聊天订阅会话。完整 Windows 示例、密钥的遮蔽输入与错误代码见 [模型使用指南](docs/providers.md)。不必现在购买 API 额度。

## 这一版包含

| 模块 | 内容 |
|---|---|
| core | 原有无损文本分块、稳定 ID、单调版本和词汇风险提示 |
| storage | SQLite schema v1；事务、版本、提案、决策理由，旧工作区无需迁移 |
| models | Mock、严格 Proposal v1、Ollama native chat、OpenAI Chat Completions-compatible |
| transport | 超时/取消、字节上限、错误分类、拒绝重定向、显式远端授权、无自动重试 |
| CLI | 模型说明、发送预览、suggest、原有 changes/accept/reject/revert/history |
| tests | 原有回归测试、假 HTTP 服务、坏响应/错原文/并发改稿/隐私与 CLI 测试 |

没有新增第三方依赖：继续使用 Node 内置 fetch、HTTP、SQLite、test runner 和已有 TypeScript 开发依赖。`node:sqlite` 在 Node 22 上可能显示实验性警告；同步持久化仍是原型设计，不是生产级稳定性承诺。

## 必须知道的边界

- **词汇提示不是完整 Semantic Diff。** 当前四类规则会误报/漏报，不核实来源，也不判断作者真实意图。模型意见同样不算已核验的事实。
- **单独撤回仍按文本块。** 同一块后来被修改会拒绝旧撤回；没有句子级 patch、结构移动或自动重定位。
- **密钥不随文稿保存。** 只按配置读取进程环境变量；不自动加载 .env，没有持久化凭据库。不要把密钥、私人稿件或数据库提交到 Git。
- **本地优先不等于所有推理本地。** --send 会将完整选定文稿交给配置的服务；localhost 服务也可能转发云端。离线推理需已下载的本地模型及相应服务配置。
- **兼容接口不等于所有模型都兼容。** Chat Completions 适配器不实现 Responses API；严格/JSON/提示词模式需要显式选择，不会失败后偷偷重试或换服务。
- **不把通过测试写成效果保证。** 默认测试覆盖软件行为，不衡量真实模型的改稿质量；真实 API/Ollama smoke、Windows 和 CI 结果需分别确认。

## 文档

[CLI](docs/cli.md) · [Providers](docs/providers.md) · [Protocol](docs/provider-protocol.md) · [Security](docs/security-model.md) · [Architecture](docs/architecture.md) · [v0.0.2 spec](docs/v0.0.2-spec.md) · [Limitations](docs/limitations.md)

## License

Licensed under the **Apache License, Version 2.0**. See [LICENSE](LICENSE), [NOTICE](NOTICE) and [license notes](docs/license-status.md).

这份软件许可证不会自动改变你自己的稿件、导入资料、第三方模型或服务的权利与条款。所有项目包仍保持 `private: true`，以防误发布 npm；这不改变 Apache-2.0 授予的使用权。
