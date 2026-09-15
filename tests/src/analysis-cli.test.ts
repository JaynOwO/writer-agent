// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { fixture, propose, temporary } from './helpers.js';
import { candidate, parseAnalysisArgs, reviewFixture, providerInfo } from './analysis-helpers.js';
import { fakeServer, json, ollamaEnvelope } from './provider-helpers.js';
import type { AnalysisRequest } from '@writer-agent/core';
const cli = fileURLToPath(new URL('../../apps/cli/dist/index.js', import.meta.url));
function run(args: string[]) { return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 20000 }); }
function ok(args: string[]) { const r = run(args); assert.equal(r.status, 0, r.stderr + '\n' + r.stdout); return r.stdout; }
async function asyncRun(args: string[]) { return new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
}>((resolve, reject) => { const p = spawn(process.execPath, [cli, ...args]); let stdout = '', stderr = ''; p.stdout.on('data', b => stdout += String(b)); p.stderr.on('data', b => stderr += String(b)); p.once('error', reject); p.once('close', code => resolve({ code, stdout, stderr })); }); }
const providerFlags = ['--provider', 'ollama', '--model', 'test', '--instruction', 'Review'];
test('claim/review help is offline and flags do not make implicit paid calls', () => { assert.match(ok(['claim', 'help']), /assessments, not fact/); assert.match(ok(['review', 'help']), /--send/); });
for (const flags of [[], ['--blocks', 'a', '--document-scope'], ['--changes', 'x'], ['--document-scope', '--document-scope'], ['--blocks', 'a,a'], ['--blocks', 'a', '--api-key', 'SECRET']])
    test('claim extraction CLI rejects ambiguous or wrong flags ' + flags.join(' '), () => { assert.throws(() => parseAnalysisArgs(['w', 'doc', ...providerFlags, ...flags], 'claim-extraction')); });
for (const flags of [[], ['--blocks', 'a'], ['--changes', 'a', '--changes', 'b'], ['--changes', 'a', '--unknown']])
    test('review CLI rejects wrong flags ' + flags.join(' '), () => { assert.throws(() => parseAnalysisArgs(['w', 'doc', ...providerFlags, ...flags], 'semantic-review')); });
test('claim CLI adds/confirms/corrects annotations and preserves text history', t => { const { workspace: w, document: d, dir } = fixture(t), file = join(dir, 'annotation.json'); writeFileSync(file, JSON.stringify(candidate(w.currentRevision(d.id).snapshot))); const c = JSON.parse(ok(['claim', 'add', w.root, d.id, file])) as {
    id: string;
}; ok(['claim', 'important', w.root, c.id, 'Preserve this claim']); assert.equal(JSON.parse(ok(['claim', 'list', w.root, d.id]))[0].important, true); ok(['claim', 'correct', w.root, c.id, file, 'Rephrase annotation']); assert.equal(w.analysis.list(d.id).length, 2); assert.equal(w.history(d.id).length, 1); });
test('preview exposes scope and destination but performs no HTTP or ledger write', async (t) => { const { workspace: w, document: d } = fixture(t), c = propose(w, d.id, 0, '成立。'), s = await fakeServer(t, (_h, res) => json(res, {})); const response = await asyncRun(['review', 'run', w.root, d.id, '--changes', c.id, ...providerFlags, '--base-url', s.base]); assert.equal(response.code, 0, response.stderr); const view = JSON.parse(response.stdout); assert.equal(view.sent, false); assert.equal(view.scope, 'blocks'); assert.equal(s.requests.length, 0); assert.equal(w.analysis.runs(d.id).length, 0); });
test('CLI exact source-free review send -> show -> feedback -> export preserves manuscript', async (t) => {
    const { workspace: w, document: d, dir } = fixture(t), c = propose(w, d.id, 0, '成立。');
    const s = await fakeServer(t, (hit, res) => { const user = (hit.body.messages as {
        role: string;
        content: string;
    }[]).find(m => m.role === 'user')!; json(res, ollamaEnvelope(reviewFixture(JSON.parse(user.content) as AnalysisRequest))); });
    const response = await asyncRun(['review', 'run', w.root, d.id, '--changes', c.id, ...providerFlags, '--base-url', s.base, '--send']);
    assert.equal(response.code, 0, response.stderr);
    const view = JSON.parse(response.stdout) as {
        id: string;
    };
    assert.equal(s.requests.length, 1);
    assert.equal(w.getChange(c.id).status, 'pending');
    ok(['review', 'decide', w.root, view.id, 'f1', 'disagree', 'Not my meaning']);
    const report = JSON.parse(ok(['review', 'show', w.root, view.id]));
    assert.equal(report.feedback.length, 1);
    assert.equal(report.freshness, 'current');
    const file = join(dir, 'report.json');
    ok(['review', 'export', w.root, view.id, file]);
    const original = readFileSync(file, 'utf8');
    assert.notEqual(run(['review', 'export', w.root, view.id, file]).status, 0);
    assert.equal(readFileSync(file, 'utf8'), original);
    assert.equal(w.history(d.id).length, 1);
});
test('CLI claim extract sends only explicit scope and creates candidate occurrences', async (t) => { const { workspace: w, document: d } = fixture(t), s = await fakeServer(t, (hit, res) => { const user = (hit.body.messages as {
    role: string;
    content: string;
}[])[1]!; json(res, ollamaEnvelope(reviewFixture(JSON.parse(user.content) as AnalysisRequest))); }); const b = w.currentRevision(d.id).snapshot.blocks[0]!; const r = await asyncRun(['claim', 'extract', w.root, d.id, '--blocks', b.id, ...providerFlags, '--base-url', s.base, '--send']); assert.equal(r.code, 0, r.stderr); assert.equal(w.analysis.list(d.id)[0]!.annotation, 'candidate'); assert.equal(w.analysis.list(d.id).length, 1); });
test('malformed manual annotation and feedback mismatches are refused', t => { const { workspace: w, document: d, dir } = fixture(t), file = join(dir, 'bad.json'); writeFileSync(file, '{"kind":"inference","kind":"attributed"}'); assert.notEqual(run(['claim', 'add', w.root, d.id, file]).status, 0); assert.equal(w.analysis.list(d.id).length, 0); assert.equal(run(['review', 'decide', w.root, 'wrong', 'f', 'agree', 'r']).status, 2); });
test('offline REVIEW_DEMO_OK exercises fixture protocol, author feedback and historical reopening', t => { const temp = temporary(t); const result = spawnSync(process.execPath, [cli, 'demo:review'], { encoding: 'utf8', timeout: 20000, env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp } }); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /REVIEW_DEMO_OK/); assert.match(result.stdout, /"realInference": false/); });
test('report JSON has source/evidence identity, not a source-supported stamp', t => { const { workspace: w, document: d } = fixture(t), c = propose(w, d.id, 0, '成立。'), r = w.analysis.prepare(d.id, 'semantic-review', { instruction: 'Review', changeIds: [c.id] }); const saved = w.analysis.save(r, reviewFixture(r), providerInfo, null, 0); const report = JSON.parse(ok(['review', 'show', w.root, saved.id])); assert.equal(report.interpretation, 'model-assessment-not-verified'); assert.equal(report.usage, null); assert.equal(report.output.assessments[0].relation, 'not-assessed'); });
