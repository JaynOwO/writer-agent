import assert from 'node:assert/strict';
import test from 'node:test';
import { importMarkdown } from '@writer-agent/core';
import { MockModelProvider } from '@writer-agent/models';
const request = (text: string) => ({ documentId: 'doc', baseRevisionId: 'rev', snapshot: importMarkdown(text), instruction: 'Test' });
test('mock returns scoped edits without changing its input', async () => {
  const r = request('原文'); const original = JSON.stringify(r);
  const model = new MockModelProvider([{ before: '原文', after: '新文', summary: '例子' }]);
  const response = await model.propose(r);
  assert.equal(response.edits[0]?.blockId, r.snapshot.blocks[0]?.id);
  assert.equal(response.baseRevisionId, r.baseRevisionId);
  assert.equal(JSON.stringify(r), original);
  assert.equal(response.providerId, 'mock/scripted-v1');
});
test('mock refuses missing or ambiguous whole-block matches', async () => {
  const model = new MockModelProvider([{ before: 'a', after: 'b', summary: 'test' }]);
  await assert.rejects(model.propose(request('c')), /exactly one whole block/);
  await assert.rejects(model.propose(request('a\n\na')), /exactly one whole block/);
});
test('mock respects cancellation', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(new MockModelProvider([]).propose(request('a'), controller.signal), { name: 'AbortError' });
});
test('mock copies constructor fixtures so external mutation does not change behavior', async () => {
  const replacement = { before: 'a', after: 'b', summary: 'test' };
  const model = new MockModelProvider([replacement]); replacement.after = 'changed';
  assert.equal((await model.propose(request('a'))).edits[0]?.after, 'b');
});
