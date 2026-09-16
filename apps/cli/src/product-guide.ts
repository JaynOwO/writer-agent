import { discoverMcp } from './extensions-command.js';
// SPDX-License-Identifier: Apache-2.0
import type { Workspace } from '@writer-agent/storage';
import { validateWorkflowModel, workflowHash } from '@writer-agent/core';
import type { WorkflowModel } from '@writer-agent/core';
import type { WizardIO } from './terminal.js';
import { WizardCancelled } from './terminal.js';
import { menuChoose } from './wizard.js';
import { ConnectionStore, attachPreset, presetRef } from './application/presets.js';
import type { ConnectionPreset, PresetSettings } from './application/presets.js';
import { ProductError } from './application/secrets.js';
import { localDiagnostics, recoveryView, prepareProbe, runProbe, safeProductCode } from './application/diagnostics.js';
import { diagnosticReport, reportSnapshot, writeReadingReport } from './application/report.js';
async function confirm(io: WizardIO, text: string) { const a = (await io.ask(text + ' [y/N]: ')).trim().toLowerCase(); if (a === 'q')
    throw new WizardCancelled(); return ['y', 'yes', '是'].includes(a); }
const show = (io: WizardIO, v: unknown) => io.line(JSON.stringify(v, null, 2));
export async function chooseModelPreset(io: WizardIO, lang: 'en' | 'zh-CN', store = new ConnectionStore()): Promise<ConnectionPreset | undefined> {
    const all = store.list().filter(p => p.enabled && p.settings.kind === 'model');
    if (!all.length)
        return undefined;
    const [p] = await menuChoose(io, lang === 'zh-CN' ? '选择保存的模型（0 = 手工配置）' : 'Saved model (0 = configure manually)', all, p => `${p.name} · ${p.credential.mode}`);
    return p;
}
async function modelSettings(io: WizardIO, tr: (z: string, e: string) => string, old?: WorkflowModel): Promise<WorkflowModel> {
    const [provider] = await menuChoose(io, tr('模型接口', 'Provider'), ['ollama', 'openai-compatible'] as const, x => x);
    if (!provider)
        throw new WizardCancelled();
    const model = (await io.ask(tr('模型ID: ', 'Model ID: '))) || old?.model || '';
    const baseURL = (await io.ask(tr('API基址（留空默认）: ', 'API base (empty for default): '))) || old?.baseURL || (provider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1');
    const allowRemote = await confirm(io, tr('允许此连接使用远端／云端？保存不代表发送', 'Allow remote/cloud for this connection? Saving does not send a request'));
    const [responseFormat] = await menuChoose(io, tr('返回格式', 'Response format'), ['json-schema', 'json', 'prompt'] as const, x => x);
    if (!responseFormat)
        throw new WizardCancelled();
    const timeoutMs = Number((await io.ask(tr('超时毫秒（默认120000）: ', 'Timeout milliseconds (default120000): '))) || 120000), maxOutputTokens = Number((await io.ask(tr('单次最大输出token（默认4096）: ', 'Max output tokens per request (default4096): '))) || 4096);
    const config: WorkflowModel = { provider, model, baseURL, apiKeyEnv: null, allowRemote, responseFormat, tokenParameter: 'max_completion_tokens', timeoutMs, maxOutputTokens };
    validateWorkflowModel(config);
    return config;
}
export async function runProductGuide(w: Workspace, io: WizardIO, lang: 'zh-CN' | 'en' = 'zh-CN', store = new ConnectionStore()): Promise<void> {
    const tr = (z: string, e: string) => lang === 'zh-CN' ? z : e;
    async function createPreset(old?: ConnectionPreset) {
        const name = await io.ask(tr('连接名称: ', 'Connection name: '));
        const [kind] = await menuChoose(io, tr('连接种类', 'Connection type'), ['model', 'search', 'mcp'] as const, x => x);
        if (!kind)
            return;
        let settings: PresetSettings;
        if (kind === 'model')
            settings = { kind, model: await modelSettings(io, tr, old?.settings.kind === 'model' ? old.settings.model : undefined) };
        else if (kind === 'search')
            settings = { kind, endpoint: 'https://api.tavily.com/search' };
        else {
            const [s] = await menuChoose(io, tr('已注册MCP连接（注册／保存并不授予执行权限）', 'Registered MCP connection (saving is not execution consent)'), w.extensions.servers(), s => s.config.name);
            if (!s)
                return;
            settings = { kind, connection: structuredClone(s.config) };
            if (settings.connection.transport === 'http')
                settings.connection.tokenEnv = null;
        }
        const modes = settings.kind === 'mcp' && settings.connection.transport === 'stdio' ? ['none'] as const : ['system', 'env', 'session', 'none'] as const;
        const [mode] = await menuChoose(io, tr('凭据保存方式', 'Credential storage'), modes, x => ({ system: tr('系统凭据库（不会退回明文）', 'OS credential store (no plaintext fallback)'), env: tr('明确的环境变量名称', 'Explicit environment variable name'), session: tr('仅本次进程会话', 'This process session only'), none: tr('不使用凭据', 'No credential') }[x]));
        if (!mode)
            return;
        let secret: string | undefined;
        if (mode === 'env')
            secret = await io.ask(tr('环境变量名称（不是Key）: ', 'Environment variable NAME, not the key: '));
        else if (mode === 'session' || mode === 'system') {
            if (!io.secret)
                throw new ProductError('SECRET_INPUT', 'Masked interactive input is required.');
            secret = await io.secret(tr('输入API Key', 'Enter API key'));
        }
        show(io, { name, settings, mode, operation: old ? 'new version; old task grants need re-selection' : 'create', secretValue: 'never-displayed' });
        try {
            if (await confirm(io, tr('保存这项连接？不会测试远端或读取其他应用凭据', 'Save this connection? No remote test or other-app credential lookup'))) {
                const p = await store.save(name, settings, mode, secret, old ? presetRef(old) : null);
                show(io, { id: p.id, version: p.version, name: p.name, mode: p.credential.mode });
            }
        }
        finally {
            secret = undefined;
        }
    }
    async function attach() {
        const [r] = await menuChoose(io, tr('选择未结束任务', 'Choose unfinished task'), w.workflows.list().filter(r => !['completed', 'cancelled'].includes(r.state)), r => r.config.title);
        if (!r)
            return;
        const [p] = await menuChoose(io, tr('选择预设', 'Choose preset'), store.list().filter(p => p.enabled), p => `${p.name} · ${p.settings.kind}`);
        if (!p)
            return;
        let serverId: string | undefined;
        if (p.settings.kind === 'mcp') {
            const [c] = await menuChoose(io, tr('选择本任务已批准候选服务', 'Choose a configured service in this task'), r.capture.extensions?.calls ?? [], c => c.config.name);
            if (!c)
                return;
            serverId = c.serverId;
        }
        show(io, { run: r.id, preset: p.name, settings: p.settings, credentialMode: p.credential.mode });
        if (await confirm(io, tr('将此预设绑定到这项任务并撤销旧阶段许可？', 'Bind locally to this task and revoke old stage consent?')))
            show(io, attachPreset(w, r.id, p, store, serverId));
    }
    async function summary() {
        const [r] = await menuChoose(io, tr('选择新稿任务', 'Choose new-article task'), w.workflows.list().filter(r => r.config.template === 'new-article' && !['completed', 'cancelled'].includes(r.state)), r => r.config.title);
        if (!r)
            return;
        const enabled = await confirm(io, tr('启用导航摘要？研究阶段增加最多一次模型调用，原文继续保留；不保证省钱', 'Enable navigation summary? Up to one extra model call per research input, original evidence retained; not guaranteed cheaper'));
        if (await confirm(io, tr('保存设置并撤销旧授权？', 'Save setting and revoke old consent?')))
            show(io, w.workflows.refresh(r.id, { ...r.config, navigationSummary: enabled }));
    }
    async function report() {
        const [kind] = await menuChoose(io, tr('报告种类', 'Report target'), ['diagnostics', 'run', 'document'] as const, x => x);
        if (!kind)
            return;
        let documentId: string | undefined, runId: string | undefined;
        if (kind === 'run') {
            const [r] = await menuChoose(io, tr('选择任务', 'Choose task'), w.workflows.list(), r => r.config.title);
            if (!r)
                return;
            runId = r.id;
        }
        if (kind === 'document') {
            const [d] = await menuChoose(io, tr('选择文稿', 'Choose manuscript'), w.listDocuments(), d => d.title);
            if (!d)
                return;
            documentId = d.id;
        }
        const includeText = kind !== 'diagnostics' && await confirm(io, tr('包含私人正文、候选和审稿意见？', 'Include private manuscript/candidates/review text?'));
        const includeSources = kind !== 'diagnostics' && await confirm(io, tr('包含私人来源片段与摘要？', 'Include private source excerpts and summaries?'));
        const includeGuidance = kind !== 'diagnostics' && await confirm(io, tr('包含作者意图和偏好？', 'Include author intent and preferences?'));
        const value = kind === 'diagnostics' ? diagnosticReport(localDiagnostics(w, store), lang) : reportSnapshot(w, { language: lang, ...(runId ? { runId } : {}), ...(documentId ? { documentId } : {}), includeText, includeSources, includeGuidance });
        show(io, { generatedAt: value.generatedAt, scope: value.scope, sections: value.sections.length, hash: workflowHash(value), offline: true, readOnly: true });
        const path = await io.ask(tr('新的 .html 文件路径（不能覆盖已有文件）: ', 'New .html file path (must not exist): '));
        if (path && await confirm(io, tr('写入以上选定内容？这是私人快照，不是实时网页', 'Write selected content? Private snapshot, not a live application'))) {
            writeReadingReport(path, value);
            io.line(tr('报告已保存。双击HTML可离线阅读；不会自动联网或批准正文。', 'Report saved. Open the HTML offline; no automatic networking or manuscript approval.'));
        }
    }
    async function probe() {
        const [kind] = await menuChoose(io, tr('单独授权的验证（可能联网／产生费用）', 'Explicit verification (may connect/cost money)'), ['model', 'search', 'mcp-discovery', 'keyring'] as const, x => x);
        if (!kind)
            return;
        let preset: ConnectionPreset | undefined;
        if (kind !== 'keyring') {
            const [p] = await menuChoose(io, tr('选择连接', 'Choose connection'), store.list().filter(p => p.enabled && p.settings.kind === (kind === 'mcp-discovery' ? 'mcp' : kind)), p => p.name);
            if (!p) {
                io.line(tr('未配置，不是测试通过。', 'Not configured; not a pass.'));
                return;
            }
            preset = p;
        }
        const plan = await prepareProbe(kind, store, preset);
        show(io, plan);
        if (await confirm(io, tr('批准以上准确测试范围？未知结果不自动重试', 'Approve this exact test scope? Unknown outcomes will not retry automatically')))
            show(io, await runProbe(plan, plan.fingerprint, store, io.signal));
    }
    for (;;) {
        const actions = ['diagnose', 'presets', 'create', 'replace', 'attach', 'remove', 'cleanup', 'verify', 'results', 'summary', 'report', 'recovery', 'mcp-catalog'] as const;
        const labels = { 'mcp-catalog': tr('使用连接预设发现并保存MCP工具列表', 'Discover/save MCP catalog with saved credential preset'), diagnose: tr('本地诊断（不联网、不解锁或读取Key）', 'Local diagnostics (no network/unlock/key reads)'), presets: tr('查看连接预设', 'List saved connections'), create: tr('新增连接与凭据', 'Add connection / credential'), replace: tr('更换连接配置或Key，创建新版本', 'Replace connection or key with new version'), attach: tr('将预设用于写作任务', 'Attach preset to writing task'), remove: tr('停用连接并移除本机凭据', 'Disable connection and remove local credential'), cleanup: tr('恢复未引用的本次应用凭据操作', 'Recover unreferenced application credential operations'), verify: tr('明确验证真实服务或系统凭据库', 'Explicit service / OS credential verification'), results: tr('查看验证历史（跳过不算通过）', 'Inspect test history (skipped is not passed)'), summary: tr('设置可选导航摘要', 'Configure optional navigation summaries'), report: tr('导出只读HTML阅读报告', 'Export read-only HTML report'), recovery: tr('解释任务暂停与恢复选项', 'Explain stopped task / recovery options') };
        const [action] = await menuChoose(io, tr('Siglum 连接、验证与阅读报告', 'Siglum connections, verification and reports'), actions, x => labels[x]);
        if (!action)
            return;
        try {
            if (action === 'diagnose')
                show(io, localDiagnostics(w, store));
            else if (action === 'presets')
                show(io, store.list());
            else if (action === 'create')
                await createPreset();
            else if (action === 'replace') {
                const [p] = await menuChoose(io, tr('替换哪项连接？', 'Replace which connection?'), store.list().filter(p => p.enabled), p => p.name);
                if (p)
                    await createPreset(p);
            }
            else if (action === 'attach')
                await attach();
            else if (action === 'summary')
                await summary();
            else if (action === 'report')
                await report();
            else if (action === 'verify')
                await probe();
            else if (action === 'results')
                show(io, store.probes());
            else if (action === 'remove') {
                const [p] = await menuChoose(io, tr('选择连接', 'Choose connection'), store.list().filter(p => p.enabled), p => p.name);
                if (p && await confirm(io, tr('停用并删除本机凭据？这不会撤销服务商的API Key', 'Disable and remove local credential? This does NOT revoke the provider API key')))
                    show(io, await store.remove(presetRef(p)));
            }
            else if (action === 'cleanup') {
                const [op] = await menuChoose(io, tr('只处理Siglum未被启用预设引用的条目', 'Only unreferenced Siglum operations'), store.pendingSecrets(), x => String(x.id) + ' ' + String(x.status));
                if (op && await confirm(io, tr('删除这个未引用的Siglum条目？', 'Delete only this unreferenced Siglum entry?')))
                    await store.cleanupSecret(String(op.id));
            }
            else if (action === 'mcp-catalog') {
                const [p] = await menuChoose(io, tr('选择MCP连接预设', 'Choose MCP preset'), store.list().filter(p => p.enabled && p.settings.kind === 'mcp'), p => p.name);
                if (!p || p.settings.kind !== 'mcp')
                    continue;
                const settings = p.settings, ref = presetRef(p);
                const [server] = await menuChoose(io, tr('选择配置完全匹配且已信任的连接；没有时先注册并信任', 'Choose an exactly matching trusted connection; register/trust one first'), w.extensions.servers().filter(s => s.trusted && workflowHash(s.config) === workflowHash(settings.connection)), s => s.config.name);
                if (!server)
                    continue;
                show(io, { preset: p.name, settings, credentialMode: p.credential.mode, operation: 'discover-only; may start a process or contact a service; no tool business call' });
                if (await confirm(io, tr('使用这个预设连接并保存工具目录？', 'Connect with this preset and save the discovered catalog?'))) {
                    const c = await discoverMcp(w, server.id, io.signal, settings.connection.transport === 'http' ? () => store.resolve(ref, settings) : undefined, () => { store.get(ref); });
                    show(io, { serverId: server.id, catalogId: c.id, tools: c.catalog.tools.map(t => t.name), resources: c.catalog.resources.map(r => r.uri), excluded: c.catalog.excluded });
                }
            }
            else if (action === 'recovery') {
                const [r] = await menuChoose(io, tr('选择任务', 'Choose task'), w.workflows.list(), r => r.config.title);
                if (r)
                    show(io, recoveryView(w, r.id));
            }
        }
        catch (e) {
            if (e instanceof WizardCancelled || io.signal?.aborted)
                throw new WizardCancelled();
            show(io, { status: 'stopped', code: safeProductCode(e), message: tr('没有绕过检查、改变权限或自动换用其他服务。', 'No guard bypass, permission change or automatic fallback.') });
        }
    }
}
