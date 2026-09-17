export interface TextBlock {
  readonly id: string;
  /** Monotonic per block; never reset, including when restoring older text. */
  readonly version: number;
  readonly text: string;
  /** Verbatim blank-line delimiter. Editing text does not alter this delimiter. */
  readonly separator: string;
}
export interface Snapshot { readonly blocks: readonly TextBlock[] }
export interface DocumentRecord {
  readonly id: string;
  readonly title: string;
  readonly headRevisionId: string;
  readonly createdAt: string;
}
export interface Revision {
  readonly id: string;
  readonly documentId: string;
  readonly parentId: string | null;
  readonly kind: 'created' | 'accepted' | 'reverted';
  /** Companion journal identifies new actions without rewriting legacy revision rows. */
  readonly editOrigin?: 'range-accepted' | 'range-reverted' | 'manual-edited';
  readonly changeId: string | null;
  readonly snapshot: Snapshot;
  readonly createdAt: string;
}
export interface ProposedEdit {
  readonly blockId: string;
  readonly before: string;
  readonly after: string;
  readonly summary: string;
}
export interface ReviewHint {
  readonly code: 'certainty-increase' | 'attribution-removed' | 'causality-added' | 'scope-widened';
  readonly detector: 'lexical-v1';
  readonly message: string;
  /** These are lexical triggers, not evidence of truth or model confidence. */
  readonly triggers: readonly string[];
}
export interface Change extends ProposedEdit {
  readonly id: string;
  readonly documentId: string;
  readonly baseRevisionId: string;
  readonly baseBlockVersion: number;
  readonly providerId: string;
  readonly hints: readonly ReviewHint[];
  readonly status: 'pending' | 'accepted' | 'rejected' | 'reverted';
  readonly acceptedRevisionId: string | null;
  readonly acceptedBlockVersion: number | null;
  readonly createdAt: string;
}
export interface Decision {
  readonly sequence: number;
  readonly id: string;
  readonly changeId: string;
  readonly action: 'accepted' | 'rejected' | 'reverted';
  readonly reason: string;
  readonly revisionId: string;
  readonly createdAt: string;
}
export interface WorkspaceInfo {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly schemaVersion: number;
}
