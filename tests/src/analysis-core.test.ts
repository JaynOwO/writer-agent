// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { pinAnchor, importMarkdown, validateAnchors, captureAnalysisRequest, validateAnalysisOutput, textObservation, validateEvidence, hashBytes, analysisObservations } from '@writer-agent/core';
import type { SemanticOutput } from '@writer-agent/core';
import { parseAnalysisJson } from '@writer-agent/models';
import { analysisRequest, reviewFixture, candidate } from './analysis-helpers.js';
for (const text of ['中文，逗号。', '😀e\u0301\r\n中文', '同一句。同一句。', '\ufeffleading BOM\r\ntrailing '])
    test('exact anchored roundtrip: ' + JSON.stringify(text), () => {
        const s = importMarkdown(text), b = s.blocks[0]!, a = { blockId: b.id, start: 0, end: b.text.length, quote: b.text };
        const pinned = pinAnchor(s, a);
        assert.equal(pinned.quoteHash, hashBytes(b.text));
        assert.equal(pinned.blockVersion, 1);
        assert.equal(pinned.start, 0);
    });
test('repeated wording uses the explicit second occurrence, not first substring', () => { const s = importMarkdown('same same'), b = s.blocks[0]!; assert.equal(pinAnchor(s, { blockId: b.id, start: 5, end: 9, quote: 'same' }).start, 5); });
for (const [start, end, quote] of [[1, 2, '\ude00'], [0, 1, '\ud83d'], [-1, 2, '😀'], [0, 999, '😀'], [0, 0, ''], [0.2, 2, '😀'], [0, 2, 'xx']] as const)
    test(`invalid anchor boundary ${start}:${end} is refused`, () => {
        const s = importMarkdown('😀x');
        assert.throws(() => pinAnchor(s, { blockId: s.blocks[0]!.id, start, end, quote }), { code: 'INVALID_INPUT' });
    });
test('invented block and extra confidence field fail closed', () => { const s = importMarkdown('abc'), b = s.blocks[0]!; for (const a of [{ blockId: 'wrong', start: 0, end: 1, quote: 'a' }, { blockId: b.id, start: 0, end: 1, quote: 'a', confidence: 1 }])
    assert.throws(() => pinAnchor(s, a)); });
test('duplicate exact anchors are refused', () => { const s = importMarkdown('abc'), a = { blockId: s.blocks[0]!.id, start: 0, end: 1, quote: 'a' }; assert.throws(() => validateAnchors([a, a], s)); });
test('exact text replacement observations reconstruct before/after for Unicode fuzz fixtures', () => {
    let seed = 417;
    const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
    const chars = ['a', '中', '😀', '\r\n', 'e\u0301', ' ', '。'];
    const make = () => Array.from({ length: Math.floor(random() * 20) }, () => chars[Math.floor(random() * chars.length)]!).join('');
    for (let i = 0; i < 300; i++) {
        const before = { id: 'b', version: 1, text: make(), separator: '' }, after = { ...before, version: 2, text: make() };
        const o = textObservation(before, after);
        assert.equal(before.text.slice(0, o.start) + o.removed + before.text.slice(o.oldEnd), before.text);
        assert.equal(before.text.slice(0, o.start) + o.inserted + before.text.slice(o.oldEnd), after.text);
        assert.equal(o.beforeHash, hashBytes(before.text));
    }
});
test('input scope cannot falsely claim document coverage', () => { const r = analysisRequest(); assert.throws(() => captureAnalysisRequest({ ...r, documentBlockCount: 3 }), { code: 'INVALID_INPUT' }); });
test('capture makes a deep independent copy', () => { const r = analysisRequest(), c = captureAnalysisRequest(r); (r.before.blocks[0] as {
    text: string;
}).text = 'mutated'; assert.notEqual(c.before.blocks[0]!.text, 'mutated'); });
test('empty successful findings are not a no-change or safe verdict', () => { const r = analysisRequest(), v = reviewFixture(r) as SemanticOutput; assert.doesNotThrow(() => validateAnalysisOutput({ ...v, beforeClaims: [], afterClaims: [], mappings: [], findings: [], assessments: [] }, r)); assert.match(analysisObservations(r).notice, /not factual or semantic/); });
for (const [field, value] of [['documentId', 'wrong'], ['baseRevisionId', 'wrong'], ['protocolVersion', 2], ['task', 'claim-extraction'], ['confidence', .99], ['autoAccept', true], ['sourceSupported', true]] as const)
    test('analysis response rejects wrong/extra ' + field, () => {
        const r = analysisRequest();
        assert.throws(() => validateAnalysisOutput({ ...reviewFixture(r), [field]: value }, r));
    });
for (const [name, mutate] of [
    ['fabricated before quote', (v: any) => v.findings[0].before[0].quote = 'fake'],
    ['fabricated after block', (v: any) => v.findings[0].after[0].blockId = 'fake'],
    ['unknown source', (v: any) => v.findings[0].sourceQuotes = [{ itemIndex: 0, start: 0, end: 1, quote: 'x' }]],
    ['unknown claim', (v: any) => v.findings[0].beforeRefs = ['ghost']],
    ['unknown protected claim', (v: any) => v.findings[0].importantClaimIds = ['ghost']],
    ['duplicate candidate', (v: any) => v.beforeClaims.push(v.beforeClaims[0])],
    ['unmapped candidate', (v: any) => v.mappings = []],
    ['invalid one-to-one mapping', (v: any) => v.mappings[0].afterRefs = []],
    ['duplicate mapping', (v: any) => v.mappings.push(v.mappings[0])],
    ['duplicate finding', (v: any) => v.findings.push(v.findings[0])],
    ['anchorless finding', (v: any) => { v.findings[0].before = []; v.findings[0].after = []; }],
    ['unknown assessment candidate', (v: any) => v.assessments[0].claimRef = 'ghost'],
    ['no source but unsupported verdict', (v: any) => v.assessments[0].relation = 'insufficient'],
    ['unsupported confidence', (v: any) => v.assessments[0].confidence = 1],
    ['overlong explanation', (v: any) => v.findings[0].explanation = 'x'.repeat(2001)],
    ['too many findings', (v: any) => v.findings = Array(101).fill(v.findings[0])],
] as const)
    test('strict semantic validation: ' + name, () => { const r = analysisRequest(), v = structuredClone(reviewFixture(r)); mutate(v); assert.throws(() => validateAnalysisOutput(v, r), { code: 'INVALID_INPUT' }); });
test('separate extraction response produces candidates not approvals', () => { const r = analysisRequest('claim-extraction'), v = reviewFixture(r); assert.doesNotThrow(() => validateAnalysisOutput(v, r)); assert.throws(() => validateAnalysisOutput({ ...v, accepted: true }, r)); });
test('equivalent cross-block paraphrase and relocation is a model mapping, not word removal', () => {
    const r = analysisRequest(), v = structuredClone(reviewFixture(r)) as any;
    (r.after as {
        blocks: any[];
    }).blocks[1].text = '同义表达。';
    v.afterClaims = [candidate(r.after!, 1, 'c2')];
    v.mappings[0].relation = 'equivalent';
    v.findings = [];
    v.assessments = [];
    const result = validateAnalysisOutput(v, r) as SemanticOutput;
    assert.equal(result.mappings[0]!.relation, 'equivalent');
});
test('explicit split and merge mapping shapes work without merging ledger identities', () => {
    const r = analysisRequest(), v = structuredClone(reviewFixture(r)) as any;
    v.afterClaims.push(candidate(r.after!, 1, 'c3'));
    v.mappings[0].afterRefs.push('c3');
    v.mappings[0].relation = 'split';
    assert.doesNotThrow(() => validateAnalysisOutput(v, r));
    v.beforeClaims.push(candidate(r.before, 1, 'c4'));
    v.afterClaims.pop();
    v.mappings[0] = { beforeRefs: ['c1', 'c4'], afterRefs: ['c2'], relation: 'merged', explanation: 'Model opinion' };
    assert.doesNotThrow(() => validateAnalysisOutput(v, r));
});
for (const relation of ['supports', 'partially-supports', 'contradicts', 'insufficient', 'uncertain'] as const)
    test('no source does not permit evidence relation ' + relation, () => { assert.throws(() => validateEvidence(relation, [], [])); });
test('exact source quotes validate selected material, not truth', () => {
    const text = 'Selected passage', s = { sourceId: 'src', snapshotId: 'snap', excerptId: null, locator: 'example.txt', title: null, textHash: hashBytes(text), contentHash: hashBytes(text), startLine: 1, endLine: 1, text };
    const q = { itemIndex: 0, start: 0, end: 8, quote: 'Selected' };
    for (const rel of ['supports', 'partially-supports', 'contradicts'] as const) {
        assert.doesNotThrow(() => validateEvidence(rel, [q], [s]));
        assert.throws(() => validateEvidence(rel, [], [s]));
    }
    assert.throws(() => validateEvidence('supports', [{ ...q, quote: 'invented' }], [s]));
    assert.throws(() => validateEvidence('not-assessed', [q], [s]));
});
for (const text of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"a":{"b":1,"b":2}}', '```json\n{}\n```', '{} tail', '{"x":', '['.repeat(66) + '0' + ']'.repeat(66)])
    test('new task parser refuses duplicate/fenced/malformed/deep JSON ' + text.slice(0, 24), () => { assert.throws(() => parseAnalysisJson(text), { code: 'PROVIDER_BAD_RESPONSE' }); });
test('new task parser accepts unique escaped keys, strings, arrays and scalars in JSON data', () => { for (const text of ['{"a":"escaped \\\" quote","b":[null,1,true,false,{},[]]}', ' {"中":"字"} ', '[]', 'null'])
    assert.deepEqual(parseAnalysisJson(text), JSON.parse(text)); });
test('analysis byte cap rejects oversized content before returning a report', () => { assert.throws(() => parseAnalysisJson(' '.repeat(6000001)), { code: 'PROVIDER_TOO_LARGE' }); });
