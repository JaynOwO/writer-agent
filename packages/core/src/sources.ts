// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { WriterError, isRecord, requireString } from './errors.js';
import { validateText } from './document.js';

export const MAX_SOURCE_BYTES = 2_000_000;
export const MAX_SOURCE_TEXT_BYTES = 1_000_000;
export const MAX_CONTEXT_BYTES = 80_000;
export const MAX_CONTEXT_ITEMS = 8;
export const SOURCE_EXTRACTOR_VERSION = 'siglum-text-v1';
export const hashBytes = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export type SourceMediaType = 'text/html' | 'text/plain' | 'text/markdown';
/** All metadata is reported by a page/user, not verified authorship, publication time or truth. */
export interface SourceMetadata {
  readonly title: string | null;
  readonly author: string | null;
  readonly publishedAt: string | null;
  readonly publisher: string | null;
}
export interface SourceRecord {
  readonly id: string;
  readonly kind: 'web' | 'file';
  /** Normalized requested URL, or only a local file's basename (never a full private path). */
  readonly locator: string;
  readonly createdAt: string;
}
export interface SourceSnapshot {
  readonly id: string;
  readonly sourceId: string;
  readonly capturedAt: string;
  readonly mediaType: SourceMediaType;
  readonly rawHash: string;
  readonly textHash: string;
  readonly rawBytes: number;
  readonly text: string;
  readonly metadata: SourceMetadata;
  readonly extractor: string;
  readonly warnings: readonly string[];
}
export interface SourceExcerpt {
  readonly id: string;
  readonly snapshotId: string;
  readonly sourceId: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly quote: string;
  readonly quoteHash: string;
  readonly createdAt: string;
}
export interface ResearchNote {
  readonly id: string;
  readonly snapshotId: string;
  readonly excerptId: string | null;
  readonly text: string;
  readonly createdAt: string;
}
export interface SourceSelection {
  readonly snapshots?: readonly string[];
  readonly excerpts?: readonly string[];
}
/** Evidence of what was supplied, not proof the model used it or that it supports any claim. */
export interface SourceContextItem {
  readonly sourceId: string;
  readonly snapshotId: string;
  readonly excerptId: string | null;
  readonly locator: string;
  readonly title: string | null;
  readonly textHash: string;
  readonly contentHash: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}
export interface ProposalContextInput {
  readonly items: readonly SourceContextItem[];
  readonly instruction: string;
}
export interface SourceBinding {
  readonly id: string;
  readonly documentId: string;
  readonly revisionId: string;
  readonly blockId: string;
  readonly blockVersion: number;
  readonly excerptId: string;
  readonly createdAt: string;
  readonly state: 'current' | 'stale';
  readonly verification: 'user-linked-not-verified';
}
export function sourceText(value: unknown, limit = MAX_SOURCE_TEXT_BYTES): asserts value is string {
  validateText(value, 'source text');
  if (Buffer.byteLength(value, 'utf8') > limit) throw new WriterError('INVALID_INPUT', 'Source text exceeds its byte limit. Choose a smaller source or excerpt.');
}
export function validateMetadata(value: unknown): asserts value is SourceMetadata {
  if (!isRecord(value) || Object.keys(value).length !== 4) throw new WriterError('INVALID_INPUT', 'Invalid source metadata.');
  for (const key of ['title','author','publishedAt','publisher']) {
    const field = value[key];
    if (field !== null) { requireString(field, 'source metadata', 1000); validateText(field); }
  }
}
/** Line numbers are 1-based inclusive in immutable extracted text, NOT original HTML/PDF lines. */
export function lineRange(text: string, start: number, end: number) {
  sourceText(text);
  const starts = [0];
  for (const m of text.matchAll(/\r\n|\r|\n/g)) starts.push(m.index + m[0].length);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > starts.length) {
    throw new WriterError('INVALID_INPUT', 'Invalid extracted-text line range. Lines are 1-based and inclusive.');
  }
  const startOffset = starts[start - 1]!;
  let endOffset = starts[end] ?? text.length;
  // Exclude the line-ending after the selected final line, but retain all inner line endings.
  if (end < starts.length) {
    if (text[endOffset - 1] === '\n') endOffset--;
    if (text[endOffset - 1] === '\r') endOffset--;
  }
  const quote = text.slice(startOffset, endOffset);
  return { startLine: start, endLine: end, startOffset, endOffset, quote, quoteHash: hashBytes(quote) };
}
export const lineCount = (text: string): number => [...text.matchAll(/\r\n|\r|\n/g)].length + 1;
export function validateSourceContext(value: unknown): asserts value is readonly SourceContextItem[] {
  if (!Array.isArray(value) || value.length > MAX_CONTEXT_ITEMS) throw new WriterError('INVALID_INPUT', `Select at most ${MAX_CONTEXT_ITEMS} source context items.`);
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    if (!isRecord(item)) throw new WriterError('INVALID_INPUT', 'Invalid source context.');
    const keys = ['sourceId','snapshotId','excerptId','locator','title','textHash','contentHash','startLine','endLine','text'];
    if (Object.keys(item).length !== keys.length || keys.some(k => !Object.hasOwn(item,k))) throw new WriterError('INVALID_INPUT','Unexpected source context fields.');
    for (const k of ['sourceId','snapshotId']) requireString(item[k], k, 200);
    if (item.excerptId !== null) requireString(item.excerptId, 'excerptId', 200);
    requireString(item.locator, 'locator', 4096);
    if (item.title !== null) requireString(item.title, 'source title', 1000);
    validateText(item.locator); if (item.title !== null) validateText(item.title);
    for (const k of ['textHash','contentHash']) if (typeof item[k] !== 'string' || !/^[a-f0-9]{64}$/.test(item[k])) throw new WriterError('INVALID_INPUT','Invalid source hash.');
    sourceText(item.text, MAX_CONTEXT_BYTES);
    if (hashBytes(item.text) !== item.contentHash) throw new WriterError('INVALID_INPUT','Source context content hash mismatch.');
    if (!Number.isSafeInteger(item.startLine) || !Number.isSafeInteger(item.endLine) || Number(item.startLine) < 1 || Number(item.endLine) < Number(item.startLine)) throw new WriterError('INVALID_INPUT','Invalid context lines.');
    const identity = `${item.snapshotId}:${item.excerptId ?? 'full'}`;
    if (seen.has(identity)) throw new WriterError('INVALID_INPUT','Duplicate source context item.');
    seen.add(identity);
  }
  if (Buffer.byteLength(JSON.stringify(value),'utf8') > MAX_CONTEXT_BYTES) throw new WriterError('INVALID_INPUT', 'Selected source context exceeds 80000 serialized UTF-8 bytes. Select excerpts; nothing was truncated or sent.');
}

/** Reject mistyped/hidden selection options instead of silently treating them as no context. */
export function validateSourceSelection(value:unknown):asserts value is SourceSelection {
  if(!isRecord(value)||Object.keys(value).some(k=>k!=='snapshots'&&k!=='excerpts'))throw new WriterError('INVALID_INPUT','Source selection must contain only snapshots/excerpts.');
  let total=0;
  for(const key of ['snapshots','excerpts']) {
    if(!Object.hasOwn(value,key))continue;
    const ids=value[key];if(!Array.isArray(ids))throw new WriterError('INVALID_INPUT','Source selection IDs must be arrays.');
    total+=ids.length;const seen=new Set<string>();
    for(const id of ids){requireString(id,'source selection ID',200);if(seen.has(id))throw new WriterError('INVALID_INPUT','Duplicate source selection ID.');seen.add(id);}
  }
  if(total>MAX_CONTEXT_ITEMS)throw new WriterError('INVALID_INPUT','Select at most 8 source items.');
}
