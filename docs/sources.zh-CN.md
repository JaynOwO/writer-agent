# 来源库 — Siglum v0.0.5

[English](sources.md) | [简体中文](sources.zh-CN.md)

这一版提供的是**本地研究资料工作流**，不是全网搜索引擎或自主研究 Agent。来源是数据，不是指令，也不自动等于事实。下面使用兼容命令 `writer`，换成 `siglum` 也一样。尖括号中的 ID 需要替换成前一步输出的真实 ID。

## 不用网络和模型 Key 的首次演示

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm demo:sources
```

最后应出现 `SOURCES_DEMO_OK`。演示资料是虚构的，模型回答是预设的；程序会创建新的临时工作区并打印工作区、来源导出路径。这不代表执行了真实研究或真实推理。

## 创建工作区并导入资料

```sh
pnpm writer init ../my-writing "My writing workspace"
pnpm writer source import ../my-writing ./examples/research-fixture.html
pnpm writer source list ../my-writing
```

来源记录包含 `id`、`kind`、`locator`、`createdAt`。每份快照有独立 `id`、`sourceId`、`capturedAt`、`mediaType`、`rawHash`、`textHash`、`rawBytes`、`text`、来源声明的 `metadata`、`extractor`、`warnings`。哈希用于完整性检查，**不是数字签名，也不证明资料真实**。作者、发布日期等不会外部核验；缺失值保持 `null`。

本地支持 UTF-8 编码的 `.html`、`.htm`、`.md`、`.markdown`、`.txt`。原始文件字节与提取文本分别保存。原始资料上限 2,000,000 字节，提取文本上限 1,000,000 字节；非 UTF-8 文件不会被悄悄转码。只记录文件名，不把私人绝对路径带入模型上下文。

导入另一个同名本地文件，默认会建立另一条来源。要明确追加到某个文件来源，使用相同文件名并指定 `--source-id <来源ID>`，不能悄悄改变旧来源的身份。

## 明确授权后采集单个公开网页

```sh
pnpm writer source add ../my-writing https://example.org/report
pnpm writer source add ../my-writing https://example.org/report --fetch
```

第一条只预览，不进行 DNS 或 HTTP 请求。示例网址只是占位符，并不存在随项目提供的报告；请替换成你有权采集的公开页面最终地址。第二条才访问该网站，完整响应通过校验后才保存快照。

采集使用默认端口的 HTTP(S)，不带认证或 Cookie，不启动浏览器，不运行 JavaScript，也不下载嵌入资源。本机、内网与特殊用途地址会被拒绝；全部 DNS 返回值经过检查，连接固定到已检查的地址。不跟随重定向，需要自行确认最终地址。网址片段被移除，路径和查询参数仍参与来源身份，请勿在网址中放密钥。保留 TLS 验证，不自动重试或复用代理凭据。

总超时 20 秒，响应头上限 16 KiB，响应体受字节限制。只接收 HTTP 200 的受支持文本类型，要求不压缩并拒绝压缩响应。暂不支持 PDF、登录或付费墙流程、纯动态页面、非 UTF-8 文本等。失败不会留下半份来源。

```sh
pnpm writer source refresh ../my-writing <sourceId>
pnpm writer source refresh ../my-writing <sourceId> --fetch
pnpm writer source history ../my-writing <sourceId>
```

刷新也遵循默认预览、明确授权的规则。它会**新增**快照，旧快照、摘录和提案上下文不会改变。这不是持续同步的网站镜像。请遵守网站条款和资料权利；当前没有递归爬虫，也没有面向批量抓取的 robots 策略。

## 查看、搜索与摘录

```sh
pnpm writer source show ../my-writing <snapshotId>
pnpm writer source search ../my-writing "correlation"
pnpm writer source extract ../my-writing <snapshotId> --lines 3:5
pnpm writer source excerpts ../my-writing <snapshotId>
```

`show` 返回带行号的提取文本。摘录按从 1 开始、包含首尾行的范围截取，同时保存 UTF-16 字符串偏移与 UTF-8 内容哈希；处理 CRLF 和 emoji 时不会自动改换摘录位置。行号**不是 HTML 源码行号、页面坐标或 PDF 页码**。程序不接受手打一句话，再冒充从来源中摘出的原话。

`siglum-text-v1` 是不增加第三方依赖的小型静态提取器：移除脚本、样式和部分非文字元素，识别常见文本标签、常见和数字实体，并对 HTML 捕获给出限制提示。它不是完整 HTML5 DOM 解析器、无障碍树或高保真正文提取器。CSS 隐藏文本、复杂布局、异常嵌套、表格、不常见实体及导航文字可能产生差异。重要引用请核对原始字节。为避免脚本执行，导出字节文件叫 `raw.bin`，不会自动打开网页。

`search` 只对每个已存来源的最新快照正文与声明元数据进行区分大小写的 Unicode 子串搜索，最多 20 条结果。支持直接匹配中文，不做词干分析、语义排序、向量检索或互联网搜索。`list` 默认最多显示 50 个来源；大型来源库中不要把这一页当作完整列表。存储 API 支持显式数量限制，也能查询某个来源的完整快照历史。

## 研究笔记与段落绑定

```sh
pnpm writer source note ../my-writing <snapshotId> "Check whether the study supports causation" --excerpt <excerptId>
pnpm writer source notes ../my-writing <snapshotId>
pnpm writer show ../my-writing <documentId>
pnpm writer source bind ../my-writing <documentId> <blockId> <excerptId>
pnpm writer source links ../my-writing <documentId>
```

笔记是你的本地观察，不是来源原话、已核验事实或已经学会的偏好，也不会自动发送给模型。

段落绑定记录文稿、版本、文本块 ID、单调递增的块版本和摘录 ID，标记为 `user-linked-not-verified`。目标块被改动后，绑定显示为 **stale（过期）**；其他段落的改动不影响它。即使文字后来撤回，块版本也不会倒退，因此不会偷偷恢复“已确认”状态。核对改后文意再创建新的明确绑定。这不是论断账本，也不是自动引用支持判定。

## 带资料的改稿建议

```sh
pnpm writer suggest ../my-writing <documentId> --provider ollama --model <installed-model> --instruction "Make this shorter without overstating the evidence" --excerpts <excerptId>
pnpm writer suggest ../my-writing <documentId> --provider ollama --model <installed-model> --instruction "Make this shorter without overstating the evidence" --excerpts <excerptId> --send
pnpm writer changes ../my-writing <documentId>
pnpm writer provenance ../my-writing <changeId>
```

`--sources <快照ID,...>` 提供完整提取文本，`--excerpts <摘录ID,...>` 提供较小片段。ID 用英文逗号分隔、不带空格；没有任何默认自动选择。最多 8 项，整个资料上下文序列化后最多 80,000 个 UTF-8 字节，包含元数据。超过上限会拒绝，不会悄悄截断；请改选较短的摘录。

原有模型规则不变：默认预览，`--send` 才请求，远端模型另需 `--allow-remote`，详见[模型说明](providers.md)。发送所选文稿、编辑要求与选定资料，不发送原始 HTML、未选择的资料、本地完整路径、API Key 或研究笔记。

资料在用户数据消息中序列化，不会升格为系统指令。模型仍返回不带批准标志的 Proposal Protocol v1。程序在**同一 SQLite 事务**里保存待审核修改和确切的资料上下文；错误响应、过期文稿或无效资料会使两者都不保存。等待模型期间没有打开的数据库事务。

来源记录标记为 **`supplied-not-verified`（曾提供，未核验）**。它说明模型当时能看到什么，不证明模型用了什么、也不证明任何论点。生成文本中的引用不自动核查。原有不带来源的改稿保持兼容，不会制造虚假来源记录。模型意见仍然是暂存的、未验证的观点。

## 导出与完整性

```sh
pnpm writer source export ../my-writing <snapshotId> ../saved-source
```

目标目录必须尚不存在，父目录必须已经存在；不会覆盖旧目录。导出 `raw.bin`、`text.txt`、`metadata.json`、`excerpts.json`、`notes.json`。元数据含来源、快照 ID 与两个哈希。读取或导出会核对快照哈希；不一致时报告 `CORRUPT_DATA`，不把损坏资料当成证据。如果导出发生 I/O 错误，可能留下尚未写完的新目录用于检查；不会删除无关文件。

来源、快照、摘录、笔记、绑定及上下文使用追加式表。触发器防止意外更新／删除，但无法阻挡掌控数据库的人故意篡改。导出可能包含私人笔记，不会自动上传、加密或因为软件采用 Apache-2.0 就改变其版权。

<a id="existing-workspaces"></a>
## 已有工作区

安装 v0.0.5 或运行代码更新工具**不会迁移任何写作工作区**。新工作区使用 schema v4，分析仍至少要求 v3，记忆要求 v4；已有 v2 无需迁移即可继续使用来源库，新的分析功能要求 v3；旧 schema v1 仍支持原有文稿操作和无来源改稿。只有来源操作需要先明确迁移，否则会提示 `MIGRATION_REQUIRED`。

先关闭使用旧工作区的所有程序，特别是旧版 Writer Agent，再执行：

```sh
pnpm writer migrate ../my-writing
pnpm writer migrate ../my-writing --apply
```

第一条只预览。`--apply` 会校验应用与版本、获取本地迁移锁，通过 `VACUUM INTO` 建立并校验一致的 SQLite 备份，再在一个事务里增加缺失的来源／分析表。不会重写已有文稿表、ID 或历史。未知格式会拒绝；检测到并发写入或结构错误就中止，保留备份。

备份路径位于 `.writer/backups/schema-v<old-version>-.../workspace.sqlite`。确认迁移后的工作区正常前请保留备份；它包含私人稿件且没有加密。需要恢复时，请先关闭全部连接并依据备份制定恢复步骤；**不要直接覆盖正在使用的 SQLite 数据库，也不要混用旧 WAL／SHM 文件**。中断可能留下 `migration.lock`；确认没有迁移正在运行后再修复，不会自动猜测并清理锁。

迁移锁和数据版本检查用于减少意外竞争，不是对抗旧程序或恶意本地进程的安全边界；执行迁移前仍需关闭它们。
