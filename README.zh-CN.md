# Siglum

[English](README.md) | [简体中文](README.zh-CN.md)

<!-- siglum:version=0.0.6 -->
<!-- siglum:license=Apache-2.0 -->
<!-- section:intro -->
面向研究、写作与审稿的本地优先 Agent Harness。

**模型提出建议，来源可追溯，作者保留最终决定权。**

**v0.0.6** · 命令行开发预览版 · **Apache-2.0**

在自己的工作区保存文稿版本、来源快照、论断标注、审稿报告与经过作者确认的写作要求。模型可以起草意图、归纳候选偏好、提出修改或分析变化，但不能批准自己的输出。现在可按阶段授权执行有界研究写作；仍不是完整桌面 IDE 或无限制自主 Agent。

产品名称为 Siglum。仓库 `JaynOwO/writer-agent`、包名 `@writer-agent/*`、`.writer` 数据路径和交付文件名保留兼容；`pnpm siglum` 与 `pnpm writer` 等价。

<!-- section:quickstart -->
## 不需要模型 Key 的演示

使用 Node.js **22.16+** 和固定 **pnpm 10.11.0**。CI 配置覆盖 Linux／Windows 的 Node 22／24。首次安装依赖需要网络；默认测试与演示使用虚构文本、预设响应和本机 HTTP 服务，不调用收费模型、不自动下载模型。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo
pnpm demo:provider
pnpm demo:sources
pnpm demo:review
pnpm demo:memory
pnpm demo:workflow
```

Windows PowerShell 拦截 `.ps1` 时可使用 `pnpm.cmd`，不用修改执行策略：

```powershell
pnpm.cmd check
pnpm.cmd demo:memory
```

预期标记：`DEMO_OK`、`PROVIDER_DEMO_OK`、`SOURCES_DEMO_OK`、`REVIEW_DEMO_OK`、`MEMORY_DEMO_OK`, `WORKFLOW_DEMO_OK`。**这些标记验证程序流程，不代表真实模型的改稿质量或学习偏好的准确率。**

<!-- section:workflows -->
## 按阶段授权的写作工作流

提供资料写新稿、修改已有文章、只审查待采用修改三个固定模板。阶段授权固定输入、模型、接口、资料范围与次数上限；执行器在批准范围内推进，到大纲和最终采用检查点停下。原有独立命令仍保留逐次授权。

```sh
pnpm siglum workflow help
pnpm siglum workflow guide ../my-writing --lang en
pnpm siglum workflow guide ../my-writing --lang zh-CN
```

新稿联网研究需要你自己的 Tavily Key（`TAVILY_API_KEY`）与兼容模型，不附送账户或余额。查询规划只拿单独批准的公开 brief；搜索固定 basic，关闭自动参数、自动答案、raw content 和图片。实际获取的网页保存为不可变来源快照；无法读取就记录缺口，不把搜索摘要冒充已读证据。查看资料选择范围与遗漏说明。

批准大纲不等于批准写作阶段。候选 A、审稿与可选候选 B 都先作为私人产物；明确采用才建立文稿。旧稿的替代提案仍针对保留的正式基线。每项任务最多成功执行一轮自动修订，不按自评分循环。

默认总预算为 8 次模型尝试、3 次搜索、5 次页面尝试和 900000 毫秒活跃执行时间，另有阶段上限。匹配的已保存结果可复用；结果未知的请求需明确确认才可重新尝试，可能重复调用／计费。过期执行锁需要明确恢复，两个终端不能提交同一步。没有后台守护进程或自动重试；缺可靠计费数据就显示费用未知。

见[工作流指南](docs/workflows.zh-CN.md)、[English guide](docs/workflows.md)与[工作流协议](docs/workflow-protocol.md)。真实搜索／模型互操作和写作质量尚需主动实测，演示使用本机假服务。

<!-- section:writing-memory -->
## 意图与写作记忆，由作者掌控

用几句话说明文章目的，或在编号向导里选择模板。模型生成的意图卡在确认前只是草案；手工保存则属于明确确认。选择一个可复用档案，偏好按档案、语言和任务隔离，不会自动套用其他档案。

```sh
pnpm build
pnpm siglum init ../my-writing "My writing workspace"
pnpm siglum import ../my-writing ./examples/sample.md "Test article"
pnpm siglum guide ../my-writing --lang en
```

使用简体中文菜单：

```sh
pnpm siglum guide ../my-writing --lang zh-CN
```

向导用编号选择文稿、档案、修改、报告和偏好候选，不需要复制 ID。支持返回和取消，不默认发送请求或批准内容。拒绝理由可以跳过。只有主动选定带理由的反馈并请求归纳，才会生成候选；你选择启用后才生效。多次无理由拒绝不等于某种文体偏好的证据。

本次例外可以覆盖普通的篇章／档案默认值，但不改写长期规则。与必选结构规则冲突时，需要对那一条规则明确授权例外；自由文字的含义冲突不会被自动理解。筛选按档案、语言、任务、优先级和稳定 ID 确定性执行，最多 20 条档案规则、3 个另行授权示例和 24,000 字节序列化 UTF-8 内容；必选与明确选定内容超限会拒绝，不悄悄截断。不使用向量数据库，也不额外调用检索模型。

使用快照记录当时真正提供了哪些意图与规则版本。适用要求变化会让捕获的请求／报告失效，无关档案不受影响。固定短语／码点数检查属于机械判断，语气与含义仍属于模型意见。参见[简中记忆指南](docs/memory.zh-CN.md)、[协议](docs/memory-protocol.md)和[英文指南](docs/memory.md)。

<!-- section:sources -->
## 保留来源，而不是只留网址

采集明确选定的公开 URL，或导入 UTF-8 HTML、Markdown、纯文本。保存原始字节、提取文本、网页报告的元数据、采集时间、提取器版本与哈希。刷新追加快照，不覆盖旧依据；未知元数据保留 null。

```sh
pnpm siglum source import ../my-writing ./examples/research-fixture.html
pnpm siglum source list ../my-writing
pnpm siglum source search ../my-writing "correlation"
pnpm siglum source help
```

`source add`／`refresh` 在添加 `--fetch` 前只预览；本地搜索不是全网搜索。片段位置指提取文本中的行，不冒充 HTML 原始坐标或 PDF 页码。研究笔记留在本地，不自动变成偏好或发给模型。参见[来源指南](docs/sources.zh-CN.md)。

<!-- section:models -->
## 模型提出修改，作者决定采用

适配器：`ollama` 和 `openai-compatible`（Chat Completions，不是 Responses API）。兼容模型／服务需自行准备，软件不附送模型或 API 余额。

```sh
pnpm siglum model
pnpm siglum help
```

`suggest` 预览发送目标、来源选择与写作要求计划。`--send` 授权一次推理；远端还需要 `--allow-remote`。整理意图、归纳偏好和语义审稿各自需要独立发送授权。向导展示具体选中内容，再确认发送；没有隐藏的自动重试、修复请求、换服务或第二裁判。

请求成功仅原子保存待审核提案及来源／要求快照，正文不变。接受、拒绝、撤回仍由作者分别操作。`provenance` 是 supplied-not-verified，不代表模型真正采用、正确引用或来源支持结论。凭据只从指定进程环境变量读取，不接受明文 Key 参数。参见[模型指南](docs/providers.md)。

<!-- section:semantic-review -->
## 论断台账与语义审稿

手工标注或明确请求模型提取候选论断，引文与位置对固定版本精确校验。确认标注不等于证明论断真实；重要观点与意图约束由作者明确指定。

```sh
pnpm siglum claim help
pnpm siglum review help
pnpm siglum memory help
```

用独立选择的模型检查待审核修改，可明确选择全文范围。报告区分机械观察、`model-assessment-not-verified` 模型判断与作者反馈。带要求的审稿增加原意／风格偏离提示，但不能改变正文批准状态。引文位置正确不代表推理正确，零问题也不是“可放心接受”的认证。

报告保留输入版本历史。相关文稿、待审修改、论断决策或写作要求变化后，报告标为过期。记忆功能之前的旧报告保持“未记录要求”，不伪造过去已经应用的偏好。参见[审稿指南](docs/review.zh-CN.md)。真实模型质量尚未验证，80 条双语评估案例的标签仍是等待人工审阅的草案。

<!-- section:status -->
## 已实现能力与边界

| 部分 | 已实现 |
| --- | --- |
| <!-- feature:revisions --> 版本 | SQLite、精确块／原文／版本校验、待审提案和独立段落的接受／拒绝／撤回 |
| <!-- feature:providers --> 模型 | 预设 Mock、Ollama 原生 chat、Chat Completions 兼容适配器 |
| <!-- feature:sources --> 来源 | 明确 URL／文件采集、不可变快照、本地子串搜索 |
| <!-- feature:excerpts --> 片段 | 提取文本精确行／偏移与引文哈希 |
| <!-- feature:notes --> 笔记 | 本地快照／片段笔记，不悄悄加入模型请求 |
| <!-- feature:provenance --> 来源记录 | 与提案原子保存的选定来源上下文 |
| <!-- feature:bindings --> 关联 | 固定版本的段落／来源关联；段落变化即标为过期 |
| <!-- feature:claims --> 论断 | 手工／候选标注、作者决策、重要观点 |
| <!-- feature:semantic-review --> 审稿 | 独立任务、选定资料评估、历史报告与作者反馈 |
| <!-- feature:intent --> 意图 | 版本化手工／模型草案卡片、模板、确认、已有重要论断引用 |
| <!-- feature:writing-memory --> 记忆 | 分范围档案、候选确认、本次例外、有界筛选与精确使用记录 |
| <!-- feature:terminal-guide --> 向导 | 英文／简中编号菜单、取消、明确发送和批准 |
| <!-- feature:bilingual --> 文档 | 双语 README／来源／审稿／记忆指南及机械一致性检查 |
| <!-- feature:workflows --> 工作流 | 阶段授权、三个模板、独立候选产物与明确采用 |
| <!-- feature:web-search --> 搜索 | Tavily basic、公开查询隔离与来源记录 |
| <!-- feature:durable-resume --> 恢复 | 持久尝试、预算、租约防并发、未知结果与本地幂等采用 |

<!-- limit:no-gui --> **没有 GUI 或打包桌面编辑器。** 向导是交互式终端，不是可视化富文本编辑器。

<!-- limit:bounded-web-search --> **真实搜索有明确边界，不是无限浏览。** 新稿研究接入 Tavily Search 与公共静态网页；搜索摘要不是已获取的证据。已有文章的改稿／审稿模板使用明确选定的本地来源。

<!-- limit:no-semantic-verdict --> **不认证事实，也不保证理解原意。** 机械检查不能验证模型结论或发现全部自由文字冲突。

<!-- limit:block-edits --> **正文仍按完整文本块修改。** 未实现句子级独立撤回。

<!-- limit:static-extraction --> **只做静态 UTF-8 提取。** 无 PDF、JS 渲染、浏览器登录、压缩、重定向或完整 HTML5 解析。

<!-- limit:manual-migration --> **不自动迁移私人数据。** 新工作区使用 schema v5，旧 v1–v4 保留各自已有功能；工作流需要明确授权、先备份再升级。更新代码不迁移私人稿件。

<!-- limit:no-background-learning --> **没有后台学习、微调、向量库或 Skills／MCP 执行。** 归纳候选需主动请求，启用需作者确认。title 只是规则适用标签，不是新的标题生成命令。

<!-- limit:memory-retention --> **停用不等于擦除。** 旧请求、数据库、备份和远端服务可能保留过去内容。导出默认去掉示例，但不会识别规则里手打的秘密；导出／发送前需检查内容。本版不承诺安全删除。

<!-- section:privacy -->
## 本地保存，明确发送

本地优先不保证推理完全本地：回环地址的服务也可能转发云端。私人记忆示例需每次另外选中。档案导入／导出是明确操作；导入规则在新档案中保持候选，不自动关联或启用。模型／网页文本不能授予文件、数据库、批准或凭据权限。

私人数据库和导出文件没有加密，不要提交 Git。网页获取有大小上限、DNS／IP 检查和地址固定，但不是网络沙箱。迁移前关闭其他会话；备份在 `.writer/backups/`，不要覆盖正在使用的 SQLite／WAL 数据库。

<!-- section:development -->
## 开发与验证

没有新增第三方运行时依赖，保留原依赖锁文件。通过有界代码使用 Node 的 SQLite、测试器、fetch 与 readline。默认测试不调用收费模型；操作系统、模型和安装结果必须分别报告。

[架构](docs/architecture.md) · [命令行](docs/cli.md) · [v0.0.6 规格](docs/v0.0.6-spec.md) · [已知限制](docs/limitations.md) · [贡献说明](CONTRIBUTING.md)

<!-- section:license -->
## 许可证

**Apache-2.0**，参见 [LICENSE](LICENSE)、[NOTICE](NOTICE) 和[许可说明](docs/license-status.md)。项目包保留 `private: true` 防止误发布 npm，这不改变许可证。软件许可不会自动改变你自己的文稿、导入资料、模型或外部服务的权利与条款。
