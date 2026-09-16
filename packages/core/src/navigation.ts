// SPDX-License-Identifier: Apache-2.0
import { exactObject, requireString, validateSourceContext, validateSourceQuotes, isRecord } from './index.js';
import type { SourceContextItem, SourceQuote } from './index.js';
export interface NavigationNote {
    summary: string;
    sourceQuotes: SourceQuote[];
}
export interface NavigationPacket {
    kind: 'derived-navigation-not-evidence';
    notes: NavigationNote[];
    omissions: string[];
}
export interface NavigationRequest {
    protocolVersion: 1;
    task: 'navigation-summary';
    runId: string;
    requestId: string;
    question: string;
    language: 'zh-CN' | 'en';
    sources: SourceContextItem[];
}
export interface NavigationOutput extends NavigationPacket {
    protocolVersion: 1;
    task: 'navigation-summary';
    runId: string;
    requestId: string;
}
function invalid(): never { throw new Error('Invalid bounded navigation summary or exact original-source references.'); }
export function validateNavigationPacket(v: unknown, sources: readonly SourceContextItem[]): asserts v is NavigationPacket {
    exactObject(v, ['kind', 'notes', 'omissions']);
    if (v.kind !== 'derived-navigation-not-evidence' || !Array.isArray(v.notes) || !v.notes.length || v.notes.length > 20 || !Array.isArray(v.omissions) || v.omissions.length > 20)
        invalid();
    for (const n of v.notes) {
        exactObject(n, ['summary', 'sourceQuotes']);
        requireString(n.summary, 'navigation text', 1500);
        if (!Array.isArray(n.sourceQuotes) || !n.sourceQuotes.length || n.sourceQuotes.length > 4)
            invalid();
        validateSourceQuotes(n.sourceQuotes, sources);
    }
    for (const s of v.omissions)
        requireString(s, 'omission', 1000);
    if (Buffer.byteLength(JSON.stringify(v)) > 24000)
        invalid();
}
export function validateNavigationRequest(v: unknown): asserts v is NavigationRequest {
    exactObject(v, ['protocolVersion', 'task', 'runId', 'requestId', 'question', 'language', 'sources']);
    if (v.protocolVersion !== 1 || v.task !== 'navigation-summary' || !['zh-CN', 'en'].includes(String(v.language)))
        invalid();
    requireString(v.runId, 'run', 200);
    requireString(v.requestId, 'request', 200);
    requireString(v.question, 'question', 10000);
    validateSourceContext(v.sources);
}
export function validateNavigationOutput(v: unknown, r: NavigationRequest): asserts v is NavigationOutput {
    validateNavigationRequest(r);
    exactObject(v, ['protocolVersion', 'task', 'runId', 'requestId', 'kind', 'notes', 'omissions']);
    if (v.protocolVersion !== 1 || v.task !== r.task || v.runId !== r.runId || v.requestId !== r.requestId)
        invalid();
    validateNavigationPacket({ kind: v.kind, notes: v.notes, omissions: v.omissions }, r.sources);
}
export function navigationPacket(v: NavigationOutput): NavigationPacket { return { kind: v.kind, notes: structuredClone(v.notes), omissions: v.omissions.slice() }; }
/** Only remap anchors which refer to original evidence actually present in this chapter. */
export function scopeNavigation(v: NavigationPacket | undefined, indices: number[]): NavigationPacket | undefined {
    if (!v)
        return undefined;
    const notes = v.notes.filter(n => n.sourceQuotes.every(q => indices.includes(q.itemIndex))).map(n => ({ ...n, sourceQuotes: n.sourceQuotes.map(q => ({ ...q, itemIndex: indices.indexOf(q.itemIndex) })) })).filter(n => n.sourceQuotes.length);
    return notes.length ? { kind: v.kind, notes, omissions: [...v.omissions.slice(0, 19), 'Navigation is partial; summaries are fallible and original evidence must be consulted.'] } : undefined;
}
export function isNavigationArtifact(v: unknown): v is {
    request: NavigationRequest;
    output: NavigationOutput;
} { return isRecord(v) && isRecord(v.request) && v.request.task === 'navigation-summary' && isRecord(v.output); }
