# 工具与研究 — Siglum v0.0.7

[English](extensions.md) | [简体中文](extensions.zh-CN.md)

## 1．先试本机演示，不需要真实账户

使用独立测试工作区，不要把源码仓库当成稿件目录；已有工作区不要重新初始化。此演示只启动**仓库自己提供的虚构 MCP 程序**和本机假模型服务，不使用真实 API、第三方 MCP 服务或真实证据。

```sh
pnpm build
pnpm demo:extensions
pnpm eval:retrieval
pnpm siglum init ../extensions-playground "Extensions playground"
pnpm siglum extensions guide ../extensions-playground --lang en
pnpm siglum extensions guide ../extensions-playground --lang zh-CN
```

结束标记为 `EXTENSIONS_DEMO_OK`。完整场景加载指定 Skill，真正通过 stdio 调用本机夹具，在虚构长文末段找到资料，确认大纲，分两章起草、审稿、保留候选，最后明确模拟作者采用。`eval:retrieval` 只比较十二条中英文合成资料中的目标字符串是否进入上下文，不是真实模型准确率。

编号向导负责选择；`0`／空输入返回，`q` 退出，输入结束或 Ctrl+C 不会默认批准。Windows PowerShell 遇到脚本入口限制时写成 `pnpm.cmd`，不需要管理员或改权限。Windows 交互与子进程退出仍需单独验证，Linux 通过不能当作 Windows 证据。

## 2．导入说明型 Skill

```sh
pnpm siglum skill import ../extensions-playground ./examples/skills/source-check
pnpm siglum skill import ../extensions-playground ./examples/skills/source-check --apply
pnpm siglum skill list ../extensions-playground
pnpm siglum skill enable ../extensions-playground SKILL_ID
pnpm siglum skill read ../extensions-playground SKILL_ID references/checklist.md 1 2
pnpm siglum skill disable ../extensions-playground SKILL_ID
```

大写 ID 是占位符，需要替换；向导不用手抄。导入默认预览，加 `--apply` 才保存，保存后仍是停用状态，启用另行决定。导入的是不可变本地副本，不监听原文件夹。修改包后作为新版本导入；启用同名新版本会停用旧版，让受影响的任务重新确认。停用再启用也不会复活旧授权。

支持的是 **Agent Skills 的明确子集**：`SKILL.md`、受支持的 YAML 字符串元数据、Markdown 说明和明确选定的相对路径参考文本行段。标量支持普通／引号字符串、`|`、`>`、`|-`、`>-`，以及两空格缩进的字符串 `metadata` 映射；不是完整 YAML。拒绝别名、标签、一般序列、脚本及二进制资源。references／assets 内可放支持的文本，但绝不会执行。名称与目录一致，使用 ASCII 小写、数字、单连字符。最多 64 文件／256000 序列化字节；一次最多 3 Skill／48000 字节，每个最多 8 参考段。不安装或执行未知必需能力；自由文字 compatibility 展示给作者核对，不由程序认证。

只有选定包和参考行进入内容任务；公共搜索规划不接收私人 Skill。`allowed-tools` 只收窄已经选中的 MCP 方法名／宿主 ID，不授予权限，也不实现 shell 通配权限。成功加载说明不等于模型一定照做；不能改变文章意图、启用记忆或批准正文。

## 3．信任连接，不等于授权全部工具

本版是**有界的原生 MCP 客户端**，不是完整协议实现。评估过官方 SDK，但作者环境 DNS 受限，未能安装；没有加入 SDK／JSON Schema／YAML 依赖，也没有伪造锁文件。具体范围见[兼容矩阵](extensions-protocol.md)；不支持的 schema 断言会让该工具被排除，而不是忽略限制继续执行。

stdio 需要明确指定已经安装的可执行文件、参数数组和工作目录。启动的程序具有**当前用户的操作系统权限**：MCP 不是沙箱，环境变量白名单或目录设置不能限制恶意程序。只信任已知程序。不自动 npx 下载、不运行安装器、不拼接 shell 字符串。指纹覆盖可执行文件和参数中直接引用的文件，不认证完整依赖树；已信任的恶意程序仍可能主动读取磁盘秘密。

HTTP 地址必须明确，支持本机回环 HTTP 或授权的远端 HTTPS。Bearer 凭据从环境变量**名称**读取，不填明文 Key 参数。没有 OAuth、自动重定向或自动发现新端点。本机服务也可能转发云端。服务的 `readOnlyHint` 只是声明，读取也可能泄露数据或计费。

通过向导或兼容指南所列结构保存 `connection.json` 后：

```sh
pnpm siglum mcp register ../extensions-playground ./connection.json
pnpm siglum mcp register ../extensions-playground ./connection.json --apply
pnpm siglum mcp list ../extensions-playground
pnpm siglum mcp trust ../extensions-playground SERVER_ID LAUNCH_HASH
pnpm siglum mcp discover ../extensions-playground SERVER_ID
pnpm siglum mcp discover ../extensions-playground SERVER_ID --connect
pnpm siglum mcp catalog ../extensions-playground SERVER_ID
pnpm siglum mcp revoke ../extensions-playground SERVER_ID
```

register 不启动或连接；trust 只信任程序／连接，不批准任意工具。discover 只有 `--connect` 才接触受信任服务，不执行其业务工具；发现本身仍可能产生服务端行为或费用。声明 destructive 的工具不能用于自动读取／计算工作流。工具标识固定 server ID、名称／URI 及 schema／描述哈希；观察到变更后要重新选择授权，改回原样也不恢复旧许可。服务即便描述不变，行为也可能改变，这不是恶意代码隔离保证。

## 4．接入同一项写作任务

打开原有工作流向导，创建／选择新稿任务，再选择“工具／技能／章节”。选择已启用 Skill 与参考行；选择已信任、已发现的工具或资源、**确切 JSON 参数**和作者核对的读取／计算用途；按需开启逐章生成。保存选择会刷新捕获、撤销旧许可；检查并授权新阶段摘要，再执行。

```sh
pnpm siglum workflow guide ../extensions-playground --lang en
pnpm siglum workflow guide ../extensions-playground --lang zh-CN
```

这版执行的是**作者预选、固定参数的调用**，不是模型无限自行挑工具的循环。研究阶段最多加入 5 次调用，与内置搜索／获取共用持久尝试、租约与检查点。一项逻辑 MCP 调用（包括有界元数据 RPC）消耗一次共享 `fetches` 读取／网页额度。摘要显示目标与参数；换服务、Skill 版本、参数或数据范围要重新确认。增加调用或章节可能需要明确提高预算。未知结果不偷偷重试；撤销授权会拒绝迟到结果，但不能撤销外部服务已经执行的请求。

schema6 向导新建任务默认启用增强选材与引用；没有 `extensions` 字段的旧配置保持旧行为。JSON 配置的启用对象：

```json
{"skills":[],"calls":[],"chapterDrafting":false}
```

把它放在配置的 `extensions` 字段下；即使不连接 Skill／MCP，也能用增强选材和引用。实际 ID 通过向导选择。MCP 与逐章写作目前限于**写新稿**模板；改旧稿、只审稿可以加载 Skill，但保持已有文本块提案和选定资料方式。

MCP 文本带着明确的 `external-service-unverified` 来源说明导入，不冒充 Siglum 直接抓取了网站或获得了独立证据。不递归打开结果 URL／资源链接；只接收文本或支持的结构化结果文本化表示，二进制、链接内容和回调要求会明确拒绝。工具提示词始终是未信任数据。

## 5．从保存的全文找证据

```sh
pnpm siglum source list ../extensions-playground
pnpm siglum research query ../extensions-playground SNAPSHOT_ID "battery endurance limitations"
```

索引覆盖完整的**有大小上限的已保存提取文本**。分块保留原 UTF-16 偏移、行号、哈希、标题标签与邻接关系；归一化只用于检索，不改原始来源。标题导航标签超过 256 单元时用省略号缩短，原文引文仍完整保留。

采用英文词／中文双字片段的字面相关性和邻接上下文，不使用向量或另一个检索模型。每个自动取得的来源默认最多 2 个窗口／8000 字节，还受总计 8 项／80000 字节限制。必选材料不悄悄裁剪；窗口太大或没有字面命中会说明。`indexedEntireText` **不表示模型通读**，计划会列出加载／遗漏行数。分值是检索顺序，不是真伪或可靠性概率；无命中时的导航样本也会标记。

搜索排序考虑问题词匹配、主机分散、规范化 URL 和较长相同摘要去重；取得原文后再按全文哈希发现重复。无法确认的发布日期与原始来源角色保持未知，采集时间不是发布日期，不同主机也不保证独立证据。相关段落仍可能漏掉远处的限定条件，不声称完成全面证据／冲突发现。手工选定完整快照继续受原来全文预算约束，超长时应明确选片段。

逐章模式依据已确认大纲、全局作者要求和该章相关的**固定证据包**生成；合并时把局部来源下标映射回稳定来源。明确重试可复用已成功章节，不重新调模型。宿主本地合稿后做一次有界整稿审阅，可选修订仍最多一轮。整稿放不进审查／输出限制时停止，而不是认证未检查章节。术语一致性仍是可出错的模型检查，不是机械语义保证。

## 6．引用与坐标

```sh
pnpm siglum citations show ../extensions-playground CANDIDATE_OR_DOCUMENT_ID
pnpm siglum citations export ../extensions-playground CANDIDATE_OR_DOCUMENT_ID ../references.json
```

宿主按出现顺序重排 Markdown 脚注，源快照／片段标识不依赖 S1／S2。候选引用图记录标记偏移、简单邻近文本范围、选中来源中的精确引文偏移／哈希、元数据、采集时间及 MCP 出处。来源偏移相对于**保存的选中文本**，并固定提取行段，不是 HTML 字节或 PDF 页码。

模型协议按来源条目提供引文，不是为每句话独立证明。因此关联明确标为 `source-entry-candidates-not-claim-support`：该来源条目提供的引文都是对应标记的候选依据。邻近文本范围不是 Markdown／语言学句子解析；是否支持论点仍需要语义审稿或人工判断。错误／缺失／孤立引用、错配原句会被拒绝；标记及图大小限制防止异常膨胀。这只证明结构一致，**不认证事实**。

采用新候选时，文稿、引用映射与工作流检查点在同一事务保存；重复采用返回原文稿。以后任何文稿新版本（包括同字新版本）都让旧映射过期。历史候选图固定于原候选，不保证仍适用于后来任务方向。导出不覆盖已有文件，可能包含私人证据，分享前自行检查。没有 Word／引文样式引擎，也没有句子级正文撤回。

## 7．迁移、限制与验证

```sh
pnpm siglum migrate ../existing-writing
pnpm siglum migrate ../existing-writing --apply
```

新工作区为 schema6；旧 schema1–5 保留各自原能力。扩展需明确、先备份的升级，代码更新不会打开或迁移私稿。迁移前关闭其他会话，备份私人且未加密。旧工作流记录不会被伪造成已经使用了新工具和索引。

保留回归测试并运行七个演示；现有 Updater 仍执行 check 与原来的演示，CI 另显式运行 `demo:extensions`。实际 stdio／HTTP 测试使用**本项目自己编写的假服务**，不证明 SDK／第三方互操作。Windows、Node24、真实 Tavily／模型／独立 MCP 服务分别报告。十二条检索比较是字符串夹具，不是有代表性的研究质量基准。

参见[兼容与协议](extensions-protocol.md)、[架构](architecture.md)、[安全](security-model.md)、[工作流](workflows.zh-CN.md)和 [v0.0.7 范围](v0.0.7-spec.md)。

章节合并后独立限制说明超过 20 条时明确拒绝，不偷偷删除；来源选择的预览超过 60 条说明时显示省略数量，详细记录仍保留在选择产物中。
