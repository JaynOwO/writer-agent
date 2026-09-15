# Siglum

[English](README.md) | [简体中文](README.zh-CN.md)

<!-- siglum:version=0.0.3 -->
<!-- siglum:license=Apache-2.0 -->
<!-- section:intro -->
面向研究、写作与审稿的本地优先 Agent Harness。

**模型提出建议，来源始终可追溯，作者保留最终决定权。**

**v0.0.3** · 命令行开发预览版 · **Apache-2.0**

Siglum 在本地保存文稿版本、审核决定和不可覆盖的来源快照。你可以明确选择资料片段，让配置的模型据此提出修改；模型不能自行接受修改。这是可以运行的开发核心，还不是完整的写作 IDE 或自主研究助手。

产品现在叫 **Siglum**。仓库继续使用 `JaynOwO/writer-agent`，工作区状态目录仍为 `.writer`，内部包名保留 `@writer-agent/*`，避免破坏已经跑通的自动更新工具。

<!-- section:quickstart -->
## 先运行离线演示

使用 Node.js **22.16+**（CI 配置覆盖 22、24 两个系列）和 **pnpm 10.11.0**。首次安装需要下载开发依赖；之后测试与演示只使用虚构资料、预设回答和本机 HTTP 服务，不需要模型账号、API Key，也不用先安装 Ollama。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo
pnpm demo:provider
pnpm demo:sources
```

Windows PowerShell 限制 `.ps1` 执行时，使用 `.cmd` 入口即可，不需要修改系统执行策略：

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd check
pnpm.cmd demo:sources
```

三个演示的成功标记分别是 `DEMO_OK`、`PROVIDER_DEMO_OK`、`SOURCES_DEMO_OK`。来源演示会导入虚构 HTML 资料，保存摘录与笔记，把摘录交给预设模型，记录来源，接受并撤回修改，最后导出保存的原始资料。**这些标记证明的是程序流程，不是真实模型的写作质量。**

<!-- section:sources -->
## 保存资料本身，而不只是链接

每次采集都有独立快照 ID、原始网页响应或文件字节、提取文本、SHA-256 哈希、采集时间、提取器版本和页面声明的元数据。没有作者或发布日期时保持 `null`，不会猜测补齐。再次采集同一网址会新增快照，不会替换旧提案引用的资料。

```sh
pnpm build
pnpm siglum init ../my-writing "My writing workspace"
pnpm siglum source import ../my-writing ./examples/research-fixture.html
pnpm siglum source list ../my-writing
pnpm siglum source search ../my-writing "correlation"
pnpm siglum source help
```

`pnpm siglum` 与 `pnpm writer` 等价。`source add <工作区> <网址>` 默认只预览，加 `--fetch` 才访问公开网站。摘录的行号从 1 开始、包含首尾行，指向**提取文本**，不是 HTML 源码行号或 PDF 页码。本地 `source search` 搜索已保存来源的最新快照，不搜索互联网。

采集、刷新、摘录、笔记、段落绑定和导出用法见[来源使用指南](docs/sources.zh-CN.md)。导出包含 `raw.bin`、`text.txt` 和元数据；不会自动打开或执行原始 HTML。请保留重要资料的独立备份。

<!-- section:models -->
## 明确选择交给模型的证据

模型适配器：`ollama` 和 `openai-compatible`（Chat Completions 格式，不是 Responses API）。

```sh
pnpm siglum model
pnpm siglum help
```

`suggest` 支持 `--sources <快照ID,...>` 和 `--excerpts <摘录ID,...>`。不会自行选择资料，也不会自动把私人研究笔记加入模型上下文。预览只显示目标服务、模型、文稿大小、来源 ID 和字节数，不打印资料正文。添加 `--send` 才发送所选文稿、编辑要求和资料上下文；远端模型还需要 `--allow-remote`，并可能产生服务费用。

请求成功后只生成**待审核修改**。查看、接受、拒绝和撤回仍使用 `changes`、`accept`、`reject`、`revert`，由作者明确操作。`provenance <工作区> <修改ID>` 可以查询当时提供的资料文本、快照或摘录 ID 与哈希。**“提供过”不等于“模型使用过”“已引用”“内容为真”或“足以支持论点”。**

详见[模型使用说明](docs/providers.md)和[提案协议](docs/provider-protocol.md)。模型凭据只从指定名称的进程环境变量读取，不应该放进文稿、来源快照、Git 或聊天消息。

<!-- section:status -->
## 已实现与明确未实现的功能

| 领域 | 当前预览版包含 |
| --- | --- |
| <!-- feature:revisions --> 文稿版本 | 本地 SQLite、文本块级提案、精确原文与版本冲突检查、接受／拒绝／撤回和决定理由 |
| <!-- feature:providers --> 模型 | 预设 Mock、原生 Ollama chat、OpenAI Chat Completions-compatible 适配器 |
| <!-- feature:sources --> 来源 | 明确授权后的单网址采集、本地 UTF-8 HTML／Markdown／文本导入、不可覆盖快照、本地子串搜索 |
| <!-- feature:excerpts --> 摘录 | 精确的来源文本行范围与摘录哈希 |
| <!-- feature:notes --> 研究笔记 | 绑定快照或摘录的本地笔记，不是自动记忆 |
| <!-- feature:provenance --> 提案来源 | 与待审核修改一起原子保存当次提供给模型的资料 |
| <!-- feature:bindings --> 段落绑定 | 作者将摘录绑定到特定文本块版本；正文变化后旧绑定显示为过期 |
| <!-- feature:bilingual --> 文档 | 英文与简中 README、双语来源指南、README 机械一致性检查 |

<!-- limit:no-gui --> **暂时没有 GUI 或桌面安装包。** 当前通过命令行和演示使用。

<!-- limit:no-web-search --> **没有全网搜索、爬虫或自主研究循环。** 需要提供单个网址或文件；来源搜索只针对本地资料。

<!-- limit:no-semantic-verdict --> **没有完整 Semantic Diff、论断账本或证据支持判定。** 词汇规则可能误报、漏报；测试通过不代表语义判断准确率。

<!-- limit:block-edits --> **修改仍按整个文本块处理。** 同一块后来被修改时，撤回旧修改会报冲突而非抹掉新内容。即便文字撤回，之前的来源绑定也保持过期，需要重新确认绑定。

<!-- limit:static-extraction --> **静态提取有明确限制。** 只支持 UTF-8 HTML／文本／Markdown，不支持 PDF、JavaScript 渲染、登录、嵌入资源、压缩响应或重定向。小型提取器不是完整 HTML 解析器、正文阅读器或页面截图；不常见的实体与排版可能存在差异，引用时应核对原始字节。

<!-- limit:manual-migration --> **不会偷偷升级已有工作区。** v1 工作区仍可使用原有改稿功能；来源功能需要明确执行带备份的 schema v2 迁移。更新程序代码不会迁移文稿。

<!-- limit:no-memory-tools --> **尚未学习写作偏好，也没有 Skills 或 MCP 执行。** 笔记与拒绝理由是记录，不是已经学会的规则。

<!-- section:privacy -->
## 隐私与信任边界

“本地优先”指存储方式，不保证推理完全在本地：本机模型服务也可能转发云端。只发送你有权传输的稿件与资料。来源快照和导出文件没有加密。

网页采集拒绝本机、内网和特殊用途地址，检查全部 DNS 返回地址，并将连接固定到已检查的地址。不会跟随重定向或执行来源中的指令。这是在降低网络风险，并不能替代网络出口控制或安全审计。资料始终作为不可信上下文提供给模型，模型不会获得文件系统、SQL 或接受修改的权限。

迁移旧工作区前请关闭其他使用该工作区的程序。先查看迁移预览，再明确执行；经校验的 SQLite 备份保留在 `.writer/backups/`。详见[迁移与恢复](docs/sources.zh-CN.md#existing-workspaces)和[安全模型](docs/security-model.md)。

<!-- section:development -->
## 开发

[架构](docs/architecture.md) · [命令行](docs/cli.md) · [v0.0.3 规格](docs/v0.0.3-spec.md) · [已知限制](docs/limitations.md) · [贡献说明](CONTRIBUTING.md)

项目仍然没有第三方运行时依赖，依赖锁文件与 v0.0.2 保持一致。CI 配置覆盖 Windows／Linux 和 Node 22／24，实际运行结果应单独确认。真实模型、公开网站的冒烟测试均需明确授权，与离线回归测试分开记录。

两份 README 需要同步修改。`docs:check` 检查版本、许可证、声明的章节／功能／限制、命令示例及本地链接；不证明翻译准确，也不自动验证说明文字中的事实。

<!-- section:license -->
## 许可证

使用 **Apache License, Version 2.0**。参见 [LICENSE](LICENSE)、[NOTICE](NOTICE) 与[许可证说明](docs/license-status.md)。

软件许可证不会改变你自己的稿件、导入资料、模型或第三方服务的权利和条款。项目包保留 `private: true`，防止误发布到 npm，不影响 Apache-2.0 授予的使用权。此处不主张已经注册商标，也不声称产品名具有排他权。
