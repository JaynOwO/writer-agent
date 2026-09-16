# 意图与写作记忆 — Siglum v0.0.5

[English](memory.md) | [简体中文](memory.zh-CN.md)

本指南描述已实现命令，不承诺真实模型效果。意图／偏好是作者指导，不是事实依据，也不能增加模型权限。产品选择对应 1C／2C／3C／4D／5C／6C／7C／8B。

## 1．从测试稿和编号向导开始

安装依赖后，在代码仓库运行。写作工作区是**另一个文件夹**，不要把代码仓库当成稿件工作区。`init` 要求新目录或空目录；已有工作区不要重复初始化。

```sh
pnpm build
pnpm siglum init ../memory-playground "Memory playground"
pnpm siglum import ../memory-playground ./examples/sample.md "Test article"
pnpm siglum guide ../memory-playground --lang zh-CN
```

向导使用编号，菜单中 `0`／空输入返回，`n`／`p` 翻页，`q` 退出。确认默认否，不默认同意。Ctrl+C、输入结束或 SIGTERM 不会隐式发请求或批准内容。需要交互式 TTY；脚本／管道使用非交互命令。多选以逗号分隔编号，不默认全选。菜单语言与偏好的适用语言独立。

英文菜单或完全模拟的演示：

```sh
pnpm siglum guide ../memory-playground --lang en
pnpm siglum demo:memory
```

`demo:memory` 创建独立测试工作区，用预设模拟响应，不访问 HTTP 或使用模型 Key，结束为 `MEMORY_DEMO_OK`。覆盖意图／档案选择、提案、可选拒绝原因、候选确认、下次复用、本次例外、档案隔离和记录恢复；这不是真实模型学习。

Windows PowerShell 可将 `pnpm` 改成 `pnpm.cmd`，不用调整权限策略。真实 Windows 的交互表现需在目标电脑分别验证，不能从 Linux／脚本测试推断已通过。

## 2．在向导里的操作流程

先选择／导入文章，选择／创建档案，再打开文章意图卡。可用空白模板、谨慎科普模板、复制当前意图或请求模型起草。手工填写留空会保留原默认值；需要清空旧要求时选空白模板。模板是虚构起点，不是对你的自动画像。检查后明确保存，或确认展示的模型草案；过期草案不能覆盖后来修改的文章／意图。

用编号管理规则和候选。手工“保存并启用”属于确认；模型和导入的规则保持 `candidate`。选定部分候选，检查后只启用所选。编辑并确认生成新的人工纠正版本；`disabled`／`dismissed` 不进入新请求。一篇文章只绑定一个档案，取消绑定不删除档案。

请求改稿／审稿时，明确选择来源或不选，查看记忆计划，按需选规则／示例／本次例外，配置模型，再确认最终发送。模型设置只在本次向导会话内复用；询问的是环境变量**名称**，不是密钥本身，凭据需在向导外配置。远端仍要明确授权，每次推理仍各有最终发送确认。失败不自动重试或切换模型。

查看修改会展示原文、提案与使用记录。拒绝理由可以跳过，也可选改变原意／语气太满／不像我的表达／没必要／内容依据／其他，再自愿补充。这只是一次决策，不会直接变成永久文体规则。主动整理偏好时只选择带理由的反馈，对照原文另行授权；返回候选不会自动启用。接受／撤回仍沿用精确块、原文和版本保护。

## 3．旧工作区只在你明确选择时升级

新建工作区为 schema v4，旧 v1／v2／v3 保留各自原能力；未升级时调用记忆会提示 `MIGRATION_REQUIRED`。代码更新器不会打开或迁移私人工作区。先关闭其他会话，预览，再明确执行：

```sh
pnpm siglum migrate ../existing-writing
pnpm siglum migrate ../existing-writing --apply
```

向导遇到旧工作区也会展示预览，并在最终确认后备份升级。保留经过核验的私人 SQLite 备份；不能覆盖打开中的数据库，旧程序也不应打开 schema v4。恢复边界见来源指南。

## 4．非交互命令

向导避免复制 ID；脚本可以使用下面命令。所有大写 ID 都要替换为真实返回值，不能直接使用占位符。按下方示例创建 `intent.json` 和 `preference.json`。执行 `intent save`／`memory add` 就是明确保存并启用，不是预览。

```sh
pnpm siglum profile create ../memory-playground "Chinese explainer"
pnpm siglum profile list ../memory-playground
pnpm siglum list ../memory-playground
pnpm siglum profile attach ../memory-playground DOC_ID PROFILE_ID
pnpm siglum intent save ../memory-playground DOC_ID ./intent.json
pnpm siglum memory add ../memory-playground PROFILE_ID ./preference.json
pnpm siglum memory plan ../memory-playground DOC_ID revise
```

`intent.json` 示例：importantOccurrenceIds 只能填已有、当前、已确认的论断 occurrence；模型不能编造这些引用。

```json
{
  "language": "zh-CN",
  "audience": "普通读者",
  "purpose": "解释示例中的限制条件",
  "thesis": "",
  "rules": [{"key": "guidance", "value": "保留不确定性，不把相关写成因果", "strength": "required"}],
  "importantOccurrenceIds": []
}
```

`preference.json` 示例：固定短语只是虚构示例，不会自动保存。

```json
{
  "rule": {"key": "avoid-phrase", "value": "值得注意的是", "strength": "preferred"},
  "language": "zh-CN",
  "tasks": ["revise", "review"],
  "priority": 0,
  "example": null
}
```

语言：`zh-CN`、`en`、明确跨语言的 `any`。任务：`revise`、`review`、`title`；title 用于范围标记和计划检查，不是新的标题生成命令。未选择意图或语言时只匹配 any，不猜系统语言。显式语言与有效意图卡的非 any 语言冲突会拒绝。priority 是作者设置的 0–5 整数，不是模型置信度。

规则类型：`guidance`、`tone`、`sentence-style`、`avoid-phrase`、`max-characters`。required 防止静默遗漏／结构覆盖，但不保证模型遵守。字符上限计算 Unicode 码点，含空白与换行；短语检查是区分大小写的字面子串。其他类型需语义审稿。不会执行用户正则或脚本。

## 5．明确请求模型起草意图

使用自己已安装的兼容 Ollama 模型；第一条只预览，第二条发送一次。远端兼容 Chat Completions 的服务还需沿用模型指南的凭据、HTTPS 与 `--allow-remote` 要求。

```sh
pnpm siglum intent draft ../memory-playground DOC_ID --language zh-CN --provider ollama --model YOUR_INSTALLED_MODEL --instruction "Explain to general readers; preserve uncertainty."
pnpm siglum intent draft ../memory-playground DOC_ID --language zh-CN --provider ollama --model YOUR_INSTALLED_MODEL --instruction "Explain to general readers; preserve uncertainty." --send
pnpm siglum intent list ../memory-playground DOC_ID
pnpm siglum intent confirm ../memory-playground INTENT_VERSION_ID
```

模型只收到明确的 brief，不是整篇稿件或其他档案。每个填写字段／规则必须对应 brief 的精确引文位置，或标为额外建议；这只核实引用位置，不证明改写忠实。信息缺失留空或提出问题。确认前检查全部字段，使用 `memory run` 能看原始草案中的依据、问题和建议标记。

## 6．只从选定的带理由反馈归纳

```sh
pnpm siglum memory feedback ../memory-playground DOC_ID
pnpm siglum memory distill ../memory-playground DOC_ID --profile PROFILE_ID --decisions DECISION_ID --tasks revise,review --language zh-CN --provider ollama --model YOUR_INSTALLED_MODEL --instruction "Draft only preferences supported by the selected reason."
pnpm siglum memory list ../memory-playground PROFILE_ID
pnpm siglum memory activate ../memory-playground PREFERENCE_VERSION_ID
pnpm siglum memory disable ../memory-playground NEW_ACTIVE_VERSION_ID
```

示例 distill 只预览；检查后加 `--send` 才推理。`--feedback-examples DECISION_ID,...` 另行授权最多三个选中反馈的前后原文；默认只发送理由／类别。对照每侧最多 2000 个 UTF-16 单元，超限拒绝，不自动裁剪。可手工为规则添加一个作者选择的短对照。保存候选不等于以后自动发送私人示例。

activate 使用**版本 ID**，不是逻辑 preferenceId。操作返回新版本，旧版本再操作会拒绝。`memory correct` 接收替代的偏好 JSON 并明确启用人工纠正。无理由就不推断动机；内容／依据纠正不一定是风格偏好，模型归纳仍可能错，需要确认。

## 7．筛选、冲突与历史

已启用可选规则先按绑定档案／语言／任务筛选，再按 required、作者优先级、稳定 ID 排序，不用向量、模糊语义检索或额外模型筛选。篇章要求完整保留。最多 20 条档案规则、3 个明确许可的示例、共 24000 字节序列化 UTF-8 内容。示例先保留预算，再填可选规则；必选／明确内容超限拒绝。可选排除项在本地可见，不向模型泄漏其他档案。

`--preferences` 显式选择逻辑 ID，适用 required 默认规则仍保留；`--examples` 单独选择具有示例的逻辑 preferenceId。本次例外是 JSON 数组，`exceptions.json` 示例：

```json
[
  {"key": "tone", "value": "casual", "strength": "preferred"}
]
```

```sh
pnpm siglum suggest ../memory-playground DOC_ID --provider ollama --model YOUR_INSTALLED_MODEL --instruction "Edit concisely without changing meaning." --language zh-CN --exceptions-file ./exceptions.json
pnpm siglum memory uses ../memory-playground DOC_ID
pnpm siglum memory show-use ../memory-playground USE_ID
pnpm siglum memory for-change ../memory-playground CHANGE_ID
```

这条改稿只预览；加 `--send` 才授权。tone／sentence-style／max-characters 是可比较的单值字段，优先级为本次 > 篇章 > 档案。同一最高层的不同值会冲突；覆盖较低层 required 值，必须用计划展示的精确 entry ref 加 `--waive-required`，且有冲突的更高层值。该例外只记录在本次请求。自由文字和短语规则不自动理解冲突，也不能随意 waiver；必要时明确修改有效规则。

使用快照固定文章意图、绑定档案、相关偏好版本、明确许可示例和例外。推理等待中相关要求变动会拒绝旧结果，无关档案、不同语言和未确认候选不让它失效。接受文字不等于确认事实或新偏好。机械检查仅提示，不自动拒绝／重写；不会自动多调用一次审稿。

只有 schema v4 捕获的语义审稿会包含写作记忆；旧报告保留当时不存在的记忆字段和提示版本，不能拿来证明符合后来新增的规则。历史快照不可变，停用规则仍可能在旧请求和备份里存在。

## 8．导出、导入与隐私

```sh
pnpm siglum profile export ../memory-playground PROFILE_ID ../my-profile.json
pnpm siglum profile import ../memory-playground ../my-profile.json
pnpm siglum profile import ../memory-playground ../my-profile.json --apply
pnpm siglum memory help
```

导出只选有效规则，默认不含示例、历史 ID、模型调用、稿件；`profile export ... --examples PREF_ID,...` 是另一次明确选择。它不是秘密扫描器，不能识别你写在规则正文里的秘密。目标文件必须不存在；导出最多 200 条 active 规则与 500000 字节，更大的档案需明确拆分。导入先预览，`--apply` 也只在新建未绑定档案内生成候选，不自动批准。

没有默认跨工作区同步、全电脑扫描、安全擦除、加密或凭据库。停用只停止未来使用，不能收回已发给服务的内容或备份。本地地址的模型也可能转发云端；检查发送／导出的具体内容，只传输获授权材料。

参见[记忆协议](memory-protocol.md)、[安全](security-model.md)、[架构](architecture.md)与 [v0.0.5 规格](v0.0.5-spec.md)。
