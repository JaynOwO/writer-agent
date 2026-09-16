// SPDX-License-Identifier: Apache-2.0
import type { WorkflowRun, WorkflowModel } from '@writer-agent/core';
import type { Workspace } from '@writer-agent/storage';
import { TavilySearch, ProviderError } from '@writer-agent/models';
import { makeWorkflowModel, type WorkflowDependencies } from '../workflow-runtime.js';
import { McpClient } from '../mcp-client.js';
import { ConnectionStore } from './presets.js';
import type { PresetSettings } from './presets.js';
/** Binds nonsecret run capture to author-approved user-local credential mappings. */
export function presetDependencies(w: Workspace, run: WorkflowRun, store = new ConnectionStore()): WorkflowDependencies {
    const c = run.config, refs = c.connectionRefs ?? {};
    const modelSettings: PresetSettings = { kind: 'model', model: structuredClone(c.model) };
    const searchSettings: PresetSettings = { kind: 'search', endpoint: 'https://api.tavily.com/search' };
    const check = () => {
        if (refs.model)
            store.checkBinding(w, run.id, 'model', refs.model, modelSettings);
        if (refs.search)
            store.checkBinding(w, run.id, 'search', refs.search, searchSettings);
        for (const [serverId, ref] of Object.entries(refs.mcp ?? {})) {
            const call = run.capture.extensions?.calls.find(call => call.serverId === serverId);
            if (!call)
                throw new ProviderError('PROVIDER_CONFIG', 'Preset mapping references a server outside this task.');
            store.checkBinding(w, run.id, 'mcp:' + serverId, ref, { kind: 'mcp', connection: call.config });
        }
    };
    check();
    const model = makeWorkflowModel(c.model, refs.model ? endpoint => store.forRun(w, run.id, 'model', refs.model!, modelSettings, endpoint) : undefined, check);
    const search = new TavilySearch({ keyEnv: c.searchKeyEnv, ...(refs.search ? { credential: (endpoint: string) => store.forRun(w, run.id, 'search', refs.search!, searchSettings, endpoint) } : {}) });
    return { model, search, assertCurrent: check, mcpCall: async (call, signal) => {
            check();
            const ref = refs.mcp?.[call.serverId];
            const client = new McpClient(call.config, call.serverHash, ref ? endpoint => store.forRun(w, run.id, 'mcp:' + call.serverId, ref, { kind: 'mcp', connection: call.config }, endpoint) : undefined);
            try {
                return await client.execute(call, signal, catalog => { w.extensions.saveCatalog(call.serverId, catalog); w.extensions.assertCall(call); check(); });
            }
            finally {
                await client.close();
            }
        } };
}
/** Saved model defaults do not grant a request. Independent commands still preview/send. */
export function modelFromPreset(store: ConnectionStore, id: string, version: string) {
    const ref = { id, version }, p = store.get(ref);
    if (p.settings.kind !== 'model')
        throw new ProviderError('PROVIDER_CONFIG', 'Choose a model preset.');
    const settings = { kind: 'model' as const, model: p.settings.model as WorkflowModel };
    return makeWorkflowModel(settings.model, endpoint => {
        const suffix = settings.model.provider === 'ollama' ? '/api/chat' : '/chat/completions';
        const u = new URL(settings.model.baseURL.replace(/\/+$/, '') + suffix);
        if (u.hostname === 'localhost')
            u.hostname = '127.0.0.1';
        if (u.href !== endpoint)
            throw new ProviderError('PROVIDER_CONFIG', 'Preset endpoint changed.');
        return store.resolve(ref, settings);
    }, () => { store.get(ref); });
}
