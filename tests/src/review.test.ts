import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewTextChange } from '@writer-agent/core';
import type { ReviewHint } from '@writer-agent/core';
const cases: {name: string; before: string; after: string; expected: ReviewHint['code'][]}[] = [
  { name: 'Chinese qualification removed', before: '可能改变结果。', after: '改变结果。', expected: ['certainty-increase'] },
  { name: 'English qualification removed', before: 'It might change.', after: 'It changes.', expected: ['certainty-increase'] },
  { name: 'Chinese attribution removed', before: '研究人员认为结果不错。', after: '结果不错。', expected: ['attribution-removed'] },
  { name: 'English attribution removed', before: 'According to the report, sales rose.', after: 'Sales rose.', expected: ['attribution-removed'] },
  { name: 'Chinese causality added', before: '两个因素相关。', after: '一个因素导致另一个。', expected: ['causality-added'] },
  { name: 'English causality added', before: 'The events correlate.', after: 'One caused the other.', expected: ['causality-added'] },
  { name: 'Chinese scope broadened', before: '部分岗位变化。', after: '岗位变化。', expected: ['scope-widened'] },
  { name: 'English scope broadened', before: 'Some teams improved.', after: 'Teams improved.', expected: ['scope-widened'] },
  { name: 'stylistic change has no known flags', before: '这是一段较为冗长的说明。', after: '这是一段说明。', expected: [] },
  { name: 'qualification retained', before: '可能变化。', after: '结果可能变化。', expected: [] },
  { name: 'all four prototype flags', before: '研究人员认为，新工具可能影响部分岗位。', after: '新工具导致岗位消失。', expected: ['certainty-increase','attribution-removed','causality-added','scope-widened'] },
];
for (const item of cases) test(`lexical rule fixture: ${item.name}`, () => {
  const hints = reviewTextChange(item.before, item.after);
  assert.deepEqual(hints.map(h => h.code).sort(), item.expected.sort());
  assert.ok(hints.every(h => h.detector === 'lexical-v1' && !Object.hasOwn(h, 'confidence')));
});
test('documented limitation: unrelated retained qualifier can hide a lost qualifier', () => {
  assert.deepEqual(reviewTextChange('甲可能成立，乙可能失败。', '甲成立，乙可能失败。'), []);
});
test('documented limitation: no implication of factual verification', () => {
  assert.deepEqual(reviewTextChange('天空是蓝色的。', '天空是绿色的。'), []);
});
