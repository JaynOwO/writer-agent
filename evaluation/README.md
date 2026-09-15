# Semantic review evaluation scaffold

**Not a validated benchmark. No real model was evaluated by shipping these files.**

`semantic-review-draft.json` contains 80 synthetic cases (40 en, 40 zh-CN) with AI-authored draft expectations. Every case has `labelStatus: "draft-ai-authored"`, `reviewedBy: null`. The scope is document-level within the case's synthetic text, not any external article. Cases cover harmless paraphrases and changes in certainty, attribution, time, numbers, scope, causality, relocation/splits and selected-evidence relations. Development examples and held-out-draft examples are marked; paired translations belong to the same split. They have not been independently adjudicated and must not be represented as held-out human ground truth.

## Label review before quality claims

Review each original/rewrite/material set, account for ambiguity and defensible abstentions, revise the proposed labels, and record a real reviewer only after that review occurs. Set labelStatus to human-reviewed only then. Preserve disagreement/context; do not ask the evaluated model to certify its own answer. Labels are multi-label category expectations, not claims that the text itself is factually true.

## Scoring existing predictions (offline)

Create a predictions JSON array from a separately recorded run. Each entry has:

```json
[
  {
    "id": "en-01",
    "model": "ACTUAL_REQUESTED_MODEL_AND_VERSION",
    "labels": ["certainty"],
    "abstain": false,
    "quotationValid": true,
    "latencyMs": 1000
  }
]
```

The example above is a shape illustration, not an actual prediction or measurement. quotationValid and latencyMs are optional; unknown measurements must be omitted, not set to zero/true. An abstention carries no category labels. IDs must exist in the corpus, and duplicates/unknown categories are refused. Keep full raw run reports privately so category normalization can be reviewed rather than silently replacing model results.

```sh
node scripts/score-review-eval.mjs evaluation/semantic-review-draft.json ../private-predictions.json
```

The committed labels are unreviewed, so the normal command refuses them. For developing the scoring plumbing only, use:

```sh
node scripts/score-review-eval.mjs evaluation/semantic-review-draft.json ../private-predictions.json --allow-draft-labels
```

This does not relax any inference or manuscript safety rule. It explicitly marks metrics draft-exploratory-only. The scorer never contacts a provider or automatically obtains predictions, consumes an API key or estimates charges.

## Interpretation

Outputs include submitted/missing cases, abstentions, coverage, per-category counts and precision, recallOnNonAbstained, harmless-rewrite false alarms, quotation validity and mean reported latency. Null means unmeasured/undefined. Recall intentionally excludes abstentions/missing predictions: interpret it with coverage, never as overall success. Partial runs do not become complete benchmarks. Predictions from different models should be scored separately rather than pooled into a misleading one-model number. Expected-abstention cases remain draft ambiguity annotations; abstention appropriateness is not automatically adjudicated by the scorer.

The scorer cannot verify run provenance, model identity or token billing. `liveRunVerified` and `qualityClaimAllowed` remain false even for a human-labelled corpus. `referenceLabelsHumanReviewed` concerns only the accepted input labels. Human labels, valid quotes, successful HTTP tests and category metrics do not prove factual truth.

简中：这里是评估工具和 80 条待人工审阅的虚构案例，不是已经完成的真实模型测评。默认不会调用模型；草案标签只能在显式 --allow-draft-labels 下测试评分流程。不要把软件测试通过率、未回答样例被排除后的召回率或 AI 自己生成的标签包装成“语义准确率”。
