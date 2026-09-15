// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const { scoreEvaluation } = await import(new URL('../../scripts/score-review-eval.mjs', import.meta.url).href) as {
    scoreEvaluation: (corpus: unknown, predictions: unknown, options?: {
        allowDraft: boolean;
    }) => Record<string, any>;
};
const corpus = JSON.parse(readFileSync(new URL('../../evaluation/semantic-review-draft.json', import.meta.url), 'utf8')) as {
    cases: {
        id: string;
        language: string;
        labelStatus: string;
        reviewedBy: null;
        expectedLabels: string[];
    }[];
};
test('evaluation draft has 40 Chinese and 40 English cases, all explicitly unreviewed', () => { assert.equal(corpus.cases.length, 80); for (const lang of ['zh-CN', 'en'])
    assert.equal(corpus.cases.filter(c => c.language === lang).length, 40); assert.ok(corpus.cases.every(c => c.labelStatus === 'draft-ai-authored' && c.reviewedBy === null)); assert.equal(new Set(corpus.cases.map(c => c.id)).size, 80); });
test('scorer refuses quality metrics on unreviewed labels without explicit draft flag', () => { assert.throws(() => scoreEvaluation(corpus, []), /not human-reviewed/); const score = scoreEvaluation(corpus, [], { allowDraft: true }); assert.equal(score.qualityClaimAllowed, false); assert.equal(score.missingPredictions, 80); assert.equal(score.quotationValidity, null); assert.equal(score.meanLatencyMs, null); });
test('evaluation scorer separates false alarms, abstentions, missing coverage and quote validity', () => { const score = scoreEvaluation(corpus, [{ id: 'en-01', model: 'synthetic-fixture', labels: ['certainty'], abstain: false, quotationValid: true, latencyMs: 10 }, { id: 'en-02', model: 'synthetic-fixture', labels: ['certainty'], abstain: false, quotationValid: false, latencyMs: 20 }, { id: 'en-03', model: 'synthetic-fixture', labels: [], abstain: true }], { allowDraft: true }); assert.equal(score.perCategory.certainty.precision, .5); assert.equal(score.falseAlarms, 1); assert.equal(score.abstentions, 1); assert.equal(score.coverage, 2 / 80); assert.equal(score.quotationValidity, .5); assert.equal(score.meanLatencyMs, 15); });
test('scorer refuses duplicate predictions and unknown categories', () => { const p = { id: 'en-01', model: 'fixture', labels: ['certainty'], abstain: false }; assert.throws(() => scoreEvaluation(corpus, [p, p], { allowDraft: true })); assert.throws(() => scoreEvaluation(corpus, [{ ...p, labels: ['truth-certified'] }], { allowDraft: true })); });
