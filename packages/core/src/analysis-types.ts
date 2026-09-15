// SPDX-License-Identifier: Apache-2.0
import type { Snapshot, SourceContextItem } from './index.js';
export const CLAIM_KINDS = ['testable', 'inference', 'attributed', 'value-judgment', 'unclassified'] as const;
export type ClaimKind = typeof CLAIM_KINDS[number];
export const FINDING_CATEGORIES = ['certainty', 'attribution', 'scope', 'time', 'numeric', 'causality', 'claim-added', 'claim-unmapped', 'claim-reversed', 'claim-reformulated', 'evidence-shift', 'protected-claim'] as const;
export const EVIDENCE_RELATIONS = ['not-assessed', 'supports', 'partially-supports', 'contradicts', 'insufficient', 'uncertain'] as const;
export type EvidenceRelation = typeof EVIDENCE_RELATIONS[number];
export const MAPPING_RELATIONS = ['equivalent', 'reformulated', 'reversed', 'split', 'merged', 'removed', 'added', 'uncertain'] as const;
/** UTF-16 offsets, end exclusive. Never guessed by first substring match. */
export interface TextAnchor {
    readonly blockId: string;
    readonly start: number;
    readonly end: number;
    readonly quote: string;
}
export interface PinnedAnchor extends TextAnchor {
    readonly blockVersion: number;
    readonly quoteHash: string;
}
export interface SourceQuote {
    readonly itemIndex: number;
    readonly start: number;
    readonly end: number;
    readonly quote: string;
}
export interface ClaimCandidate {
    readonly ref: string;
    readonly statement: string;
    readonly kind: ClaimKind;
    readonly anchors: readonly TextAnchor[];
}
export interface ClaimOccurrence {
    readonly id: string;
    readonly claimId: string;
    readonly documentId: string;
    readonly revisionId: string;
    readonly statement: string;
    readonly kind: ClaimKind;
    readonly anchors: readonly PinnedAnchor[];
    readonly origin: 'manual' | 'model-candidate';
    readonly runId: string | null;
    readonly createdAt: string;
}
export interface ProtectedClaim {
    readonly claimId: string;
    readonly occurrenceId: string;
    readonly statement: string;
    readonly anchors: readonly TextAnchor[];
}
export interface AnalysisRequest {
    readonly protocolVersion: 1;
    readonly task: 'claim-extraction' | 'semantic-review';
    readonly documentId: string;
    readonly baseRevisionId: string;
    readonly instruction: string;
    readonly scope: 'blocks' | 'document';
    readonly documentBlockCount: number;
    readonly before: Snapshot;
    readonly after: Snapshot | null;
    readonly changes: readonly {
        readonly id: string;
        readonly hash: string;
    }[];
    readonly sources: readonly SourceContextItem[];
    readonly protectedClaims: readonly ProtectedClaim[];
    /** Explicitly disclosed omitted constraints, never sent as invisible manuscript context. */
    readonly excludedProtectedClaimIds: readonly string[];
    readonly ledgerStamp: string;
}
export interface ExtractionOutput {
    readonly protocolVersion: 1;
    readonly task: 'claim-extraction';
    readonly documentId: string;
    readonly baseRevisionId: string;
    readonly candidates: readonly ClaimCandidate[];
    readonly notes: readonly string[];
}
export interface ClaimMapping {
    readonly beforeRefs: readonly string[];
    readonly afterRefs: readonly string[];
    readonly relation: typeof MAPPING_RELATIONS[number];
    readonly explanation: string;
}
export interface SemanticFinding {
    readonly ref: string;
    readonly category: typeof FINDING_CATEGORIES[number];
    readonly before: readonly TextAnchor[];
    readonly after: readonly TextAnchor[];
    readonly beforeRefs: readonly string[];
    readonly afterRefs: readonly string[];
    readonly sourceQuotes: readonly SourceQuote[];
    readonly importantClaimIds: readonly string[];
    readonly explanation: string;
}
export interface ModelEvidenceAssessment {
    readonly side: 'before' | 'after';
    readonly claimRef: string;
    readonly relation: EvidenceRelation;
    readonly sourceQuotes: readonly SourceQuote[];
    readonly explanation: string;
}
export interface SemanticOutput {
    readonly protocolVersion: 1;
    readonly task: 'semantic-review';
    readonly documentId: string;
    readonly baseRevisionId: string;
    readonly beforeClaims: readonly ClaimCandidate[];
    readonly afterClaims: readonly ClaimCandidate[];
    readonly mappings: readonly ClaimMapping[];
    readonly findings: readonly SemanticFinding[];
    readonly assessments: readonly ModelEvidenceAssessment[];
    readonly notes: readonly string[];
}
export type AnalysisOutput = ExtractionOutput | SemanticOutput;
export interface AnalysisUsage {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly totalTokens: number | null;
}
export interface AnalysisProviderInfo {
    readonly providerId: string;
    readonly model: string;
    readonly endpoint: string;
    readonly responseFormat: string;
    readonly tokenParameter: string | null;
    readonly timeoutMs: number;
    readonly maxOutputTokens: number;
}
export interface AnalysisRun {
    readonly id: string;
    readonly documentId: string;
    readonly baseRevisionId: string;
    readonly request: AnalysisRequest;
    readonly output: AnalysisOutput;
    readonly provider: AnalysisProviderInfo;
    readonly usage: AnalysisUsage | null;
    readonly durationMs: number;
    readonly promptVersion: 'analysis-v1';
    readonly status: 'completed';
    readonly interpretation: 'model-assessment-not-verified';
    readonly createdAt: string;
}
export type ClaimDecisionAction = 'confirm' | 'dismiss' | 'correct' | 'important' | 'unimportant';
export interface ClaimDecision {
    readonly id: string;
    readonly claimId: string;
    readonly occurrenceId: string;
    readonly action: ClaimDecisionAction;
    readonly reason: string;
    readonly replacementOccurrenceId: string | null;
    readonly createdAt: string;
}
export interface FindingDecision {
    readonly id: string;
    readonly runId: string;
    readonly findingRef: string;
    readonly action: 'agree' | 'disagree' | 'needs-review' | 'correct';
    readonly reason: string;
    readonly correction: string | null;
    readonly documentRevisionAtDecision: string;
    readonly createdAt: string;
}
export interface HumanEvidenceAssessment {
    readonly id: string;
    readonly occurrenceId: string;
    readonly sources: readonly SourceContextItem[];
    readonly relation: EvidenceRelation;
    readonly sourceQuotes: readonly SourceQuote[];
    readonly explanation: string;
    readonly origin: 'human-assessment';
    readonly createdAt: string;
}
