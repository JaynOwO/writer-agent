// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace } from '@writer-agent/storage';
import { DEFAULT_WORKFLOW_BUDGET } from '@writer-agent/core';
import type { WorkflowConfig, WorkflowRequest, NavigationRequest, NavigationOutput } from '@writer-agent/core';
import { ConnectionStore, attachPreset, presetRef } from './application/presets.js';
import type { SecretStore } from './application/secrets.js';
import { presetDependencies } from './application/connections-runtime.js';
import { localDiagnostics, recoveryView } from './application/diagnostics.js';
import { reportSnapshot, writeReadingReport } from './application/report.js';
import { executeWorkflow } from './workflow-runtime.js';
import { extensionWorkflowFixture } from './extensions-demo.js';
import { registerMcp, discoverMcp } from './extensions-command.js';
import { readSkillDirectory } from './skill-import.js';
/** One owned synthetic scenario. This is intentionally NOT a real keyring backend. */
class DemoSecrets implements SecretStore {
    readonly backend = 'demo-memory-not-operating-system';
    private readonly values = new Map<string, string>();
    async read(id: string) { return this.values.get(id) ?? null; }
    async write(id: string, value: string) { this.values.set(id, value); }
    async remove(id: string) { return this.values.delete(id); }
}
export function navigationDemoFixture(r: NavigationRequest): NavigationOutput {
    const s = r.sources[0];
    assert.ok(s);
    const quote = s.text.slice(0, Math.min(s.text.length, 1000));
    return { protocolVersion: 1, task: 'navigation-summary', runId: r.runId, requestId: r.requestId, kind: 'derived-navigation-not-evidence', notes: [{ summary: 'Synthetic navigation: inspect the selected original text for small samples and contrary cold-room results.', sourceQuotes: [{ itemIndex: 0, start: 0, end: quote.length, quote }] }], omissions: ['Only the explicitly selected passages are represented; this is not a factual assessment.'] };
}
/** Real SDK/client pipes and HTTP, with fixtures; no OS key writes or public API calls. */
export async function productDemo(): Promise<{
    root: string;
    runId: string;
    documentId: string;
    reports: string[];
}> {
    const base = mkdtempSync(join(tmpdir(), 'siglum-product-demo-')), fakeSecrets = new DemoSecrets();
    let store = new ConnectionStore(join(base, 'isolated-settings'), fakeSecrets), w = Workspace.create(join(base, 'writing'), 'Product demonstration');
    const syntheticCredential = 'SYNTHETIC_DEMO_KEY_NOT_A_SERVICE_CREDENTIAL';
    let navigationCalls = 0, modelCalls = 0;
    const server = createServer(async (req, res) => {
        try {
            assert.equal(req.headers.authorization, 'Bearer ' + syntheticCredential);
            const chunks: Buffer[] = [];
            let bytes = 0;
            for await (const chunk of req) {
                bytes += chunk.length;
                if (bytes > 6000000)
                    throw Error('fixture limit');
                chunks.push(Buffer.from(chunk));
            }
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
                messages: {
                    content: string;
                }[];
            };
            const r = JSON.parse(body.messages[1]!.content) as WorkflowRequest | NavigationRequest;
            modelCalls++;
            const out = r.task === 'navigation-summary' ? (navigationCalls++, navigationDemoFixture(r)) : extensionWorkflowFixture(r);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(out) }, done: true, done_reason: 'stop', prompt_eval_count: 10, eval_count: 10 }));
        }
        catch {
            res.writeHead(500);
            res.end();
        }
    });
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const a = server.address();
        assert.ok(a && typeof a !== 'string');
        assert.equal(localDiagnostics(w, store).results.find(r => r.name === 'os-credential-store')!.status, 'not-run');
        const fixture = fileURLToPath(new URL('../../../examples/mcp/fictional-server.mjs', import.meta.url));
        const skill = w.extensions.importSkill(readSkillDirectory(fileURLToPath(new URL('../../../examples/skills/source-check', import.meta.url))));
        w.extensions.setSkill(skill.id, true);
        const mcp = await registerMcp(w, { name: 'Owned synthetic service; not third-party certification', transport: 'stdio', protocol: '2026-07-28', command: process.execPath, args: [fixture], cwd: dirname(fixture), env: [], timeoutMs: 5000 });
        w.extensions.setTrust(mcp.id, true);
        const catalog = await discoverMcp(w, mcp.id);
        const config: WorkflowConfig = { template: 'new-article', title: 'Synthetic battery exercise', goal: 'Describe sample limits and contrary observations carefully.', publicBrief: '', language: 'en', research: 'selected', documentId: null, changeIds: [], selection: {}, profileId: null, intent: null, memoryOptions: { language: 'en' }, model: { provider: 'ollama', model: 'product-fixture', baseURL: `http://127.0.0.1:${a.port}`, apiKeyEnv: null, allowRemote: false, responseFormat: 'json-schema', tokenParameter: 'max_completion_tokens', timeoutMs: 5000, maxOutputTokens: 4096 }, searchKeyEnv: 'TAVILY_API_KEY', domains: [], timeRange: null, autoRevision: false, budget: { ...DEFAULT_WORKFLOW_BUDGET }, navigationSummary: true, extensions: { skills: [{ id: skill.id, references: [] }], calls: [{ serverId: mcp.id, catalogId: catalog.id, kind: 'tool', name: 'lookup', arguments: { query: 'battery limitations' }, permission: 'read' }], chapterDrafting: true } };
        const preset = await store.save('Demo connection', { kind: 'model', model: config.model }, 'system', syntheticCredential);
        let run = w.workflows.create(config);
        attachPreset(w, run.id, preset, store);
        const id = run.id;
        const authorize = () => { const p = w.workflows.preview(id); w.workflows.authorize(id, p.fingerprint, p.limits); };
        authorize();
        run = await executeWorkflow(w, id, presetDependencies(w, w.workflows.run(id), store));
        assert.equal(run.state, 'waiting-approval');
        assert.ok(run.outlineId);
        assert.equal(navigationCalls, 1);
        assert.equal(w.listDocuments().length, 0);
        const outline = run.outlineId, root = w.root;
        w.close();
        w = Workspace.open(root);
        store = new ConnectionStore(join(base, 'isolated-settings'), fakeSecrets);
        assert.equal(recoveryView(w, id).stage, 'research');
        w.workflows.chooseOutline(id, outline);
        authorize();
        run = await executeWorkflow(w, id, presetDependencies(w, w.workflows.run(id), store));
        assert.equal(navigationCalls, 1);
        assert.equal(run.candidateIds.length, 1);
        assert.equal(w.listDocuments().length, 0);
        const reports = ['zh-CN', 'en'].map(language => { const path = join(base, `reading-${language}.html`); writeReadingReport(path, reportSnapshot(w, { runId: id, language: language as 'zh-CN' | 'en', includeText: true, includeSources: true, includeGuidance: true })); assert.ok(!readFileSync(path, 'utf8').includes(syntheticCredential)); return path; });
        const documentId = w.workflows.adopt(id, run.candidateIds[0]!);
        assert.equal(w.workflows.adopt(id, run.candidateIds[0]!), documentId);
        assert.equal(w.listDocuments().length, 1);
        assert.ok(!readFileSync(store.path).includes(Buffer.from(syntheticCredential)));
        await store.remove(presetRef(preset));
        const result = { root, runId: id, documentId, reports };
        console.log(JSON.stringify({ ...result, fixture: true, realInference: false, realWebSearch: false, realOsCredentialTest: false, thirdPartyInteropTested: false, sdk: '2.0.0', navigationCalls, modelCalls }, null, 2));
        console.log('PRODUCT_DEMO_OK');
        return result;
    }
    finally {
        w.close();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}
