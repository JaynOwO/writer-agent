# Writing memory protocol v1 — Siglum v0.0.5

## Authority and lifecycle

The host owns document/profile IDs, intent versions, preference versions, approval state, language/task scope and exact evidence selections. Models have value snapshots, no SQL/file/Git/approval handles. New model tasks are `intent-draft` and `preference-draft`, independent of Proposal Protocol v1 and Analysis Protocol v1. Transport settings, endpoint rules, cancellation, limits and no-retry/no-fallback behavior are reused. No automatic background calls or credential retrieval through memory.

Manual `saveIntent` creates and confirms an immutable card in one transaction. A model draft creates an unconfirmed version tied to its run, current document revision and active-intent parent. Confirmation rechecks both: stale drafts cannot overwrite newer work. Manually saving changed fields creates a human-authored version. Existing important-claim occurrences must be current and confirmed; AI cannot invent them. The card does not certify the truth of its thesis or claims.

Manual preference creation activates the author's explicit rule. Model and imported preferences start candidate-only. Selected candidates/disabled rules may be explicitly activated, active rules disabled, candidates dismissed. A human correction appends an active replacement. Every operation requires the exact latest version and one profile per batch; old states/requests remain historical. Model-activation counts/confidence scores do not exist.

## MemoryTaskRequest

Required, no additional fields: `protocolVersion:1`, `requestId`, `task`, `documentId`, `baseRevisionId`, `baseIntentId`, `profileId`, `language`, `tasks`, `brief`, `evidence`.

For intent drafting, profileId is null, evidence is empty, and only the explicitly entered brief is supplied, not the manuscript. For preference drafting, the author chooses a real profile, explicit language/task scope and 1–20 reasoned rejected/reverted decisions from the selected document. Each evidence item includes exact IDs/action/category/reason. Before/after examples are null unless separately authorized, at most 3 and <=2000 UTF-16 units per side. No reason/category means rejection is not eligible evidence. Contrasts are opt-in snippets for this call, not permanent future transmission permission.

Requests/responses are bounded at 160000 serialized UTF-8 bytes, within the existing transport cap. No implicit splitting, cropping or batch follow-up. A larger document is not silently sent just because an intent card is attached.

## Wire responses

Both require matching protocolVersion/task/requestId. Unknown fields, duplicate JSON keys, invalid IDs, deep/incomplete/fenced JSON or invalid evidence are refused before persistence.

Intent response fields: `card:{audience,purpose,thesis,rules}`, `basis:[{field,start,end,quote}]`, `suggestedFields`, `questions`. Every nonempty card field and every zero-based rule:N must have an exact quoted brief span OR an explicit suggested-field label. UTF-16 boundaries must not split a surrogate pair. Missing information may be empty/questions. Locations verify literal attribution only: they cannot guarantee a model paraphrase captures author intent. The host adds selected language; model-generated importantOccurrenceIds, active state or permission fields are forbidden.

Preference response fields: `candidates:[{rule,evidenceIds,explanation}]`, `notes`. At most 20 candidates. Each needs at least one selected decision ID and explanation <=2000 UTF-16 units. Scope/priority/state/IDs are host controlled; a valid empty list saves a completed draft run but no invented rules. The model cannot attach examples automatically. Candidate explanations may be wrong; the author reviews them.

Successful runs preserve the exact request and validated output, safe provider settings, promptVersion `memory-v1`, returned usage or null, and authority `model-draft-not-active`. Failure/cancellation/stale output saves no draft/current result. No hidden chain-of-thought or raw error body is retained.

## Rule values, scope and selection

Rule is `{key,value,strength}`. Keys guidance/tone/sentence-style/avoid-phrase/max-characters; strength preferred|required. Language zh-CN|en|any and tasks revise|review|title are explicit enums. `priority:0..5` is author ordering, not confidence. Examples are optional before/after/reason objects with different text and bounded sizes.

Active rules are filtered by attached profile, language and task. No global profile, OS-language inference, vector retrieval or extra model-selection call. Required, priority and stable ID ordering is reproducible. All active matching revisions affect freshness even if optional-budget-excluded; unrelated profiles, other languages and candidates do not. This conservative choice prevents newly relevant rules being ignored after a request was prepared.

Singleton exact values tone/sentence-style/max-characters follow request > document > profile. Same winning-layer different values are a conflict, not last-write-wins. Lower required different values need a named exact waiver and an actual conflicting higher-layer value. Identical overrides retain inherited required strength. Arbitrary guidance/phrase rules cannot be waved away via this structured mechanism; free-text contradiction detection remains incomplete and semantic.

Limits: 20 profile rules, 20 article rules, 20 request exception rules, 3 separately permitted examples, 24000 serialized UTF-8 bytes for the packet. Required/document/request/explicit rules and selected examples reserve space first; if they do not fit, refuse. Optional rules fill the remainder with local exclusion explanations. An authorized example requires its exact rule to remain selected. `title` is a scope enum, not a new title-generation action.

## Captures and integration

`MemoryCapture` has version1/documentId/task/normalized options/stamp/packet. The packet contains intent summary/version, profile summary, selected rule-version entries, explicitly selected examples, important occurrence summaries, request exceptions and waived refs. `authority` is author-guidance-not-facts-or-permissions. Excluded profile text, unused history and credentials never enter the packet.

Proposal requests optionally add `guidance:MemoryPacket`; the Proposal v1 response stays unchanged. Schema-v4 CLI suggestions capture guidance even when empty, check it before transmission and reconstruct it inside the proposal transaction. Pending proposals, source provenance and guidance uses commit together. Invalid/stale output commits none. Providers receive a separate copy; no network wait holds the transaction.

Semantic AnalysisRequest optionally adds `memory:MemoryCapture`, new captures use promptVersion `analysis-memory-v1`, and category enums include intent-drift/style-guidance. The model sees the packet as author guidance, not as verified truth. The local host checks exact memory, document, pending status and ledger freshness before storing. Relevant memory changes make that saved report historical. Legacy reports without memory keep their original input/prompt version, not empty invented snapshots; they cannot establish compliance with later requirements.

A usage record pins old material. Disable does not mutate old reports or erase backups/remote transmissions. Source refresh does not change pinned source context. Model assessments/author feedback/text approval remain separate.

## Mechanical checking and export

max-characters counts Unicode code points including spaces/newlines, not grapheme clusters or language-specific words. avoid-phrase is case-sensitive literal substring matching, never regex or executable code. Checks return informational findings and `semanticChecks:not-performed`; they cannot reject/repair/accept text automatically. Semantic checks require a separately authorized review.

Profile export format1 contains only name and selected active preference inputs; no run/history IDs, paths or credentials fields. Private examples are omitted unless individually selected for export. Literal user text is not scanned for secrets. Import validates <=200 rules/500000 bytes and previews; --apply creates a new unattached profile with candidate rules, no automatic approval. No silent cross-workspace sync or secure erase.
