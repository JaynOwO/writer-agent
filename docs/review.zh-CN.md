# 论断与语义审稿 — Siglum v0.0.4

[English](review.md) | [简体中文](review.zh-CN.md)

这是实验性命令行功能，不是事实认证服务。程序负责检查身份、精确引文、版本和保存过程；模型对含义与资料关系的解释仍然是可以被驳回的意见。**本版尚未评估真实模型的提取和审稿质量。**

## 不用模型账户也能体验

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo:review
```

Windows PowerShell 如果拦截了 pnpm 的 .ps1 启动器，可以使用 `pnpm.cmd`，不必修改系统安全策略。演示使用本机假 HTTP 服务和虚构资料，不是真实语言模型；最后输出 `REVIEW_DEMO_OK`，并显示保留下来的临时工作区路径。演示实际检查论断确认、审稿、反馈不改正文、独立接受/撤回、过期标记与重新打开。

## 工作区升级

新工作区采用 schema v3。更新代码不会自动更新私人文稿数据库；v1 仍可用原有文稿操作，v2 仍可用来源功能，新论断/审稿功能需要明确升级：

```sh
pnpm siglum migrate ../my-writing
pnpm siglum migrate ../my-writing --apply
```

第一条只是预览。执行第二条前，关闭其他正在使用该工作区的程序。升级会在 `.writer/backups/schema-v1-…/` 或 `schema-v2-…/` 保留经过检查的 SQLite 备份，然后用事务新增表，保留原有记录。不要删除仍在使用的迁移锁，也不要自行覆盖数据库/WAL 文件。先使用试验副本；恢复注意事项见[来源指南](sources.zh-CN.md#已有工作区)。

## 手工标注论断

一个逻辑论断有自己的 `claimId`，每个版本中的具体出现位置有独立 `id`、`revisionId` 和精确引文锚点。确认标注意味着“这描述了我写的内容”，**不表示这句话是真的**。模型提取结果默认是候选；手工标注默认已确认。

```sh
pnpm siglum show ../my-writing DOC_ID
pnpm siglum claim add ../my-writing DOC_ID ./annotation.json
pnpm siglum claim list ../my-writing DOC_ID
pnpm siglum claim show ../my-writing OCCURRENCE_ID
```

把大写 ID 占位符替换成工作区返回的真实 ID。`annotation.json` 必须与文稿实际文本匹配。假设某个文本块的完整内容正是 `Some teams may improve.`，可以写：

```json
{
  "ref": "manual-1",
  "statement": "Some teams may improve.",
  "kind": "inference",
  "anchors": [
    {"blockId": "ACTUAL_BLOCK_ID", "start": 0, "end": 23, "quote": "Some teams may improve."}
  ]
}
```

位置是文本块 `text` 内从 0 开始的 **UTF-16 代码单元偏移**，end 不包含结束位置。emoji 通常占两个代码单元，不允许从中间切开。引文包括空格、换行、Unicode 都必须精确匹配；重复句子不会通过“找第一个匹配项”自动定位。

类型可选 `testable`（可核验陈述）、`inference`（推断）、`attributed`（转述）、`value-judgment`（价值判断）、`unclassified`（未分类）。这些不是真假标签。`ref` 只是局部标签，不是数据库 ID。额外 JSON 字段和重复键会被拒绝。

明确认为另一个位置表达同一逻辑论断时，在 `claim add` 末尾加 `--claim CLAIM_ID`。它必须属于同一篇文稿；模型报告中的等价/拆分/合并映射不会自动修改永久论断身份。

```sh
pnpm siglum claim confirm ../my-writing OCCURRENCE_ID "This describes my wording."
pnpm siglum claim important ../my-writing OCCURRENCE_ID "Keep this point in the article."
pnpm siglum claim unimportant ../my-writing OCCURRENCE_ID "No longer a protected point."
pnpm siglum claim dismiss ../my-writing OCCURRENCE_ID "This is not the assertion I made."
pnpm siglum claim correct ../my-writing OCCURRENCE_ID ./corrected-annotation.json "Correct the interpretation."
```

引号内的理由可以改为中文。纠正会在原 claimId 下追加新标注，并把旧标注标为 superseded，不会改写历史。锚点所在文本块后来被改过，旧出现位置即过期；即使文本恢复原样，也需要对新版本重新标注。重要论断是你明确设置的文稿约束，不是系统偷偷学习出的偏好。审稿范围内所有当前、已确认的重要出现位置都会列出；没有合格出现位置的重要论断会显示为未检查。

## 让模型提取候选论断

把 `MY_MODEL` 换成你已安装的模型名。下面这条默认**只预览，不发送请求**：

```sh
pnpm siglum claim extract ../my-writing DOC_ID --blocks BLOCK_ID --provider ollama --model MY_MODEL --instruction "Extract the assertions without treating them as facts."
```

全文提取使用 `--document-scope` 替代 `--blocks`。看过目标服务与范围后，只有加 `--send` 才真正发送。多个块 ID 用逗号分隔，不要带空格。可通过 `--sources SNAPSHOT_ID`、`--excerpts EXCERPT_ID` 明确选择资料；不会偷偷附带研究笔记或未选资料。

候选和提取报告在同一事务保存。引文错误、身份错误、请求取消或文稿/论断上下文过期，都不会保存半批候选。不需要先逐个确认，才能查看这些候选；只确认你需要依赖或设为重要的标注。

## 审查待接受修改

先通过现有 `suggest` 或手工提案 JSON 产生待审核修改，再用 `changes` 看它们的 ID。审稿是独立请求，不会因为写作请求获准，就自动再调用一次付费模型：

```sh
pnpm siglum changes ../my-writing DOC_ID
pnpm siglum review run ../my-writing DOC_ID --changes CHANGE_ID --provider ollama --model MY_MODEL --instruction "Check certainty, attribution and whether the core point was preserved."
```

默认只检查被选修改涉及的文本块。加 `--document-scope` 才检查全文，包括论点可能移动到的新位置。同批必须是同一文稿中可兼容的 pending 修改；重复改同一块、过期操作会被拒绝。程序只在内存拼出修改后的假想版本，不会接受正文修改。

模型参数与 `suggest` 一致：`--base-url`、`--key-env`、超时、输出长度、指令文件、来源选择与兼容模式。远端请求必须同时使用 HTTPS、`--allow-remote` 和 `--send`。没有自动重试、补救请求、切换服务、抓取来源或工具执行。详见[模型指南](providers.md)。密钥参数只接受环境变量名，不能传密钥原文。

## 阅读报告

```sh
pnpm siglum review list ../my-writing DOC_ID
pnpm siglum review show ../my-writing RUN_ID
pnpm siglum review export ../my-writing RUN_ID ../private-review.json
```

报告保存实际输入快照、范围、选定资料、配置请求的模型与非敏感设置、输出、耗时、服务返回的 token 用量、提示词版本、反馈和过期状态。来源绑定不可变快照。列表只展示最近 100 次任务，较旧的已知 ID 仍可单独 show；论断列表超过 1000 个出现位置时会明确拒绝，不会默默截短并声称完整。

报告把三层分开：

- `observations`：程序确定的文字跨度与哈希。每个块通过共同前后缀计算一个变化区间，不是最小编辑脚本，也不是语义算法。“原句没有逐字出现”不等于“论点已被删除”。
- `output`：模型的前后候选论断、对应关系、审稿意见和资料关系，标记为 `model-assessment-not-verified`。
- `feedback`：作者对上述判断的意见，独立于正文接受/撤回。人工同意也不等于普遍事实认证。

对应关系包括等价、改写、反转、拆分、合并、删除、新增、无法判断。它们保留在报告中，不会自动合并永久论断 ID，也不会把假想新稿中的候选当成真实版本存入论断台账。

资料关系包括 `not-assessed`、`supports`、`partially-supports`、`contradicts`、`insufficient`、`uncertain`。`evidenceView` 会为每个候选列出状态，缺少评估时明确显示**未评估**，不是“不支持”。支持/部分支持/冲突必须附带所选资料中的精确引文；“不足”只针对选定资料，不代表世界上没有证据。程序只核实引文位置，不核实模型推理正确性。

没有返回问题，不代表可以放心接受。失败、拒答、格式/引文不合法、超时、取消会返回错误，不创建成功报告，也不保存失败的原始对话。服务没返回 token 用量就记 null，不推算美元成本。记录的模型名是配置请求名，不能独立证明服务实际运行了哪个模型。

## 反馈不等于改正文

```sh
pnpm siglum review decide ../my-writing RUN_ID FINDING_REF disagree "The original meaning was preserved."
pnpm siglum review decide ../my-writing RUN_ID mapping:0 needs-review "This may be a split, not a deletion."
pnpm siglum review decide ../my-writing RUN_ID assessment:0 correct "This supports only a weaker wording." "Partially supports the qualified assertion."
```

`mapping:N`、`assessment:N` 分别是这份不可变报告中从 0 开始的位置；审稿问题用它的 ref。动作有同意、不同意、待复查、纠正；只有 correct 额外带纠正文字。允许给历史报告追加反馈，不覆盖原始意见，不触发正文 accept/reject/revert。

正文依旧单独操作：

```sh
pnpm siglum accept ../my-writing CHANGE_ID "Keep this edit."
pnpm siglum reject ../my-writing OTHER_CHANGE_ID "Keep the original wording."
pnpm siglum revert ../my-writing ACCEPTED_CHANGE_ID "Restore the earlier block."
```

这是三个不同修改的示例，不是对同一条已接受修改顺序执行所有动作。**正文操作仍按文本块进行**。分析能定位到句子，不代表已经支持只撤回某两个字。

## 作者自己的资料评估

`claim assess <workspace> <occurrenceId> <evidence.json>` 保存独立的人工评估。JSON 必须且只能包含 `selection`、`relation`、`sourceQuotes`、`explanation`；selection 只能有可选的 snapshots/excerpts 数组。引文是 itemIndex/start/end/quote：itemIndex 对应所选上下文从 0 开始的位置（整份快照在前、片段在后），偏移在该项选定文本内部，不是原始 HTML 中的位置。先查看实际快照/片段，再确定坐标。

`claim evidence <workspace> <occurrenceId>` 显示历史评估与当时材料。冲突的人工判断可以并存，不做“多数票为真”。对旧出现位置评估，描述的仍是那个旧版本，不是当前文字。

## 过期、隐私和数量限制

文稿版本、所选 pending 修改状态或论断决策变化，会使语义报告过期。文字恢复也不让旧报告复活。提取任务自己会新增候选，因此提取报告主要按文稿版本判断新旧，并不声称候选的人工确认状态一直有效。换指令/换资料需重新分析；旧报告仍针对原始输入，本版没有全局可变的“当前写作要求”。刷新网页不会使绑定旧快照的历史报告丢失。

每侧最多 100 个候选、100 条问题、200 组对应关系/资料评估，每条最多 8 个锚点/资料引文，陈述与解释最多 2000 字符，备注最多 20 条；序列化分析输入/输出有 6 MB 安全上限，原有最多 8 项/80000 字节来源上下文及传输限制仍有效。实际模型的上下文/输出容量可能更小。超限会拒绝，不自动拆分、截短或追加请求。

报告、论断与反馈保存在私人工作区 SQLite 中，包含私人文稿和来源原文；JSON 导出也包含这些内容。当前没有加密或定时备份，不要把导出文件上传公共仓库。

参见[协议](analysis-protocol.md)、[版本规格](v0.0.4-spec.md)、[已知限制](limitations.md)和[评估草案](../evaluation/README.md)。
