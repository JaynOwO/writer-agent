// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { Workspace } from '@writer-agent/storage';
import { fixture, propose, expectCode } from './helpers.js';
import { candidate, reviewFixture, providerInfo, scripted, runAnalysis } from './analysis-helpers.js';
function setup(t: Parameters<typeof fixture>[0]) { const { workspace: w, document: d, dir } = fixture(t); const c = propose(w, d.id, 0, '甲成立。'); const req = w.analysis.prepare(d.id, 'semantic-review', { instruction: 'Review only', changeIds: [c.id] }); return { w, d, dir, c, req }; }
test('manual occurrence pins exact revision/offset/hash without changing text', t => { const { w, d } = setup(t), rev = w.currentRevision(d.id); const c = w.analysis.add(d.id, candidate(rev.snapshot)); assert.equal(c.revisionId, rev.id); assert.equal(c.anchors[0]!.blockVersion, 1); assert.equal(w.history(d.id).length, 1); assert.equal(w.analysis.list(d.id)[0]!.annotation, 'confirmed'); assert.equal(w.analysis.list(d.id)[0]!.truth, 'not-certified'); });
test('manual explicit second occurrence can reuse claim ID only within same document', t => { const { w, d } = setup(t), r = w.currentRevision(d.id), a = w.analysis.add(d.id, candidate(r.snapshot)); const b = w.analysis.add(d.id, candidate(r.snapshot, 1), a.claimId); assert.equal(a.claimId, b.claimId); const other = w.createDocument('other', '另一稿。'); expectCode(() => w.analysis.add(other.id, candidate(w.currentRevision(other.id).snapshot), a.claimId), 'INVALID_INPUT'); });
test('extraction candidates and completed run persist atomically and begin unconfirmed', async (t) => { const { w, d } = setup(t), request = w.analysis.prepare(d.id, 'claim-extraction', { instruction: 'Extract', documentScope: true }); const run = await runAnalysis(w, request, scripted()); assert.equal(run.status, 'completed'); assert.equal(w.analysis.list(d.id)[0]!.annotation, 'candidate'); assert.equal(w.analysis.list(d.id)[0]!.runId, run.id); assert.equal(w.history(d.id).length, 1); });
test('candidates must be confirmed before becoming explicit important constraints', async (t) => {
    const { w, d } = setup(t);
    await runAnalysis(w, w.analysis.prepare(d.id, 'claim-extraction', { instruction: 'Extract', documentScope: true }), scripted());
    const c = w.analysis.list(d.id)[0]!;
    expectCode(() => w.analysis.decide(c.id, 'important', 'keep'), 'INVALID_TRANSITION');
    w.analysis.decide(c.id, 'confirm', 'annotation is accurate, truth not assessed');
    w.analysis.decide(c.id, 'important', 'keep uncertainty');
    assert.equal(w.analysis.list(d.id)[0]!.important, true);
});
test('correction appends replacement occurrence and supersedes old annotation only', t => { const { w, d } = setup(t), c = w.analysis.add(d.id, candidate(w.currentRevision(d.id).snapshot)); const correction = w.analysis.decide(c.id, 'correct', 'classification fix', { ...candidate(w.currentRevision(d.id).snapshot), kind: 'attributed' }); assert.ok(correction.replacementOccurrenceId); const all = w.analysis.list(d.id); assert.equal(all[0]!.annotation, 'superseded'); assert.equal(all[1]!.claimId, c.claimId); assert.equal(all[1]!.kind, 'attributed'); assert.equal(w.history(d.id).length, 1); });
test('important constraints outside inspected scope are disclosed, not invented into context', t => { const { w, d, c } = setup(t), a = w.analysis.add(d.id, candidate(w.currentRevision(d.id).snapshot, 1)); w.analysis.decide(a.id, 'important', 'Keep'); const r = w.analysis.prepare(d.id, 'semantic-review', { instruction: 'Review', changeIds: [c.id] }); assert.equal(r.protectedClaims.length, 0); assert.deepEqual(r.excludedProtectedClaimIds, [a.claimId]); });
test('full scope includes current confirmed protected claim without silently choosing sources', t => { const { w, d, c } = setup(t), a = w.analysis.add(d.id, candidate(w.currentRevision(d.id).snapshot, 1)); w.analysis.decide(a.id, 'important', 'Keep'); const r = w.analysis.prepare(d.id, 'semantic-review', { instruction: 'Review', changeIds: [c.id], documentScope: true }); assert.equal(r.protectedClaims[0]!.claimId, a.claimId); assert.deepEqual(r.sources, []); });
test('atomic extraction failure rolls back run and all candidate/claim rows', t => { const { w, d } = setup(t), r = w.analysis.prepare(d.id, 'claim-extraction', { instruction: 'Extract', documentScope: true }); const db = new DatabaseSync(join(w.root, '.writer/workspace.sqlite')); db.exec("CREATE TRIGGER fail_analysis BEFORE INSERT ON claim_occurrences BEGIN SELECT RAISE(ABORT,'injected'); END"); db.close(); assert.throws(() => w.analysis.save(r, reviewFixture(r), providerInfo, null, 10), /injected/); assert.equal(w.analysis.runs(d.id).length, 0); assert.equal(w.analysis.list(d.id).length, 0); });
test('semantic report, feedback, manual annotations and source assessments survive reopening', t => { const { w, d, req } = setup(t); const run = w.analysis.save(req, reviewFixture(req), providerInfo, null, 10); w.analysis.feedback(run.id, 'f1', 'disagree', 'Not my intention'); w.close(); const again = Workspace.open(w.root); try {
    const report = again.analysis.report(run.id);
    assert.equal(report.feedback[0]!.reason, 'Not my intention');
    assert.equal(report.freshness, 'current');
    assert.equal(report.usage, null);
    assert.equal(again.history(d.id).length, 1);
}
finally {
    again.close();
} });
test('feedback does not accept/reject pending changes and correction is separate history', t => { const { w, d, c, req } = setup(t); const run = w.analysis.save(req, reviewFixture(req), providerInfo, null, 10); w.analysis.feedback(run.id, 'f1', 'correct', 'Wrong scope', 'Only one claim changed.'); assert.equal(w.getChange(c.id).status, 'pending'); assert.equal(w.history(d.id).length, 1); assert.equal(w.analysis.report(run.id).feedback[0]!.correction, 'Only one claim changed.'); });
test('feedback cannot address a finding in a different report', t => { const { w, req } = setup(t), run = w.analysis.save(req, reviewFixture(req), providerInfo, null, 0); expectCode(() => w.analysis.feedback(run.id, 'ghost', 'agree', 'reason'), 'NOT_FOUND'); });
test('document changes during inference reject all current analysis data', async (t) => { const { w, d, req } = setup(t); const p = scripted(async (r) => { const c = propose(w, d.id, 1, 'concurrent change'); w.accept(c.id); return { providerId: providerInfo.providerId, output: reviewFixture(r), usage: null }; }); await assert.rejects(runAnalysis(w, req, p), { code: 'STALE_REVISION' }); assert.equal(w.analysis.runs(d.id).length, 0); });
test('pending change rejection during inference is detected even without head change', async (t) => { const { w, d, c, req } = setup(t); const p = scripted(async (r) => { w.reject(c.id); return { providerId: providerInfo.providerId, output: reviewFixture(r), usage: null }; }); await assert.rejects(runAnalysis(w, req, p), { code: 'STALE_REVISION' }); assert.equal(w.analysis.runs(d.id).length, 0); });
test('annotation decisions changing during inference make captured constraints stale', async (t) => { const { w, d, c } = setup(t), o = w.analysis.add(d.id, candidate(w.currentRevision(d.id).snapshot)); const req = w.analysis.prepare(d.id, 'semantic-review', { instruction: 'Review', changeIds: [c.id] }); const p = scripted(async (r) => { w.analysis.decide(o.id, 'important', 'new instruction'); return { providerId: providerInfo.providerId, output: reviewFixture(r), usage: null }; }); await assert.rejects(runAnalysis(w, req, p), { code: 'STALE_REVISION' }); });
test('no database transaction held over model wait: second connection can write', async (t) => {
    const { w, d, req } = setup(t);
    const other = Workspace.open(w.root);
    try {
        const p = scripted(async (r) => {
            other.createDocument('other doc', 'data');
            return { providerId: providerInfo.providerId, output: reviewFixture(r), usage: null };
        });
        const report = await runAnalysis(w, req, p);
        assert.equal(report.freshness, 'current');
        assert.equal(w.listDocuments().length, 2);
        assert.equal(w.history(d.id).length, 1);
    }
    finally {
        other.close();
    }
});
test('later same-text/new-revision leaves old report visibly historical', t => { const { w, d, c, req } = setup(t), run = w.analysis.save(req, reviewFixture(req), providerInfo, null, 0); w.accept(c.id); w.revert(c.id); assert.equal(w.analysis.report(run.id).freshness, 'stale'); assert.equal(w.analysis.run(run.id).baseRevisionId, d.headRevisionId); w.analysis.feedback(run.id, 'f1', 'needs-review', 'Historical feedback is version-pinned'); assert.equal(w.analysis.report(run.id).feedback[0]!.documentRevisionAtDecision, w.currentRevision(d.id).id); });
test('independent block acceptance/revert remains intact with a historical review', t => { const { w, d, c, req } = setup(t), other = propose(w, d.id, 1, 'Independent change'); const run = w.analysis.save(req, reviewFixture(req), providerInfo, null, 0); w.accept(c.id); w.accept(other.id); w.revert(c.id); assert.match(w.markdown(d.id), /Independent change/); assert.equal(w.analysis.report(run.id).freshness, 'stale'); });
test('source refresh appends material without making an old pinned-source report current to new evidence', t => { const { w, d, c } = setup(t), source = w.sources.add({ kind: 'file', locator: 'fiction.txt', mediaType: 'text/plain', raw: Buffer.from('original material') }); const req = w.analysis.prepare(d.id, 'semantic-review', { instruction: 'Review', changeIds: [c.id], selection: { snapshots: [source.snapshot.id] } }); const run = w.analysis.save(req, reviewFixture(req), providerInfo, null, 0); w.sources.add({ kind: 'file', locator: 'fiction.txt', sourceId: source.source.id, mediaType: 'text/plain', raw: Buffer.from('refreshed material') }); assert.equal(w.analysis.report(run.id).freshness, 'current'); assert.equal(w.analysis.run(run.id).request.sources[0]!.text, 'original material'); });
test('manual selected-source assessment supports and conflicts are separately preserved, never truth-voted', t => { const { w, d } = setup(t), o = w.analysis.add(d.id, candidate(w.currentRevision(d.id).snapshot)), s = w.sources.add({ kind: 'file', locator: 'x.txt', mediaType: 'text/plain', raw: Buffer.from('selected text') }); const q = { itemIndex: 0, start: 0, end: 8, quote: 'selected' }; for (const relation of ['supports', 'contradicts'] as const)
    w.analysis.assess(o.id, { snapshots: [s.snapshot.id] }, relation, [q], 'Human interpretation'); const all = w.analysis.evidence(o.id); assert.equal(all.length, 2); assert.equal(all[0]!.truth, 'not-certified'); });
test('evidence absence remains not-assessed and wrong quotations never save a partial assessment', t => { const { w, d } = setup(t), o = w.analysis.add(d.id, candidate(w.currentRevision(d.id).snapshot)); expectCode(() => w.analysis.assess(o.id, {}, 'insufficient', [], 'Cannot tell'), 'INVALID_INPUT'); w.analysis.assess(o.id, {}, 'not-assessed', [], 'No material chosen'); assert.equal(w.analysis.evidence(o.id).length, 1); });
test('source notes and unselected materials are absent from model packet', async (t) => { const { w, d, req } = setup(t); const source = w.sources.add({ kind: 'file', locator: 'secret.txt', mediaType: 'text/plain', raw: Buffer.from('UNSELECTED_PRIVATE_MATERIAL') }); w.sources.note(source.snapshot.id, 'PRIVATE_RESEARCH_NOTE'); let capture = ''; const p = scripted(async (r) => { capture = JSON.stringify(r); assert.equal(Object.hasOwn(r, 'db'), false); return { providerId: providerInfo.providerId, output: reviewFixture(r), usage: null }; }); await runAnalysis(w, req, p); assert.doesNotMatch(capture, /UNSELECTED_PRIVATE_MATERIAL|PRIVATE_RESEARCH_NOTE/); assert.equal(w.history(d.id).length, 1); });
test('custom provider mutation cannot change host baseline or escape selected scope', async (t) => { const { w, d, req } = setup(t); const p = scripted(async (r) => { (r.before.blocks[0] as {
    text: string;
}).text = 'MUTATED_MODEL_INPUT'; return { providerId: providerInfo.providerId, output: reviewFixture(r), usage: null }; }); await assert.rejects(runAnalysis(w, req, p), { code: 'PROVIDER_INVALID_ANALYSIS' }); assert.equal(w.analysis.runs(d.id).length, 0); assert.match(w.markdown(d.id), /可能/); });
test('a forged host input cannot be persisted as analysis of a real revision', t => { const { w, req } = setup(t); const forged = structuredClone(req); (forged.before.blocks[0] as {
    text: string;
}).text = 'forged original'; expectCode(() => w.analysis.save(forged, reviewFixture(forged), providerInfo, null, 0), 'STALE_REVISION'); });
test('analysis tables are append-only and integrity hashes detect accidental corruption', t => {
    const { w, req } = setup(t), run = w.analysis.save(req, reviewFixture(req), providerInfo, null, 0), db = new DatabaseSync(join(w.root, '.writer/workspace.sqlite'));
    try {
        assert.throws(() => db.exec('DELETE FROM analysis_runs'), /append-only/);
        assert.throws(() => db.exec("UPDATE analysis_runs SET payload='{}'"), /append-only/);
        db.exec('DROP TRIGGER analysis_runs_no_update');
        db.prepare("UPDATE analysis_runs SET payload='{}' WHERE id=?").run(run.id);
        expectCode(() => w.analysis.run(run.id), 'CORRUPT_DATA');
    }
    finally {
        db.close();
    }
});
test('provider metadata cannot smuggle a key field or credential-bearing URL into workspace', t => { const { w, req } = setup(t); for (const info of [{ ...providerInfo, apiKey: 'NOT_REAL_SECRET' }, { ...providerInfo, endpoint: 'https://user:password@example.test/v1' }])
    assert.throws(() => w.analysis.save(req, reviewFixture(req), info, null, 0)); });
test('cancelled and invalid custom providers save nothing', async (t) => { const { w, d, req } = setup(t); const ctrl = new AbortController(); ctrl.abort(); await assert.rejects(runAnalysis(w, req, scripted(), ctrl.signal), { code: 'PROVIDER_CANCELLED' }); await assert.rejects(runAnalysis(w, req, scripted(async () => ({ providerId: 'wrong', output: {}, usage: null }))), { code: 'PROVIDER_INVALID_ANALYSIS' }); assert.equal(w.analysis.runs(d.id).length, 0); });
test('scope needs explicit extraction selection and validates compatible change batches', t => { const { w, d, c } = setup(t); for (const options of [{ instruction: 'x' }, { instruction: 'x', documentScope: true, blockIds: ['x'] }, { instruction: 'x', blockIds: ['missing'] }])
    assert.throws(() => w.analysis.prepare(d.id, 'claim-extraction', options)); assert.throws(() => w.analysis.prepare(d.id, 'semantic-review', { instruction: 'x', changeIds: [c.id, c.id] })); });
test('model review itself never adds actual proposed-after occurrences to the confirmed ledger', t => { const { w, d, req } = setup(t); w.analysis.save(req, reviewFixture(req), providerInfo, null, 0); assert.equal(w.analysis.list(d.id).length, 0); });
test('multiple current occurrences of one important claim remain visible in review scope', t => { const { w, d, c } = setup(t), r = w.currentRevision(d.id), a = w.analysis.add(d.id, candidate(r.snapshot)), b = w.analysis.add(d.id, candidate(r.snapshot, 1), a.claimId); w.analysis.decide(a.id, 'important', 'Preserve both explicit occurrences'); const request = w.analysis.prepare(d.id, 'semantic-review', { instruction: 'Review', changeIds: [c.id], documentScope: true }); assert.deepEqual(request.protectedClaims.map(c => c.occurrenceId), [a.id, b.id]); });
test('authors can critique mappings and evidence assessments without adopting them into ledger', t => { const { w, d, req } = setup(t), run = w.analysis.save(req, reviewFixture(req), providerInfo, null, 0); w.analysis.feedback(run.id, 'mapping:0', 'disagree', 'They are equivalent'); w.analysis.feedback(run.id, 'assessment:0', 'needs-review', 'Need more materials'); const report = w.analysis.report(run.id); assert.equal(report.feedback.length, 2); assert.equal(report.evidenceView[0]!.relation, 'not-assessed'); assert.equal(w.analysis.list(d.id).length, 0); expectCode(() => w.analysis.feedback(run.id, 'mapping:5', 'agree', 'x'), 'NOT_FOUND'); });
