// SPDX-License-Identifier: Apache-2.0
import { writeFileSync, linkSync, unlinkSync, lstatSync } from 'node:fs';
import { dirname, resolve, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isRecord, workflowHash } from '@writer-agent/core';
import type { Workspace } from '@writer-agent/storage';
import type { WorkflowContentRequest, DraftOutput, SourceContextItem } from '@writer-agent/core';
import { recoveryView, PRODUCT_VERSION, localDiagnostics } from './diagnostics.js';
import { ProductError } from './secrets.js';
export interface ReportOptions {
    language: 'zh-CN' | 'en';
    runId?: string;
    documentId?: string;
    includeText: boolean;
    includeSources: boolean;
    includeGuidance: boolean;
}
export interface ReportSection {
    title: string;
    text?: string;
    before?: string;
    after?: string;
    details?: unknown;
    link?: string;
}
export interface ReadingReport {
    format: 1;
    kind: 'siglum-read-only-snapshot';
    version: string;
    generatedAt: string;
    language: 'zh-CN' | 'en';
    title: string;
    scope: {
        text: boolean;
        sources: boolean;
        guidance: boolean;
    };
    sections: ReportSection[];
}
function visibleOutput(value: unknown, includeSources: boolean): unknown {
    if (Array.isArray(value))
        return value.map(v => visibleOutput(v, includeSources));
    if (isRecord(value))
        return Object.fromEntries(Object.entries(value).filter(([key]) => includeSources || !['sourceQuotes', 'citations'].includes(key)).map(([key, v]) => [key, visibleOutput(v, includeSources)]));
    return value;
}
function packet(v: unknown): v is {
    request: WorkflowContentRequest;
    output: DraftOutput;
} { return isRecord(v) && isRecord(v.request) && isRecord(v.output); }
export function reportSnapshot(w: Workspace, options: ReportOptions): ReadingReport {
    if (!['en', 'zh-CN'].includes(options.language) || [options.includeText, options.includeSources, options.includeGuidance].some(v => typeof v !== 'boolean') || !!options.runId === !!options.documentId)
        throw new ProductError('REPORT_OPTIONS', 'Select exactly one task or document and explicit inclusion flags.');
    const tr = (zh: string, en: string) => options.language === 'zh-CN' ? zh : en;
    const sections: ReportSection[] = [], sourceMap = new Map<string, SourceContextItem>();
    let title = tr('元数据诊断报告', 'Metadata diagnostic report');
    const addSources = (sources: readonly SourceContextItem[]) => { if (options.includeSources)
        for (const source of sources)
            sourceMap.set(workflowHash(source), source); };
    if (options.runId) {
        const run = w.workflows.run(options.runId), artifacts = w.workflows.artifacts(run.id);
        if (options.includeText)
            title = run.config.title;
        const recovery = recoveryView(w, run.id);
        sections.push({ title: tr('截至生成时的任务与恢复状态', 'Task / recovery state at generation'), text: tr('阶段：', 'Stage: ') + run.stage + ' · ' + tr('状态：', 'State: ') + run.state + '\n' + tr('已保存产物：', 'Saved artifacts: ') + artifacts.length + ' · ' + tr('模型尝试：', 'Model attempts: ') + recovery.spent.models + '\n' + tr('金额：未知；打开此报告不会继续执行任务。', 'Cost: unknown. Opening this report will not resume execution.'), details: recovery });
        const candidates = run.candidateIds.map(id => w.workflows.artifact(id)).filter(a => packet(a.value) && typeof a.value.output.markdown === 'string');
        if (options.includeText) {
            if (candidates.length >= 2)
                sections.push({ title: tr('候选 A / B 对照（精确原文，非最小词级 diff）', 'Candidate A / B (exact text, not minimal word diff)'), before: (candidates[0]!.value as {
                        output: DraftOutput;
                    }).output.markdown, after: (candidates[1]!.value as {
                        output: DraftOutput;
                    }).output.markdown });
            else if (candidates.length === 1)
                sections.push({ title: tr('候选稿（未代表采用）', 'Candidate (not implicit adoption)'), text: (candidates[0]!.value as {
                        output: DraftOutput;
                    }).output.markdown });
        }
        const seenGuidance = new Set<string>();
        // Metadata reports never include requests, notices, titles, queries, connection details or raw responses.
        for (const a of artifacts) {
            const v = a.value;
            if (packet(v)) {
                if (options.includeText && a.type !== 'navigation-summary') {
                    if (typeof v.output.markdown === 'string') {
                        if (!run.candidateIds.includes(a.id))
                            sections.push({ title: tr('章节／中间稿（不是完整候选）', 'Chapter / intermediate draft (not the complete candidate)'), details: { id: a.id, text: v.output.markdown } });
                    }
                    else
                        sections.push({ title: tr('模型／作者产物（非事实认证）', 'Model / author output (not fact certification)') + ' · ' + a.type, ...(isRecord(v.output) && typeof v.output.summary === 'string' ? { text: v.output.summary } : {}), details: visibleOutput(v.output, options.includeSources) });
                }
                addSources(v.request.sources ?? []);
                if (options.includeGuidance && v.request.guidance && !seenGuidance.has(workflowHash(v.request.guidance))) {
                    seenGuidance.add(workflowHash(v.request.guidance));
                    sections.push({ title: tr('实际使用的作者指导', 'Author guidance actually supplied'), details: v.request.guidance });
                }
            }
            if (isRecord(v) && Array.isArray(v.changeIds)) {
                for (const cid of v.changeIds) {
                    if (typeof cid !== 'string')
                        continue;
                    const c = w.getChange(cid);
                    if (options.includeText)
                        sections.push({ title: tr('文字修改：精确前后对照（不是最小词级差异）', 'Text change: exact before/after (not minimal word diff)'), before: c.before, after: c.after, details: { id: c.id, status: c.status } });
                }
            }
            if (isRecord(v) && typeof v.reportId === 'string' && options.includeText) {
                const analysis = w.analysis.report(v.reportId);
                sections.push({ title: tr('语义审查与作者反馈（模型判断可被纠正）', 'Semantic review and author feedback (fallible assessments)'), details: { id: analysis.id, freshness: analysis.freshness, output: visibleOutput(analysis.output, options.includeSources), feedback: analysis.feedback } });
                if (options.includeGuidance)
                    sections.push({ title: tr('审稿指导', 'Review guidance'), details: ('guidance' in analysis.request ? analysis.request.guidance : null) });
                addSources(analysis.request.sources);
            }
            if (isRecord(v) && v.interpretation === 'derived-navigation-not-evidence' && options.includeSources)
                sections.push({ title: tr('导航摘要记录', 'Navigation summary record'), details: { output: v.output, originalBytes: v.originalBytes, summaryBytes: v.summaryBytes, promptVersion: v.promptVersion } });
        }
        sections.push({ title: tr('完整产物版本目录', 'Artifact version directory'), details: artifacts.map(a => ({ id: a.id, type: a.type, origin: a.origin, epoch: a.epoch, createdAt: a.createdAt, currentEpoch: a.epoch === run.epoch })) });
    }
    else {
        const d = w.getDocument(options.documentId!), revision = w.currentRevision(d.id);
        if (options.includeText)
            title = d.title;
        sections.push({ title: tr('文稿元数据（截至生成时）', 'Document metadata (at generation)'), details: { id: d.id, revisionId: revision.id, createdAt: d.createdAt } });
        if (options.includeText) {
            sections.push({ title: tr('正式文稿', 'Manuscript'), text: w.markdown(d.id) });
            for (const c of w.listChanges(d.id))
                sections.push({ title: tr('修改记录', 'Change record'), before: c.before, after: c.after, details: { id: c.id, status: c.status } });
        }
        if (options.includeGuidance && w.info().schemaVersion >= 4)
            sections.push({ title: tr('生成时的当前意图（不代表历史稿件使用过）', 'Current intent at generation (not historical-use proof)'), details: w.memory.activeIntent(d.id) });
        if (options.includeSources && w.info().schemaVersion >= 6) {
            const map = w.extensions.citations(d.id);
            if (map)
                sections.push({ title: tr('版本绑定引用（不是支持结论认证）', 'Version-pinned citations (not certified support)'), details: map });
        }
    }
    for (const source of sourceMap.values())
        sections.push({ title: tr('已选择的原始证据片段', 'Selected original evidence excerpt'), text: source.text, details: { snapshotId: source.snapshotId, startLine: source.startLine, endLine: source.endLine, origin: source.origin ?? null, locator: source.locator }, ...(safeReportLink(source.locator) ? { link: safeReportLink(source.locator)! } : {}) });
    const report: ReadingReport = { format: 1, kind: 'siglum-read-only-snapshot', version: PRODUCT_VERSION, generatedAt: new Date().toISOString(), language: options.language, title, scope: { text: options.includeText, sources: options.includeSources, guidance: options.includeGuidance }, sections };
    if (Buffer.byteLength(JSON.stringify(report)) > 8000000)
        throw new ProductError('REPORT_SIZE', 'Report exceeds 8 MB; choose less history or fewer content groups. No partial report was exported.');
    return report;
}
export function diagnosticReport(value: ReturnType<typeof localDiagnostics>, language: 'en' | 'zh-CN'): ReadingReport { return { format: 1, kind: 'siglum-read-only-snapshot', version: PRODUCT_VERSION, generatedAt: value.generatedAt, language, title: language === 'en' ? 'Local diagnostics' : '本地诊断', scope: { text: false, sources: false, guidance: false }, sections: [{ title: language === 'en' ? 'Metadata only' : '仅元数据', details: value }] }; }
export function safeReportLink(value: string): string | null { try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || /[\x00-\x20\x7f]/.test(value))
        return null;
    return u.href;
}
catch {
    return null;
} }
export function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ''); }
export function renderReadingReport(report: ReadingReport): string {
    if (!['en', 'zh-CN'].includes(report.language) || report.kind !== 'siglum-read-only-snapshot')
        throw new ProductError('REPORT_INVALID', 'Invalid report metadata.');
    const e = escapeHtml, tr = (zh: string, en: string) => report.language === 'zh-CN' ? zh : en;
    const cards = report.sections.map((s, i) => `<section id="s${i}"><h2>${e(s.title)}</h2>${s.before !== undefined && s.after !== undefined ? `<div class="comparison"><div><h3>${tr('修改前', 'Before')}</h3><pre>${e(s.before)}</pre></div><div><h3>${tr('修改后', 'After')}</h3><pre>${e(s.after)}</pre></div></div>` : ''}${s.text !== undefined ? `<pre class="manuscript">${e(s.text)}</pre>` : ''}${s.details !== undefined ? `<details><summary>${tr('展开记录', 'Inspect record')}</summary><pre>${e(JSON.stringify(s.details, null, 2))}</pre></details>` : ''}${s.link && safeReportLink(s.link) ? `<a href="${e(safeReportLink(s.link)!)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${tr('主动打开来源网站', 'Open source website explicitly')}</a>` : ''}</section>`).join('\n');
    return `<!doctype html><html lang="${report.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${e(report.title)} — Siglum</title><style>
:root{color-scheme:light;--ink:#1d2833;--muted:#586777;--line:#d9dfe5;--paper:#fff;--accent:#245c78}*{box-sizing:border-box}body{margin:0;background:#eef1f4;color:var(--ink);font:16px/1.75 system-ui,-apple-system,"Segoe UI",sans-serif}header,main,footer{max-width:1150px;margin:auto;padding:30px}header{padding-top:48px}header small{letter-spacing:.12em;color:var(--accent);font-weight:700}h1{line-height:1.3;font-size:32px;overflow-wrap:anywhere}h2{font-size:20px;margin-top:0}h3{font-size:14px;color:var(--muted)}.sub{color:var(--muted);font-size:14px}.notice{border-left:4px solid var(--accent);padding:12px 18px;background:#e1ebf1}nav{display:flex;flex-wrap:wrap;gap:8px 18px;padding-top:18px}a{color:var(--accent);overflow-wrap:anywhere}section{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:24px;margin-bottom:22px;break-inside:avoid}pre{font:14px/1.75 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin:12px 0}.manuscript{font:17px/1.9 Georgia,"Noto Serif CJK SC",serif}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:24px}.comparison>div{min-width:0}details{border-top:1px solid var(--line);padding-top:12px;margin-top:12px}summary{cursor:pointer;color:var(--muted)}footer{font-size:13px;color:var(--muted)}@media(max-width:720px){header,main,footer{padding:20px}.comparison{grid-template-columns:1fr}h1{font-size:26px}section{padding:18px}}@media print{body{background:white}header,main,footer{max-width:none;padding:10px}nav{display:none}section{border-radius:0;break-inside:auto}a{color:inherit}.notice{background:none}}</style></head><body><header><small>SIGLUM · ${e(report.version)} · ${tr('只读报告', 'READ-ONLY REPORT')}</small><h1>${e(report.title)}</h1><p class="sub">${tr('截至生成时', 'Snapshot generated at')}: ${e(report.generatedAt)}</p><div class="notice">${tr('这是私人阅读快照，不会自动联网、改稿或批准内容。模型判断与引用位置不等于事实认证；状态在生成后不会自动更新。分享前检查所选内容。', 'A private reading snapshot: no automatic networking, editing or approvals. Model assessments and valid quotations do not certify facts. Status is frozen at generation. Inspect included content before sharing.')}</div><p class="sub">${tr('包含原文／证据／指导', 'Includes text / evidence / guidance')}: ${[report.scope.text, report.scope.sources, report.scope.guidance].map(x => x ? '✓' : '—').join(' / ')}</p><details class="contents"><summary>${tr('阅读目录', 'Contents')} · ${report.sections.length}</summary><nav>${report.sections.map((s, i) => `<a href="#s${i}">${i + 1}. ${e(s.title)}</a>`).join('')}</nav></details></header><main>${cards}</main><footer>${tr('无外部资源，无脚本，无可执行操作。导出材料的原有版权与许可不变。', 'No external assets, scripts or executable actions. Original rights and licenses of exported materials remain unchanged.')}</footer></body></html>`;
}
/** Atomic no-overwrite publication. The sibling temp and destination are on one filesystem. */
export function writeReadingReport(path: string, report: ReadingReport): void {
    const destination = resolve(path), dir = dirname(destination);
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink())
        throw new ProductError('REPORT_PATH', 'Choose a regular existing destination directory.');
    const html = renderReadingReport(report);
    if (Buffer.byteLength(html) > 16000000)
        throw new ProductError('REPORT_SIZE', 'Rendered report too large.');
    const temp = join(dir, '.' + basename(path) + '.' + randomUUID() + '.tmp');
    try {
        writeFileSync(temp, html, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        linkSync(temp, destination);
    }
    finally {
        try {
            unlinkSync(temp);
        }
        catch { }
    }
}
