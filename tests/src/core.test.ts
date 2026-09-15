import assert from 'node:assert/strict';
import test from 'node:test';
import { importMarkdown, renderMarkdown, replaceBlock, validateSnapshot, validateEdits, validateText, parseSnapshot, MAX_DOCUMENT_BYTES } from '@writer-agent/core';
import { expectCode } from './helpers.js';

const samples: Record<string, string> = {
  empty: '', single: '一段文字。', paragraphs: '第一段\n\n第二段\n', CRLF: '甲\r\n\r\n乙\r\n',
  whitespace: '\n\n  缩进\n \n\n\t第二段\n\n', unicode: '\ufeff中文😀👨‍👩‍👧‍👦e\u0301\n\n繁體',
  fences: '```ts\nconst x = 1;\n\nconsole.log(x);\n```\n\n结尾', mixed: '甲\r\n\r\n乙\n\n丙\n',
};
for (const [name, markdown] of Object.entries(samples)) {
  test(`lossless Markdown import/export: ${name}`, () => {
    const snapshot = importMarkdown(markdown);
    validateSnapshot(snapshot);
    assert.equal(renderMarkdown(snapshot), markdown);
    assert.equal(new Set(snapshot.blocks.map(b => b.id)).size, snapshot.blocks.length);
  });
}
test('replacement is immutable and increments only the target block version', () => {
  const snapshot = importMarkdown('甲\n\n乙');
  const before = JSON.stringify(snapshot); const target = snapshot.blocks[0]; assert.ok(target);
  const result = replaceBlock(snapshot, target.id, 1, '甲', '丙');
  assert.equal(renderMarkdown(result), '丙\n\n乙');
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(result.blocks[0]?.version, 2); assert.equal(result.blocks[1]?.version, 1);
  assert.equal(result.blocks[0]?.id, target.id);
});
test('text precondition refuses inexact replacement', () => {
  const s = importMarkdown('可能'); assert.ok(s.blocks[0]);
  expectCode(() => replaceBlock(s, s.blocks[0]!.id, 1, '可', '会'), 'CHANGE_CONFLICT');
});
test('block version detects ABA even after text has been restored', () => {
  const s = importMarkdown('甲'); const id = s.blocks[0]!.id;
  const b = replaceBlock(s, id, 1, '甲', '乙');
  const a = replaceBlock(b, id, 2, '乙', '甲');
  expectCode(() => replaceBlock(a, id, 1, '甲', '丙'), 'CHANGE_CONFLICT');
});
test('UTF-8 byte limits are enforced', () => {
  expectCode(() => importMarkdown('x'.repeat(MAX_DOCUMENT_BYTES + 1)), 'INVALID_INPUT');
  expectCode(() => importMarkdown('字'.repeat(700_000)), 'INVALID_INPUT');
});
test('unpaired surrogates cannot be silently damaged by UTF-8 encoding', () => {
  expectCode(() => validateText('\ud800'), 'INVALID_INPUT');
  expectCode(() => validateText('\udc00'), 'INVALID_INPUT');
  validateText('😀');
});
test('malformed snapshot and duplicate IDs are refused', () => {
  const s = importMarkdown('甲');
  expectCode(() => validateSnapshot({ blocks: [s.blocks[0], s.blocks[0]] }), 'INVALID_INPUT');
  expectCode(() => validateSnapshot({ blocks: [] }), 'INVALID_INPUT');
  expectCode(() => parseSnapshot('{oops'), 'CORRUPT_DATA');
});
test('invalid edit batches are rejected at runtime, not just by TypeScript', () => {
  const edit = { blockId: 'blk', before: 'a', after: 'b', summary: 'edit' };
  expectCode(() => validateEdits([edit, edit]), 'INVALID_INPUT');
  expectCode(() => validateEdits([{ ...edit, after: 'a' }]), 'INVALID_INPUT');
  expectCode(() => validateEdits([{ ...edit, after: 42 }]), 'INVALID_INPUT');
  expectCode(() => validateEdits(null), 'INVALID_INPUT');
});
test('inserted blank lines do not silently re-identify blocks', () => {
  const s = importMarkdown('甲\n\n乙'); const id = s.blocks[0]!.id;
  const next = replaceBlock(s, id, 1, '甲', '一\n\n二');
  assert.equal(next.blocks.length, 2); assert.equal(next.blocks[0]?.id, id);
  assert.equal(renderMarkdown(next), '一\n\n二\n\n乙');
});
