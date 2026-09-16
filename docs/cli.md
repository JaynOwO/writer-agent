> Updated for v0.0.3: the original manuscript commands below are retained; see [sources.md](sources.md) for source intake, provenance and migration. For `writer model` and preview/`writer suggest --send`, see [providers.md](providers.md). Only explicitly sent suggest calls make provider requests; source add/refresh makes public-page HTTP requests only with --fetch. Original manuscript commands remain offline. On Windows use `pnpm.cmd`.

# CLI walkthrough

先在项目根目录运行 `pnpm install --no-frozen-lockfile`、`pnpm check`。以下命令均在**源码项目根目录**执行。`../my-writing` 是另外一个写作工作区，不是 GitHub 仓库；路径含空格时使用引号。

## One-command demonstration

```sh
pnpm demo
```

默认在系统临时目录创建新的工作区，显示最终文件的绝对路径。样例是虚构文案，不作实际论证。`DEMO_OK` 表示演示代码正常执行完毕；它不是 AI 正确性证明。

## Start your own document

```sh
pnpm writer init ../my-writing "我的工作区"
pnpm writer import ../my-writing ./examples/sample.md "我的试验文稿"
pnpm writer list ../my-writing
```

`import` 输出 `id`（例如 `doc_...`），把实际 ID 复制到下一条命令：

```sh
pnpm writer show ../my-writing doc_实际ID
```

`show` 返回正文、当前 revision ID、每个 block 的 ID 和完整原文。不要把示例占位 ID 当成真实 ID。

## Submit a proposed edit

在工作区外或工作区内新建 UTF-8 `proposal.json`，使用 `show` 的实际 ID 与原文字串：

```json
{
  "baseRevisionId": "rev_替换为当前版本ID",
  "providerId": "manual",
  "edits": [
    {
      "blockId": "blk_替换为目标段落ID",
      "before": "与该文本块完全一致的原文",
      "after": "建议的新写法",
      "summary": "说明这次想改什么"
    }
  ]
}
```

`before` 包括这个块自身的行尾字符，但不包括 `separator` 字段；最简单的方式是直接使用 `show` 输出的 `block.text`。JSON 中换行写成 `\n`。同一批不能对一个 block 提交两项修改。

```sh
pnpm writer propose ../my-writing doc_实际ID ../proposal.json
pnpm writer changes ../my-writing doc_实际ID
```

这只保存待审核提案，不修改正文。`changes` 会显示修改 ID、前后文本、状态和词汇规则提示。

## Decide and selectively revert

```sh
pnpm writer accept ../my-writing chg_实际ID "保留这个修改"
pnpm writer reject ../my-writing chg_另一个待审ID "不要删掉限定条件"
pnpm writer revert ../my-writing chg_已接受ID "这次改动改变了我想表达的强度"
```

拒绝对象必须仍是 pending。已接受的修改用 `revert`，而非 `reject`。在同一个块被再次改动后，旧修改不能直接撤回；系统会给出 `CHANGE_CONFLICT`，要求基于当前稿件重新提案，不会强行覆盖。

```sh
pnpm writer history ../my-writing doc_实际ID
pnpm writer decisions ../my-writing doc_实际ID
pnpm writer export ../my-writing doc_实际ID ../final.md
```

导出文件的父目录须存在，目标文件必须不存在。不会覆盖既有文件。导出到工作区外的路径由用户自行管理，注意不要误提交到公开仓库。

## Exit codes

成功为 0；领域/参数校验错误为 2；其他系统错误为 1。SQLite 实验性提示写到 stderr，不改变成功状态。`pnpm writer help` 提供完整命令列表。

## Backup

结束所有打开同一工作区的进程后，复制完整工作区目录作为备份。不要在应用仍运行时只复制一个 SQLite 主文件。当前无加密、自动同步、自动备份或就地 Markdown 双向编辑功能。

## Siglum v0.0.3

`pnpm siglum` 是现有 `pnpm writer` 的别名。新增 `source help`、`migrate <workspace> [--apply]`、`provenance <workspace> <changeId>`、`demo:sources`。来源子命令、摘录、笔记、引用绑定和明确发送资料的流程见 [sources.zh-CN.md](sources.zh-CN.md)。旧工作区不自动迁移；代码更新也不迁移私人文稿。

## v0.0.4 claims and review

`writer claim help` and `writer review help` expose the independent annotation/analysis commands. See [review.md](review.md) or [简体中文](review.zh-CN.md) for exact flag and JSON examples. `writer demo:review` is a scripted fake-provider walkthrough. Existing text commands and source workflows remain separate and unchanged.

## v0.0.5 intent, profiles, memory and guide

`pnpm siglum guide <workspace> --lang zh-CN` starts numbered menus; `--lang en` switches menu language. The workspace must exist; schema4 migration is offered only with explicit backup/upgrade confirmation. Use `init` for a new empty workspace. Interactive mode refuses pipes/nonTTY; 0/blank returns from menus and q/Ctrl+C exits without implicit consent.

`profile`, `intent` and `memory` each accept help. Manual save/add explicitly activates; model drafts/imports create candidates needing confirmation. `suggest` and `review run` accept --language, --preferences, --examples, --exceptions-file and --waive-required. These flags are not available for claim extraction. Rules keep their language/task scope; title is a scope label only, not a new title command. See paired memory guides for exact JSON/IDs, preview vs send, optional feedback and profile export/import.

## v0.0.7 extension commands

`pnpm siglum extensions help` documents skill import/list/show/enable/disable/read, mcp register/list/show/trust/revoke/discover/catalog, research query and citations show/export. `extensions guide` adds numbered bilingual management; existing workflow guide adds exact tool/skill/chapter selection. `demo:extensions` is a local fixture, not real inference. See extensions.md and extensions.zh-CN.md for actual syntax and compatibility.
