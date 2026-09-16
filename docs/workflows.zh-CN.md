# 写作工作流 — Siglum v0.0.6

[English](workflows.md) | [简体中文](workflows.zh-CN.md)

## 不需要真实 API 账户的起点

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo:workflow
```

结束标记为 `WORKFLOW_DEMO_OK`。生产模型与搜索适配器连接的是本机假 HTTP 服务，页面是注入的虚构资料；不是真实 Tavily 搜索、模型推理、付费或对外发布。输出的临时工作区独立于代码仓库。演示中的采用是明确模拟的作者操作，原有演示仍保留。

## 使用编号向导

```sh
pnpm build
pnpm siglum init ../workflow-playground "Workflow playground"
pnpm siglum workflow guide ../workflow-playground --lang en
pnpm siglum workflow guide ../workflow-playground --lang zh-CN
```

`init` 只对新建／空目录执行，不要在代码仓库或已有稿件目录重复执行。Windows PowerShell 可写成 `pnpm.cmd`，不需要管理员权限或改变执行策略。原来的 `guide` 也有工作流入口。数字选择，`0`／空输入返回，`n`／`p` 翻页，`q`、输入结束或 Ctrl+C 不会默认批准。工作流只在前台执行，关窗口不代表后台继续。

选择写新稿、改旧稿或只审稿。新稿可联网研究或只用选定资料；旧稿的两个模板目前只使用已保存来源，以及文稿当前意图／档案。选择语言、模型、资料、可选档案与最多一轮修订。联网模式单独询问“可公开搜索的问题”，不要把秘密放进公开 brief。

保存任务不会调用服务。打开任务检查阶段预览，包括实际捕获的目标／指导／资料、服务与模型、搜索权限、适用大纲、次数和时间预算。批准这个准确摘要后，阶段内不用每一步重复确认。网页或模型内容不能赋权；新阶段、输入、模型或预算变更需要新的确认。原独立命令仍按 --send／--fetch 的方式工作。

向导包含任务创建／恢复、阶段审批、大纲批准／改写、追加讨论、查看／导出产物、候选采用、旧稿逐项决定、过期进程恢复、重试、预算与取消。它调用同一套服务函数，没有另写一套独立业务逻辑。

## 真实服务与隐私

Tavily 搜索与模型推理是两个服务。把自己合法的搜索凭据配置到本机进程环境变量 `TAVILY_API_KEY`，不要把值发进聊天、写进 JSON、命令参数或 Git。模型与密钥的配置沿用模型指南。软件不附送账户、模型或额度；缺少 Key 会在查询规划前预检停止，不会暗中改用本地检索冒充网络搜索。

Tavily 固定 basic 与 `auto_parameters:false`，不要求自动答案／raw content／图片，只记录实际返回的 usage。搜索只接收有界查询与域名／时间／条数参数；查询规划模型只看到批准的公开 brief，不拿私人文稿或档案示例。两种 Key 仅发给对应 API，不发给结果网页。本地模型地址也可能转发云端。

搜索摘要属于发现记录，不是网页快照。URL 仍经过公共地址、DNS 与 IP 固定校验，不新增重定向、登录、Cookie、JS、PDF、压缩或付费抓取回退。不能读的页面明确记为不可用。宿主保存有界原文，自动交给模型的每个网页最多前 40 个完整提取文本行、8000 UTF-8 字节，并标出遗漏。没有可用保存文本就停在 blocked，不编造研究成功。明确选定的已保存资料保留 8 项／80000 字节上限，不能悄悄截断。

选择策略是先每主机一条、再按返回顺序补充，列明拦截／重复／预算排除；不是全面检索或可信度排名。来源可能不完整、错误或互相冲突，引文位置正确不代表结论成立。

## 工作区与升级

```sh
pnpm siglum migrate ../existing-writing
pnpm siglum migrate ../existing-writing --apply
```

新工作区为 schema v5；旧 v1／v2／v3／v4 保留各自已有能力。工作流需要先明确备份升级，代码更新不会查找或迁移私稿。向导可展示升级预览并请求确认。先关闭其他会话，备份仍是私人未加密数据，不要覆盖打开中的 SQLite／WAL 数据库。

## 非交互配置与阶段批准

复制 `examples/workflow-config.json` 为 `my-workflow-config.json`，填写实际可用模型，检查公开／私人目标及域名权限。示例模型 ID 只是占位符，不是推荐或自动下载。带空格路径要加引号。下方大写 ID／fingerprint 都必须换成真实返回值，向导则无需抄 ID。

```sh
pnpm siglum workflow create ../workflow-playground ./my-workflow-config.json
pnpm siglum workflow list ../workflow-playground
pnpm siglum workflow preview ../workflow-playground RUN_ID
pnpm siglum workflow authorize ../workflow-playground RUN_ID PREVIEW_FINGERPRINT
pnpm siglum workflow run ../workflow-playground RUN_ID
```

create 保存任务与捕获，preview 不执行模型／DNS／HTTP。authorize 只记录准确的摘要指纹，还不执行；run 才在授权内调用，可能使用模型或搜索额度。阶段默认最多三次模型尝试（只审稿一次），以及研究阶段剩余配额。可为 preview 与 authorize 同时指定四字段的阶段预算 JSON，不得超过任务剩余总量。

新稿配置可带手工填写的任务意图卡，不能引用尚不存在的正式文稿论断。私人目标、档案和意图指导内容生成，不用于查询规划。记忆示例仍须在 memoryOptions 中单独选择，不默认发送全部。可复用档案仍由已有记忆命令管理。

## 大纲检查点、候选与最终采用

```sh
pnpm siglum workflow artifacts ../workflow-playground RUN_ID
pnpm siglum workflow approve-outline ../workflow-playground RUN_ID OUTLINE_ARTIFACT_ID
pnpm siglum workflow preview ../workflow-playground RUN_ID
pnpm siglum workflow authorize ../workflow-playground RUN_ID NEW_PREVIEW_FINGERPRINT
pnpm siglum workflow run ../workflow-playground RUN_ID
pnpm siglum workflow compare ../workflow-playground RUN_ID CANDIDATE_A_ID CANDIDATE_B_ID
pnpm siglum workflow adopt ../workflow-playground RUN_ID CHOSEN_CANDIDATE_ID
pnpm siglum workflow export-draft ../workflow-playground CHOSEN_CANDIDATE_ID ../candidate-export.md
```

研究停在资料综述、方向和大纲，保留问题和缺口。可在向导手工修正或回复问题，然后批准最新产物。回复改变的是私人要求，不扩展公开搜索 brief；新授权后可能再调用一次模型，匹配的查询／搜索／网页可复用。写作阶段另有授权。

写作保存候选 A、带准确引文的可争议审稿，以及许可且有问题时的候选 B。B 不会再被暗中审一遍。整项任务最多成功执行一轮自动修订，包括重试／刷新后的累计行为。零问题不代表批准。机械写作规则检查与模型审稿分别保存。

候选中的 `[^S1]` 对应真实选择的来源下标，并校验精确引文。导出脚注由宿主写入来源位置、快照和行号，不是来源支持结论的认证。新稿审阅不伪造原始 revision。compare 输出准确 A／B 原文和前后缀差异区间，不是最小语义 diff、词级撤回或真伪结论。

只有最终检查点的 adopt 才建立文稿；重复采用同一候选返回同一文稿，不重复插入，已经采用后再换另一候选会拒绝。导出不覆盖、不对外发布。旧稿 A／B 都是针对正式原基线的 pending 提案，不会为了生成 B 而自动接受 A；只审稿不会增加修改。

## 中断与明确恢复

```sh
pnpm siglum workflow attempts ../workflow-playground RUN_ID
pnpm siglum workflow recover ../workflow-playground RUN_ID
pnpm siglum workflow retry ../workflow-playground RUN_ID ATTEMPT_ID
pnpm siglum workflow retry ../workflow-playground RUN_ID UNKNOWN_ATTEMPT_ID --ack-duplicate
pnpm siglum workflow run ../workflow-playground RUN_ID
```

这些命令是根据情况选择，不要整组盲跑。先看 attempts。不能抢占仍存活的 45 秒可续期执行锁；关闭旧执行者，等待过期后 recover。未派发的 reserved 尝试标为 NOT_SENT；已经 dispatched 却没有保存结果的尝试标为 `outcome-unknown`。服务可能已经处理／扣费，需带 --ack-duplicate 才可允许重新尝试；明确失败的重试不需要该标记。两种情况都不会退还此前次数，没有自动重试／回退或端到端 exactly-once 承诺。

成功保存且输入相同的产物会复用，本地写入与检查点在同一事务内保存。两个终端不能拥有同一代执行锁，失去授权的旧执行者不能提交迟来的结果。recover 只处理本地状态，不发送请求，继续仍是明确操作。Ctrl+C 停止本地等待，不保证服务端停止处理或退款。

## 预算、输入变化与历史

```sh
pnpm siglum workflow revoke ../workflow-playground RUN_ID
pnpm siglum workflow cancel ../workflow-playground RUN_ID
pnpm siglum workflow budget ../workflow-playground RUN_ID ./budget.json
pnpm siglum workflow refresh ../workflow-playground RUN_ID
pnpm siglum workflow refresh ../workflow-playground RUN_ID ./replacement-config.json
pnpm siglum workflow amend-outline ../workflow-playground RUN_ID CURRENT_OUTLINE_ID ./amended-outline-output.json
pnpm siglum workflow events ../workflow-playground RUN_ID
pnpm siglum workflow show ../workflow-playground RUN_ID
```

`budget.json` 示例：

```json
{"models":12,"searches":3,"fetches":5,"activeMs":900000}
```

失败、派发、重试都算次数，默认总量为 8 次模型、3 次搜索、5 次网页和 900000 毫秒活跃时间。等待作者不计入活跃时间，崩溃会保守地计算到租约过期。没有可靠用量／价格就显示美元费用未知，token／credit 记录不是严格账单封顶。

只改预算会撤销阶段许可，但保留可复用产物；刷新输入产生新 epoch，依赖的旧私人产物保留为历史，公共资料只在请求／服务／策略仍匹配时复用。增加预算不自动开跑，不清理或重置工作区。资料不足或超限时，缩小范围或补充材料。任意工作流代码、工具执行、后台服务、GUI、Skills／MCP 不在本版。

events 与 attempts 解释执行过程；输入和产物可能含私人材料，不能提交 Git。诊断不回显服务错误正文和 Key，但作者自己填进正文的秘密无法自动识别，分享导出前要检查。

## 可选真实试用

配置自己的真实服务后，用一次性工作区、小型公开技术选题和低次数预算试用：批准研究，检查实际快照与遗漏，确认大纲，批准写作，比较候选，阅读后再采用。可在大纲检查点关闭并重开一次验证续跑。记录真实服务／模型、成功与失败调用、实际用量、时间和人工修正量。交付包没有替你执行这个真实试验。

见[协议](workflow-protocol.md)、[安全](security-model.md)、[记忆](memory.zh-CN.md)、[来源](sources.zh-CN.md)与[限制](limitations.md)。
