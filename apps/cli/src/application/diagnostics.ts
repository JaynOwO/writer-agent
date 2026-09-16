// SPDX-License-Identifier: Apache-2.0
import { platform, arch, release, tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Workspace } from '@writer-agent/storage';
import { workflowHash, validateWorkflowModel } from '@writer-agent/core';
import type { WorkflowConfig } from '@writer-agent/core';
import { TavilySearch, ProviderError, SearchError } from '@writer-agent/models';
import { McpClient, mcpLaunchHash, McpError, MCP_SDK_VERSION } from '../mcp-client.js';
import { executeWorkflow } from '../workflow-runtime.js';
import { ConnectionStore, presetRef, attachPreset } from './presets.js';
import type { ConnectionPreset } from './presets.js';
import { presetDependencies } from './connections-runtime.js';
import { ProductError } from './secrets.js';
export const PRODUCT_VERSION = '0.0.8';
export type CheckStatus = 'passed' | 'failed' | 'not-run' | 'not-configured' | 'unsupported' | 'cancelled' | 'outcome-unknown';
export function safeProductCode(e: unknown): string { const c = e instanceof ProductError || e instanceof ProviderError || e instanceof SearchError || e instanceof McpError ? e.code : (e as {
    code?: unknown;
})?.code; return typeof c === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(c) ? c : 'OPERATION_FAILED'; }
/** Read metadata only: no DNS, key lookup, unlock dialog or service launch. */
export function localDiagnostics(w: Workspace | null, store = new ConnectionStore()) {
    const results: {
        name: string;
        status: CheckStatus;
        detail: unknown;
    }[] = [];
    const require = createRequire(import.meta.url);
    for (const [name, pkg] of [['official-mcp-sdk', '@modelcontextprotocol/client'], ['credential-binding', '@napi-rs/keyring']]) {
        try {
            require.resolve(pkg!);
            results.push({ name: name!, status: 'passed', detail: 'Package entry located only; not a connectivity or credential-store test.' });
        }
        catch {
            results.push({ name: name!, status: 'not-configured', detail: 'Package entry not available.' });
        }
    }
    let presets: ConnectionPreset[] = [];
    try {
        presets = store.list();
        results.push({ name: 'presets', status: 'passed', detail: presets.map(p => ({ id: p.id, version: p.version, kind: p.settings.kind, enabled: p.enabled, credentialMode: p.credential.mode, credentialValue: 'not-read' })) });
    }
    catch (e) {
        results.push({ name: 'presets', status: 'failed', detail: safeProductCode(e) });
    }
    results.push({ name: 'os-credential-store', status: 'not-run', detail: { backend: store.secrets.backend, reason: 'Explicit isolated read/write self-test required.' } });
    if (w) {
        results.push({ name: 'workspace', status: 'passed', detail: { id: w.info().id, schema: w.info().schemaVersion } });
        try {
            results.push({ name: 'tasks', status: 'passed', detail: w.workflows.list().map(r => ({ id: r.id, stage: r.stage, state: r.state, savedCandidates: r.candidateIds.length })) });
        }
        catch (e) {
            results.push({ name: 'tasks', status: 'unsupported', detail: safeProductCode(e) });
        }
    }
    results.push({ name: 'real-model-search-mcp', status: 'not-run', detail: 'Select a bounded test and explicitly authorize its destination and input.' });
    return { format: 1, kind: 'metadata-only-local-check', version: PRODUCT_VERSION, os: platform(), arch: arch(), osRelease: release(), node: process.versions.node, sdk: MCP_SDK_VERSION, generatedAt: new Date().toISOString(), results };
}
/** Local, safe explanation; never supplies executable commands to an HTML report. */
export function recoveryView(w: Workspace, runId: string) {
    const r = w.workflows.run(runId), attempts = w.workflows.attempts(runId), saved = w.workflows.artifacts(runId);
    return { runId, state: r.state, stage: r.stage, generatedAt: new Date().toISOString(), completed: saved.map(a => ({ id: a.id, type: a.type, epoch: a.epoch })), spent: w.workflows.usage(runId), budget: r.config.budget,
        problems: attempts.filter(a => a.status !== 'completed').map(a => ({ id: a.id, task: a.task, status: a.status, code: a.errorCode, possiblyProcessed: ['dispatched', 'outcome-unknown'].includes(a.status), allowedActions: a.status === 'failed' ? ['inspect', 'authorize-explicit-retry'] : a.status === 'outcome-unknown' ? ['inspect', 'acknowledge-possible-duplicate-before-retry'] : a.status === 'dispatched' ? ['stop-or-wait-for-worker', 'recover-after-expiry'] : ['inspect'] })), monetaryCost: 'unknown', backgroundExecution: false };
}
export interface ProbePlan {
    format: 1;
    kind: 'model' | 'search' | 'mcp-discovery' | 'keyring';
    preset: {
        id: string;
        version: string;
    } | null;
    destination: string;
    input: string;
    maxRequests: number;
    timeoutMs: number;
    launchHash: string | null;
    fingerprint: string;
}
export async function prepareProbe(kind: ProbePlan['kind'], store: ConnectionStore, preset?: ConnectionPreset): Promise<ProbePlan> {
    let destination = '', input = '', maxRequests = 1, timeoutMs = 20000, launchHash: string | null = null;
    if (kind === 'keyring') {
        destination = store.secrets.backend;
        input = 'Create/read/replace/delete ONE random synthetic Siglum credential; no existing credentials are enumerated.';
    }
    else {
        if (!preset)
            throw new ProductError('PRESET_INVALID', 'Choose a local preset.');
        const p = store.get(presetRef(preset));
        if (kind === 'model') {
            if (p.settings.kind !== 'model')
                throw new ProductError('PRESET_INVALID', 'Choose a model preset.');
            validateWorkflowModel(p.settings.model);
            destination = p.settings.model.baseURL;
            input = 'Synthetic paragraph: A small fictional observation may suggest a relationship. Revise concisely while preserving uncertainty, then review pending changes. No edits will be adopted.';
            maxRequests = 2;
            timeoutMs = p.settings.model.timeoutMs;
            input += ' Maximum output tokens per request: ' + p.settings.model.maxOutputTokens + '.';
        }
        else if (kind === 'search') {
            if (p.settings.kind !== 'search')
                throw new ProductError('PRESET_INVALID', 'Choose a search preset.');
            destination = p.settings.endpoint;
            input = 'HTTP Cache-Control ETag documentation';
        }
        else {
            if (p.settings.kind !== 'mcp')
                throw new ProductError('PRESET_INVALID', 'Choose a MCP preset.');
            const c = p.settings.connection;
            destination = c.transport === 'http' ? c.url : c.command;
            input = 'Start/connect to this explicitly approved service and discover tools/resources only. No business tool is called. Discovery may still have external effects or cost.';
            timeoutMs = c.timeoutMs;
            launchHash = await mcpLaunchHash(c);
            maxRequests = 22;
        }
    }
    const base = { format: 1 as const, kind, preset: preset ? presetRef(preset) : null, destination, input, maxRequests, timeoutMs, launchHash };
    return { ...base, fingerprint: workflowHash(base) };
}
/** Exactly one confirmed plan; no retries or fallback. Abandoned probe journal remains unknown. */
export async function runProbe(plan: ProbePlan, confirmation: string, store = new ConnectionStore(), signal?: AbortSignal) {
    if (signal?.aborted)
        throw new ProductError('CANCELLED', 'Cancelled before probe.');
    const p = plan.preset ? store.get(plan.preset) : undefined, current = await prepareProbe(plan.kind, store, p);
    if (confirmation !== plan.fingerprint || current.fingerprint !== plan.fingerprint)
        throw new ProductError('PROBE_STALE', 'Probe preview changed; inspect and approve again.');
    const key = store.probeStart({ kind: plan.kind, preset: plan.preset, startedAt: new Date().toISOString(), maxRequests: plan.maxRequests, os: platform(), node: process.versions.node, sdk: MCP_SDK_VERSION });
    const started = Date.now();
    let detail: unknown = null, status: CheckStatus = 'passed';
    try {
        if (plan.kind === 'keyring')
            detail = await store.testCredentials();
        else if (plan.kind === 'search') {
            const s = p!.settings;
            if (s.kind !== 'search')
                throw Error();
            const service = new TavilySearch({ credential: endpoint => { if (endpoint !== s.endpoint)
                    throw new ProductError('PRESET_TARGET', 'Search target changed.'); return store.resolve(presetRef(p!), s); } });
            const response = await service.search({ query: plan.input, language: 'en', domains: [], timeRange: null, maxResults: 3 }, signal);
            detail = { provider: 'tavily', results: response.results.length, requestId: response.requestId, credits: response.credits, interpretation: 'live-discovery-not-fact-validation' };
        }
        else if (plan.kind === 'mcp-discovery') {
            const settings = p!.settings;
            if (settings.kind !== 'mcp')
                throw Error();
            const client = new McpClient(settings.connection, plan.launchHash!, settings.connection.transport === 'http' ? () => store.resolve(presetRef(p!), settings) : undefined);
            try {
                const catalog = await client.discover(signal);
                detail = { tools: catalog.tools.length, resources: catalog.resources.length, excluded: catalog.excluded.length, sdk: MCP_SDK_VERSION, interpretation: 'this-config-discovery-only-not-all-tools-or-conformance' };
            }
            finally {
                await client.close();
            }
        }
        else {
            if (p!.settings.kind !== 'model')
                throw Error();
            const folder = mkdtempSync(join(tmpdir(), 'siglum-model-check-'));
            let w: Workspace | null = null;
            try {
                w = Workspace.create(join(folder, 'workspace'), 'Explicit synthetic model trial');
                const d = w.createDocument('Synthetic connection test', 'A small fictional observation may suggest a relationship.');
                const config: WorkflowConfig = { template: 'revise-article', title: 'Explicit synthetic trial', goal: 'Make the sentence concise without strengthening uncertainty. Do not invent evidence.', publicBrief: '', language: 'en', research: 'selected', documentId: d.id, changeIds: [], selection: {}, profileId: null, intent: null, memoryOptions: { language: 'en' }, model: { ...p!.settings.model, maxOutputTokens: Math.min(p!.settings.model.maxOutputTokens, 2048), timeoutMs: plan.timeoutMs }, searchKeyEnv: 'TAVILY_API_KEY', domains: [], timeRange: null, autoRevision: false, budget: { models: 2, searches: 0, fetches: 0, activeMs: Math.max(30000, plan.timeoutMs * 2) } };
                // Preserve the exact chosen model settings; the plan already declares the original cap.
                config.model = { ...p!.settings.model };
                const run = w.workflows.create(config);
                attachPreset(w, run.id, p!, store);
                const preview = w.workflows.preview(run.id);
                w.workflows.authorize(run.id, preview.fingerprint, preview.limits);
                await executeWorkflow(w, run.id, presetDependencies(w, w.workflows.run(run.id), store), signal);
                detail = { runId: run.id, attempts: w.workflows.attempts(run.id).map(a => ({ task: a.task, status: a.status, usage: a.usage })), pendingChanges: w.listChanges(d.id).length, manuscriptUnchanged: w.history(d.id).length === 1, interpretation: 'live-synthetic-protocol-trial-not-writing-quality-score' };
            }
            finally {
                w?.close();
                rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
            }
        }
        if (plan.preset)
            store.get(plan.preset);
    }
    catch (e) {
        const code = safeProductCode(e);
        status = signal?.aborted || /TIMEOUT|NETWORK|UNKNOWN/.test(code) ? 'outcome-unknown' : 'failed';
        detail = { code, noAutomaticRetry: true };
    }
    const result = { id: key, status, kind: plan.kind, detail, durationMs: Date.now() - started, os: platform(), node: process.versions.node, sdk: MCP_SDK_VERSION, monetaryCost: 'unknown' };
    store.probeFinish(key, status, result);
    return result;
}
