# Intent & Writing Memory — Siglum v0.0.5

[English](memory.md) | [简体中文](memory.zh-CN.md)

This guide describes implemented commands, not guaranteed model quality. Intent and memory are author guidance, not evidence or extra model permissions. The product choices are 1C/2C/3C/4D/5C/6C/7C/8B.

## 1. Start with disposable writing and the numbered guide

Run from the source repository after dependency installation. The workspace is a **separate directory**, not the code repo. `init` requires a new/empty directory; skip it when reusing an existing workspace.

```sh
pnpm build
pnpm siglum init ../memory-playground "Memory playground"
pnpm siglum import ../memory-playground ./examples/sample.md "Test article"
pnpm siglum guide ../memory-playground --lang zh-CN
```

The guide uses numbers, `0`/blank to return from menus, `n`/`p` for pages and `q` to exit menus. Confirmation defaults to No, never Yes. Ctrl+C, terminal EOF or SIGTERM cancels without implicit network requests or approvals. It requires an interactive TTY; use explicit CLI commands for pipes/scripts. Multi-select uses comma-separated numbers, with no implicit select-all. Menu language and rule language are independent.

For English menus or the entirely synthetic demonstration:

```sh
pnpm siglum guide ../memory-playground --lang en
pnpm siglum demo:memory
```

`demo:memory` creates a disposable workspace, uses fixed fake responses without HTTP/model keys, and ends in `MEMORY_DEMO_OK`. It exercises intent/profile selection, a proposed edit, optional rejection reason, explicit candidate confirmation, later reuse, one-request exception, profile isolation and persisted usage. This is not real model learning.

Windows PowerShell can replace `pnpm` with `pnpm.cmd`; no permission-policy change is needed. Real Windows interactive behavior must be checked on that machine separately from scripted/Linux tests.

## 2. Workflow in the guide

Select/import an article, choose/create a profile, and open Article intent. Choose a blank template, cautious explainer template, a copy of the current intent, or model drafting. Manual fields preserve current defaults when left blank; use a blank template to clear old values. Examples are fictional starting points, not inferred author traits. Review and explicitly save the card, or confirm a shown model draft. A stale draft cannot silently replace a newer document/intent.

Manage rules and review candidates by number. A manual Save and activate is confirmation; model and imported rules remain `candidate`. Select some candidates, review them and activate only those chosen. Edit and confirm creates a new human-correction version. `disabled` and `dismissed` never enter new writing requests. At most one profile attaches to a document; detaching does not delete the profile.

Request edits/review: pick explicit sources (or none), preview memory, optionally choose specific rules/examples or a one-request exception, configure the model, and confirm the final send. Configuration is reused only within this guide session. It asks for an environment-variable **name**, never a pasted secret; credentials must already be configured outside the guide. Remote endpoints still need explicit remote permission. Each new inference needs a final send confirmation. Provider errors do not auto-retry or switch models.

Inspect edits shows the original, proposal and usage history. Reject can skip the reason. With a reason, choose meaning/certainty/voice/unnecessary/content/other and optionally add words. This records an author decision, not a permanent style rule. Explicit Draft preference candidates uses only selected reasoned feedback; contrast examples require separate permission. Candidate output is not auto-enabled. Accept/revert still uses the existing exact block/text/version guards.

## 3. Upgrade an old workspace only when you choose

New workspaces are schema v4. Legacy v1/v2/v3 retain their previous functions; memory returns `MIGRATION_REQUIRED` until upgraded. The code updater never opens/migrates private workspaces. Close other sessions; preview, then explicitly apply:

```sh
pnpm siglum migrate ../existing-writing
pnpm siglum migrate ../existing-writing --apply
```

The guide offers the same preview and a final backup/migrate confirmation if needed. A verified private SQLite backup is retained. Do not copy it over an open database, and do not expect an older app binary to open schema v4. See the source guide for backup recovery.

## 4. Explicit CLI equivalents

The guide saves you from copying identifiers. Scripts can use the following commands. Replace all uppercase IDs with returned IDs; these literal placeholders are not real data. Create `intent.json` and `preference.json` using the examples below. Running `intent save` or `memory add` is an explicit activation, not a preview.

```sh
pnpm siglum profile create ../memory-playground "Chinese explainer"
pnpm siglum profile list ../memory-playground
pnpm siglum list ../memory-playground
pnpm siglum profile attach ../memory-playground DOC_ID PROFILE_ID
pnpm siglum intent save ../memory-playground DOC_ID ./intent.json
pnpm siglum memory add ../memory-playground PROFILE_ID ./preference.json
pnpm siglum memory plan ../memory-playground DOC_ID revise
```

Example `intent.json` (importantOccurrenceIds accepts existing current, confirmed ledger occurrences only; a model cannot invent them):

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

Example `preference.json` (literal phrase example is fictional, not automatically saved):

```json
{
  "rule": {"key": "avoid-phrase", "value": "值得注意的是", "strength": "preferred"},
  "language": "zh-CN",
  "tasks": ["revise", "review"],
  "priority": 0,
  "example": null
}
```

Languages: `zh-CN`, `en`, explicit cross-language `any`. Tasks: `revise`, `review`, `title`. `title` is reserved for direct plan inspection and scope, not a new title-generation command. With no intent/language selected, only `any` rules match. Conflicting explicit language versus a confirmed non-any card is refused, not guessed. Priority is an author-assigned integer 0–5, not confidence.

Rule keys: `guidance`, `tone`, `sentence-style`, `avoid-phrase`, `max-characters`. Strength `required` prevents silent omission/structured override, but is not a guarantee a model complies. Maximum counts Unicode code points including whitespace/newlines; phrase checks are case-sensitive literal substring checks. Other keys require semantic review. User regex or scripts are never executed.

## 5. Draft intent with a real model only explicitly

Choose a locally installed compatible Ollama model. The first command previews; the second sends once. For remote Chat Completions-compatible services, retain the provider guide's key/environment, HTTPS and `--allow-remote` requirements.

```sh
pnpm siglum intent draft ../memory-playground DOC_ID --language zh-CN --provider ollama --model YOUR_INSTALLED_MODEL --instruction "Explain to general readers; preserve uncertainty."
pnpm siglum intent draft ../memory-playground DOC_ID --language zh-CN --provider ollama --model YOUR_INSTALLED_MODEL --instruction "Explain to general readers; preserve uncertainty." --send
pnpm siglum intent list ../memory-playground DOC_ID
pnpm siglum intent confirm ../memory-playground INTENT_VERSION_ID
```

The draft receives the explicit brief, not the whole manuscript or other profiles. Every populated output field/rule must have an exact quoted brief location or an explicit suggested-field label. Those checks prove quotation accuracy, not faithful paraphrase. Missing information stays unset or becomes a question. The author reviews all populated fields before confirmation. The memory run preserves output questions/basis and is inspectable with `memory run`.

## 6. Distil only selected reasoned feedback

```sh
pnpm siglum memory feedback ../memory-playground DOC_ID
pnpm siglum memory distill ../memory-playground DOC_ID --profile PROFILE_ID --decisions DECISION_ID --tasks revise,review --language zh-CN --provider ollama --model YOUR_INSTALLED_MODEL --instruction "Draft only preferences supported by the selected reason."
pnpm siglum memory list ../memory-playground PROFILE_ID
pnpm siglum memory activate ../memory-playground PREFERENCE_VERSION_ID
pnpm siglum memory disable ../memory-playground NEW_ACTIVE_VERSION_ID
```

The distill example is a preview; append `--send` only after inspection. `--feedback-examples DECISION_ID,...` separately authorizes before/after text for up to three selected feedback items. Default payload contains reasons/categories, not contrast text. Contrasts must be <=2000 UTF-16 units on each side; oversized items are refused instead of silently cropped. You may manually add a small author-selected example to a rule. Saving a candidate does not automatically license later example transmission.

Activation takes **version IDs**, not logical preference IDs. Every change returns a new version; using a stale version refuses. `memory correct` accepts a replacement preference JSON and explicitly activates a human correction. No reason means no motive inference. A content/evidence correction is not necessarily a style preference; model interpretation may still be wrong and needs confirmation.

## 7. Selection, conflicts, history

Optional active rules are filtered by selected profile/language/task and sorted by required status, explicit priority and stable ID. No embeddings, fuzzy semantic retrieval or extra model-selection call. All article constraints are retained. Maximum: 20 profile rules, 3 explicitly permitted examples, 24000 serialized UTF-8 bytes overall. Examples reserve their space before optional rules; required/explicit overflow refuses. Excluded optional items are reported locally, not leaked from unrelated profiles.

`--preferences` selects logical IDs explicitly; required matching profile rules remain. `--examples` separately selects logical preference IDs with an existing example. One-request exceptions come from a JSON array. Example `exceptions.json`:

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

This suggestion previews only. Add `--send` to authorize. `tone`, `sentence-style` and `max-characters` are comparable singleton keys: request > article > profile. Different values at the same winning layer cause a conflict. Overriding a required lower-layer value needs `--waive-required` with the exact entry ref shown by the plan, plus a conflicting higher-layer value. This waiver is captured only for the request. Free-text guidance/phrase rules are not semantically reconciled or arbitrarily waived; edit the confirmed rule if necessary.

Usage snapshots pin the article intent, attached profile, exact relevant preference revisions, explicitly permitted examples and exceptions. Changing related guidance during inference rejects the result; unrelated profiles, unmatched languages and unconfirmed candidates do not invalidate it. Accepting text is not accepting facts or a new preference. Mechanical checks are informational, never automatic rejection/rewriting. There is no second automatic review call.

Semantic review includes guidance only on schema-v4 captures. Legacy reports retain their original absent guidance and prompt version. They are not evidence of compliance with rules created later. Historical snapshots are immutable: disabled rules can remain in old requests and backups.

## 8. Export/import and privacy

```sh
pnpm siglum profile export ../memory-playground PROFILE_ID ../my-profile.json
pnpm siglum profile import ../memory-playground ../my-profile.json
pnpm siglum profile import ../memory-playground ../my-profile.json --apply
pnpm siglum memory help
```

Export selects active rules only, omits historical IDs/runs/manuscripts and omits examples by default. `profile export ... --examples PREF_ID,...` is a separate explicit choice. It is not a secret scanner for arbitrary text typed into a rule. The destination must not exist. Export limit is 200 active rules and 500000 bytes; split larger profiles explicitly. Import previews first, then creates a new unattached profile with candidates even with `--apply`; no auto-approval.

No automatic cross-workspace sync, OS-global scanning, secure erase, encryption or credential store is implemented. Disabling stops future selection but cannot retract previous inputs from backups or a provider. A local server can forward to a cloud. Review every displayed payload/export and only send authorized text.

See [memory protocol](memory-protocol.md), [security](security-model.md), [architecture](architecture.md) and [v0.0.5 specification](v0.0.5-spec.md).
