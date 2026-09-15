import { WriterError, isRecord, requireString } from './errors.js';
import type { Snapshot, TextBlock, ProposedEdit, Change } from './types.js';
export const MAX_DOCUMENT_BYTES = 2_000_000;
export const MAX_BLOCKS = 10_000;
export const newId = (prefix: string): string => `${prefix}_${globalThis.crypto.randomUUID()}`;

/** No Unicode normalization: spelling, combining marks, line endings and whitespace are preserved. */
export function validateText(value: unknown, label = 'text'): asserts value is string {
  if (typeof value !== 'string') throw new WriterError('INVALID_INPUT', `${label} must be a string.`);
  if (new TextEncoder().encode(value).length > MAX_DOCUMENT_BYTES) {
    throw new WriterError('INVALID_INPUT', `${label} exceeds ${MAX_DOCUMENT_BYTES} UTF-8 bytes.`);
  }
  // Reject unpaired surrogates instead of letting UTF-8 encoding silently replace them.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new WriterError('INVALID_INPUT', `${label} contains invalid Unicode.`);
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new WriterError('INVALID_INPUT', `${label} contains invalid Unicode.`);
    }
  }
}

/** Lossless blank-line segmentation, NOT a Markdown AST. Fenced code can span multiple blocks. */
export function importMarkdown(text: string): Snapshot {
  validateText(text);
  const blocks: TextBlock[] = [];
  const delimiter = /\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*/g;
  let cursor = 0;
  for (const match of text.matchAll(delimiter)) {
    blocks.push({ id: newId('blk'), version: 1, text: text.slice(cursor, match.index), separator: match[0] });
    cursor = match.index + match[0].length;
    if (blocks.length >= MAX_BLOCKS) throw new WriterError('INVALID_INPUT', 'Too many text blocks.');
  }
  blocks.push({ id: newId('blk'), version: 1, text: text.slice(cursor), separator: '' });
  return { blocks };
}
export function renderMarkdown(snapshot: Snapshot): string {
  return snapshot.blocks.map(b => b.text + b.separator).join('');
}
export function validateSnapshot(value: unknown): asserts value is Snapshot {
  if (!isRecord(value) || !Array.isArray(value.blocks) || value.blocks.length < 1 || value.blocks.length > MAX_BLOCKS) {
    throw new WriterError('INVALID_INPUT', 'Invalid document snapshot.');
  }
  const seen = new Set<string>();
  for (const block of value.blocks as unknown[]) {
    if (!isRecord(block)) throw new WriterError('INVALID_INPUT', 'Invalid text block.');
    requireString(block.id, 'block.id');
    if (seen.has(block.id)) throw new WriterError('INVALID_INPUT', 'Duplicate block ID.');
    seen.add(block.id);
    if (!Number.isSafeInteger(block.version) || (block.version as number) < 1) throw new WriterError('INVALID_INPUT', 'Invalid block version.');
    validateText(block.text, 'block.text');
    validateText(block.separator, 'block.separator');
    if (block.separator !== '' && !/^(?:\r?\n[ \t]*){2,}$/.test(block.separator)) {
      throw new WriterError('INVALID_INPUT', 'Invalid block separator.');
    }
  }
  validateText(renderMarkdown(value as unknown as Snapshot), 'document');
}
export function parseSnapshot(json: string): Snapshot {
  try {
    const value: unknown = JSON.parse(json);
    validateSnapshot(value);
    return value;
  } catch {
    throw new WriterError('CORRUPT_DATA', 'Stored snapshot is invalid; restore a backup rather than editing the database.');
  }
}
export function validateEdits(value: unknown): asserts value is readonly ProposedEdit[] {
  if (!Array.isArray(value) || value.length > 100) throw new WriterError('INVALID_INPUT', 'edits must be an array with at most 100 items.');
  const seen = new Set<string>();
  for (const edit of value as unknown[]) {
    if (!isRecord(edit)) throw new WriterError('INVALID_INPUT', 'Invalid edit.');
    requireString(edit.blockId, 'edit.blockId');
    requireString(edit.summary, 'edit.summary', 1000);
    validateText(edit.before, 'edit.before');
    validateText(edit.after, 'edit.after');
    if (edit.before === edit.after) throw new WriterError('INVALID_INPUT', 'No-op edits are not allowed.');
    if (seen.has(edit.blockId)) throw new WriterError('INVALID_INPUT', 'One batch cannot edit the same block twice.');
    seen.add(edit.blockId);
  }
}

/** Exact preconditions, not substring search. Editing another block does not cause a conflict. */
export function replaceBlock(snapshot: Snapshot, blockId: string, expectedVersion: number, before: string, after: string): Snapshot {
  validateSnapshot(snapshot);
  validateText(before, 'before');
  validateText(after, 'after');
  const target = snapshot.blocks.find(b => b.id === blockId);
  if (!target || target.version !== expectedVersion || target.text !== before) {
    throw new WriterError('CHANGE_CONFLICT', 'This block changed after the proposal. Request a fresh proposal; no text was overwritten.');
  }
  const next: Snapshot = { blocks: snapshot.blocks.map(b => b.id === blockId ? { ...b, text: after, version: b.version + 1 } : { ...b }) };
  validateSnapshot(next);
  return next;
}
export function applyChange(snapshot: Snapshot, change: Change): Snapshot {
  if (change.status !== 'pending') throw new WriterError('INVALID_TRANSITION', 'Only pending changes can be accepted.');
  return replaceBlock(snapshot, change.blockId, change.baseBlockVersion, change.before, change.after);
}
export function revertChange(snapshot: Snapshot, change: Change): Snapshot {
  if (change.status !== 'accepted' || change.acceptedBlockVersion === null) {
    throw new WriterError('INVALID_TRANSITION', 'Only accepted, unreverted changes can be reverted.');
  }
  return replaceBlock(snapshot, change.blockId, change.acceptedBlockVersion, change.after, change.before);
}
