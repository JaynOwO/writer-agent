// SPDX-License-Identifier: Apache-2.0
export const MEMORY_LANGUAGES = ['zh-CN', 'en', 'any'] as const;
export type WritingLanguage = typeof MEMORY_LANGUAGES[number];
export const WRITING_TASKS = ['revise', 'review', 'title'] as const;
export type WritingTask = typeof WRITING_TASKS[number];
export const RULE_KEYS = ['guidance', 'tone', 'sentence-style', 'avoid-phrase', 'max-characters'] as const;
export interface WritingRule {
  readonly key: typeof RULE_KEYS[number];
  readonly value: string;
  readonly strength: 'preferred' | 'required';
}
export interface IntentCard {
  readonly language: WritingLanguage;
  readonly audience: string;
  readonly purpose: string;
  readonly thesis: string;
  readonly rules: readonly WritingRule[];
  /** User-selected existing occurrences, not IDs invented by a model. */
  readonly importantOccurrenceIds: readonly string[];
}
export interface IntentVersion {
  readonly id: string;
  readonly documentId: string;
  readonly baseRevisionId: string;
  readonly parentId: string | null;
  readonly card: IntentCard;
  readonly origin: 'manual' | 'model-draft';
  readonly runId: string | null;
  readonly createdAt: string;
}
export interface WritingProfile { readonly id: string; readonly name: string; readonly createdAt: string }
export interface WritingExample { readonly before: string; readonly after: string; readonly reason: string }
export interface PreferenceInput {
  readonly rule: WritingRule;
  readonly language: WritingLanguage;
  readonly tasks: readonly WritingTask[];
  readonly priority: number;
  readonly example: WritingExample | null;
}
export type PreferenceStatus = 'candidate' | 'active' | 'disabled' | 'dismissed' | 'superseded';
export interface PreferenceVersion extends PreferenceInput {
  readonly id: string;
  readonly preferenceId: string;
  readonly profileId: string;
  readonly previousId: string | null;
  readonly status: PreferenceStatus;
  readonly origin: 'manual' | 'model-candidate' | 'imported' | 'human-correction';
  readonly evidenceIds: readonly string[];
  readonly runId: string | null;
  readonly reason: string;
  readonly createdAt: string;
}
export interface MemoryOptions {
  /** Explicit language when no active card defines one; never inferred from the system locale. */
  readonly language?: WritingLanguage;
  readonly selectedPreferenceIds?: readonly string[];
  /** Permission to include these examples in THIS request, not a standing consent. */
  readonly examplePreferenceIds?: readonly string[];
  readonly exceptions?: readonly WritingRule[];
  /** Exact entry refs the author explicitly permits this request to override. */
  readonly waiveRequiredRefs?: readonly string[];
}
export interface NormalizedMemoryOptions {
  readonly language: WritingLanguage | null;
  readonly selectedPreferenceIds: readonly string[];
  readonly examplePreferenceIds: readonly string[];
  readonly exceptions: readonly WritingRule[];
  readonly waiveRequiredRefs: readonly string[];
}
export interface GuidanceEntry {
  readonly ref: string;
  readonly layer: 'profile' | 'document' | 'request';
  readonly rule: WritingRule;
}
export interface MemoryPacket {
  readonly version: 1;
  readonly task: WritingTask;
  readonly language: WritingLanguage;
  readonly intent: { readonly versionId: string; readonly audience: string; readonly purpose: string; readonly thesis: string } | null;
  readonly profile: { readonly id: string; readonly name: string } | null;
  readonly entries: readonly GuidanceEntry[];
  readonly examples: readonly { readonly preferenceVersionId: string; readonly example: WritingExample }[];
  readonly importantClaims: readonly { readonly occurrenceId: string; readonly claimId: string; readonly statement: string }[];
  readonly exceptions: readonly WritingRule[];
  readonly waivedRequiredRefs: readonly string[];
  readonly authority: 'author-guidance-not-facts-or-permissions';
}
export interface MemoryCapture {
  readonly version: 1;
  readonly documentId: string;
  readonly task: WritingTask;
  readonly options: NormalizedMemoryOptions;
  readonly stamp: string;
  readonly packet: MemoryPacket;
}
export interface MemoryPlan {
  readonly capture: MemoryCapture;
  readonly bytes: number;
  readonly included: readonly { readonly ref: string; readonly reason: string }[];
  readonly excluded: readonly { readonly ref: string; readonly reason: string }[];
  readonly conflicts: readonly { readonly refs: readonly string[]; readonly key: string; readonly reason: string }[];
}
export interface MemoryUse {
  readonly id: string;
  readonly documentId: string;
  readonly baseRevisionId: string;
  readonly task: WritingTask;
  readonly capture: MemoryCapture;
  readonly changeIds: readonly string[];
  readonly instruction: string;
  readonly providerId: string;
  readonly createdAt: string;
}
export const REJECTION_CATEGORIES = ['meaning', 'certainty', 'voice', 'unnecessary', 'content', 'other'] as const;
export type RejectionCategory = typeof REJECTION_CATEGORIES[number];
export interface FeedbackEvidence {
  readonly decisionId: string;
  readonly documentId: string;
  readonly changeId: string;
  readonly action: 'rejected' | 'reverted';
  readonly category: RejectionCategory | null;
  readonly reason: string;
  readonly example: WritingExample | null;
}
export interface MemoryTaskRequest {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly task: 'intent-draft' | 'preference-draft';
  readonly documentId: string;
  readonly baseRevisionId: string;
  readonly baseIntentId: string | null;
  readonly profileId: string | null;
  readonly language: WritingLanguage;
  readonly tasks: readonly WritingTask[];
  readonly brief: string;
  readonly evidence: readonly FeedbackEvidence[];
}
export interface IntentDraftOutput {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly task: 'intent-draft';
  readonly card: { readonly audience: string; readonly purpose: string; readonly thesis: string; readonly rules: readonly WritingRule[] };
  /** Every nonempty field/rule has either an exact brief quote or an explicit suggestion label. */
  readonly basis: readonly { readonly field: string; readonly start: number; readonly end: number; readonly quote: string }[];
  readonly suggestedFields: readonly string[];
  readonly questions: readonly string[];
}
export interface PreferenceDraftOutput {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly task: 'preference-draft';
  readonly candidates: readonly { readonly rule: WritingRule; readonly evidenceIds: readonly string[]; readonly explanation: string }[];
  readonly notes: readonly string[];
}
export type MemoryTaskOutput = IntentDraftOutput | PreferenceDraftOutput;
