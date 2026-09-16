// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationPacket, validateNavigationOutput, validateNavigationRequest, scopeNavigation, validateWorkflowRequest, stageTasks } from '@writer-agent/core';
import type { NavigationRequest, NavigationOutput } from '@writer-agent/core';
import { OllamaProvider, OpenAICompatibleProvider } from '@writer-agent/models';
import { workflowSetup, modelFixture, grant, executeWorkflow, workflowFixture } from './workflow-helpers.js';
import { fakeServer, json, ollamaEnvelope, chatEnvelope } from './provider-helpers.js';
export function navFixture(r: NavigationRequest): NavigationOutput { const q = r.sources[0]!.text; return { protocolVersion: 1, task: 'navigation-summary', runId: r.runId, requestId: r.requestId, kind: 'derived-navigation-not-evidence', notes: [{ summary: 'This is a fallible navigation note; check original limitations.', sourceQuotes: [{ itemIndex: 0, start: 0, end: q.length, quote: q }] }], omissions: ['Only selected material was supplied.'] }; }
function navRequest(sources: NavigationRequest['sources']): NavigationRequest { return { protocolVersion: 1, task: 'navigation-summary', runId: 'run-test', requestId: 'request-test', question: 'Preserve limitations', language: 'en', sources }; }
for (const language of ['en', 'zh-CN'] as const)
    test(`Navigation exact original quotes survive ${language}/emoji/CRLF`, t => { const { w } = workflowSetup(t); const source = w.sources.add({ kind: 'file', locator: 'unicode.txt', raw: Buffer.from(language === 'en' ? 'Some conditions may differ. 😀\r\nNot a causal result.' : '部分条件可能不同。😀\r\n不是因果结论。'), mediaType: 'text/plain' }), r = { ...navRequest(w.sources.context({ snapshots: [source.snapshot.id] })), language }; const out = navFixture(r); assert.doesNotThrow(() => validateNavigationOutput(out, r)); assert.equal(navigationPacket(out).kind, 'derived-navigation-not-evidence'); });
for (const failure of ['invented-quote', 'wrong-index', 'wrong-run', 'extra-field', 'empty-notes', 'empty-quotes', 'too-many', 'wrong-role', 'negative-offset'] as const)
    test('Invalid navigation summary rejected: ' + failure, t => {
        const { w, source } = workflowSetup(t), r = navRequest(w.sources.context({ snapshots: [source.snapshot.id] })), out = navFixture(r);
        const q = out.notes[0]!.sourceQuotes[0]!;
        if (failure === 'invented-quote')
            Object.assign(q, { quote: 'Invented' });
        else if (failure === 'wrong-index')
            Object.assign(q, { itemIndex: 9 });
        else if (failure === 'wrong-run')
            out.runId = 'other';
        else if (failure === 'extra-field')
            Object.assign(out, { autoAccept: true });
        else if (failure === 'empty-notes')
            out.notes = [];
        else if (failure === 'empty-quotes')
            out.notes[0]!.sourceQuotes = [];
        else if (failure === 'too-many')
            out.notes = Array.from({ length: 21 }, () => out.notes[0]!);
        else if (failure === 'wrong-role')
            Object.assign(out, { kind: 'verified-evidence' });
        else
            Object.assign(q, { start: -1 });
        assert.throws(() => validateNavigationOutput(out, r));
    });
test('Navigation request cannot add credentials, tools or memory to the selected packet', t => { const { w, source } = workflowSetup(t), r = navRequest(w.sources.context({ snapshots: [source.snapshot.id] })); for (const key of ['apiKey', 'tools', 'memory'])
    assert.throws(() => validateNavigationRequest({ ...r, [key]: 'not-authorized' })); });
test('Chapter summary remaps only quotes into the chapter original evidence', t => { const { w, source } = workflowSetup(t), r = navRequest(w.sources.context({ snapshots: [source.snapshot.id] })), packet = navigationPacket(navFixture(r)); assert.equal(scopeNavigation(packet, [1]), undefined); const p = scopeNavigation(packet, [2, 0])!; assert.equal(p.notes[0]!.sourceQuotes[0]!.itemIndex, 1); assert.equal(packet.notes[0]!.sourceQuotes[0]!.itemIndex, 0); });
test('Summary disabled retains old tasks; enabled task appears in exact stage authorization', t => { const { w, run } = workflowSetup(t); assert.equal(stageTasks('research').includes('navigation-summary'), false); assert.equal(w.workflows.preview(run.id).summary.allowedTasks.includes('navigation-summary'), false); w.workflows.refresh(run.id, { ...run.config, navigationSummary: true }); assert.equal(w.workflows.preview(run.id).summary.allowedTasks.includes('navigation-summary'), true); });
test('Disabled summaries do not call the model a second time for navigation', async (t) => { const { w, run } = workflowSetup(t), model = modelFixture(); let calls = 0; model.summarizeNavigation = async (r) => { calls++; return { providerId: model.id, output: navFixture(r), usage: null }; }; grant(w, run.id); await executeWorkflow(w, run.id, { model }); assert.equal(calls, 0); assert.equal(w.workflows.usage(run.id).models, 1); });
test('Summary and original evidence persist, reach outline/compose, and never become a source', async (t) => { const { w, run } = workflowSetup(t, { navigationSummary: true, autoRevision: false }), model = modelFixture(); model.summarizeNavigation = async (r) => ({ providerId: model.id, output: navFixture(r), usage: { inputTokens: 12, outputTokens: 13, totalTokens: 25 } }); grant(w, run.id); const r = await executeWorkflow(w, run.id, { model }); const a = w.workflows.artifact(r.outlineId!).value as {
    request: Parameters<typeof workflowFixture>[0];
}; assert.notEqual(a.request.task, 'query-plan'); if (a.request.task !== 'query-plan') {
    assert.equal(a.request.sources.length, 1);
    assert.equal(a.request.navigation!.kind, 'derived-navigation-not-evidence');
    assert.doesNotThrow(() => validateWorkflowRequest(a.request));
} assert.equal(w.sources.list().length, 1); assert.equal(w.workflows.usage(run.id).models, 2); w.workflows.chooseOutline(run.id, r.outlineId!); grant(w, run.id); await executeWorkflow(w, run.id, { model }); assert.equal(w.listDocuments().length, 1); assert.equal(w.workflows.artifacts(run.id).filter(a => a.type === 'navigation-summary').length, 1); });
test('Confirmed summary still requires original quote data; invalid response saves nothing', async (t) => { const { w, run } = workflowSetup(t, { navigationSummary: true }), model = modelFixture(); model.summarizeNavigation = async (r) => { const output = navFixture(r); Object.assign(output.notes[0]!.sourceQuotes[0]!, { quote: 'fake' }); return { providerId: model.id, output, usage: null }; }; grant(w, run.id); await assert.rejects(executeWorkflow(w, run.id, { model })); assert.equal(w.workflows.artifacts(run.id).length, 0); assert.equal(w.workflows.attempts(run.id).length, 1); });
test('Summary cache is reused after a later outline failure; no invisible repair call', async (t) => { const { w, run } = workflowSetup(t, { navigationSummary: true }), model = modelFixture(); let summaries = 0, outlineCalls = 0; model.summarizeNavigation = async (r) => { summaries++; return { providerId: model.id, output: navFixture(r), usage: null }; }; model.workflowTask = async (r) => { outlineCalls++; if (outlineCalls === 1)
    throw Error('synthetic interruption'); return { providerId: model.id, output: workflowFixture(r), usage: null }; }; grant(w, run.id); await assert.rejects(executeWorkflow(w, run.id, { model })); const a = w.workflows.attempts(run.id).find(a => a.task === 'outline')!; w.workflows.retry(run.id, a.id, true); await executeWorkflow(w, run.id, { model }); assert.equal(summaries, 1); assert.equal(outlineCalls, 2); assert.equal(w.workflows.usage(run.id).models, 3); });
test('Changing summary setting invalidates old grant, without silently resetting budget', async (t) => { const { w, run } = workflowSetup(t), model = modelFixture(); grant(w, run.id); await executeWorkflow(w, run.id, { model }); const spent = w.workflows.usage(run.id).models; const r = w.workflows.refresh(run.id, { ...run.config, navigationSummary: true }); assert.equal(r.grantId, null); assert.equal(w.workflows.usage(run.id).models, spent); await assert.rejects(executeWorkflow(w, run.id, { model })); });
test('Changed author input during summary inference cannot save a current summary', async (t) => { const { w, run } = workflowSetup(t, { navigationSummary: true }), model = modelFixture(); model.summarizeNavigation = async (r) => { w.workflows.pause(run.id); return { providerId: model.id, output: navFixture(r), usage: null }; }; grant(w, run.id); await assert.rejects(executeWorkflow(w, run.id, { model })); assert.equal(w.workflows.artifacts(run.id).length, 0); });
for (const kind of ['ollama', 'openai'] as const)
    test(`Real ${kind} HTTP adapter sends structured navigation task, no tool handles`, async (t) => { const { w, source } = workflowSetup(t), r = navRequest(w.sources.context({ snapshots: [source.snapshot.id] })); const f = await fakeServer(t, (req, res) => { const ms = req.body.messages as {
        content: string;
    }[], sent = JSON.parse(ms[1]!.content) as NavigationRequest; assert.equal(sent.task, 'navigation-summary'); assert.equal(Object.hasOwn(sent, 'db'), false); json(res, kind === 'ollama' ? ollamaEnvelope(navFixture(sent)) : chatEnvelope(navFixture(sent))); }); const p = kind === 'ollama' ? new OllamaProvider({ model: 'fixture', baseURL: f.base }) : new OpenAICompatibleProvider({ model: 'fixture', baseURL: f.base }); const result = await p.summarizeNavigation(r); assert.equal(result.output.kind, 'derived-navigation-not-evidence'); assert.equal(f.requests.length, 1); });
