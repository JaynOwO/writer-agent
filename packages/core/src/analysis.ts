// SPDX-License-Identifier: Apache-2.0
import { WriterError, isRecord, requireString } from './errors.js';
import { validateText, validateSnapshot } from './document.js';
import { hashBytes, validateSourceContext } from './sources.js';
import type { Snapshot, TextBlock } from './types.js';
import type { SourceContextItem } from './sources.js';
import { CLAIM_KINDS, FINDING_CATEGORIES, EVIDENCE_RELATIONS, MAPPING_RELATIONS } from './analysis-types.js';
import type { TextAnchor, PinnedAnchor, SourceQuote, ClaimCandidate, AnalysisRequest, AnalysisOutput, ExtractionOutput, SemanticOutput, EvidenceRelation } from './analysis-types.js';
export const MAX_ANALYSIS_BYTES = 6000000;
export const MAX_ANALYSIS_ITEMS = 100;
function fail(message = 'Analysis data failed shape, reference, scope or exact-quotation validation.'): never { throw new WriterError('INVALID_INPUT', message); }
export function exactObject(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
    if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k)))
        fail();
}
function array(value: unknown, max = 100): asserts value is unknown[] { if (!Array.isArray(value) || value.length > max)
    fail(); }
export function analysisString(value: unknown, label = 'analysis text', max = 2000): asserts value is string { requireString(value, label, max); validateText(value); }
export function stringIds(value: unknown, max = 100): asserts value is string[] {
    array(value, max);
    const seen = new Set<string>();
    for (const id of value) {
        analysisString(id, 'ID', 200);
        if (seen.has(id))
            fail();
        seen.add(id);
    }
}
function bounded(value: unknown): void { if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_ANALYSIS_BYTES)
    fail('Analysis exceeds its byte limit. Select a smaller scope; no truncation is performed.'); }
/** Excludes split surrogate pairs. Combining sequences are preserved but not grapheme-normalized. */
export function isTextBoundary(text: string, offset: number): boolean {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length)
        return false;
    const left = text.charCodeAt(offset - 1), right = text.charCodeAt(offset);
    return !(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff);
}
function sliceCheck(text: string, start: unknown, end: unknown, quote: unknown): void {
    if (typeof start !== 'number' || typeof end !== 'number' || end <= start || !isTextBoundary(text, start) || !isTextBoundary(text, end))
        fail();
    analysisString(quote, 'quotation', 16000);
    if (text.slice(start, end) !== quote)
        fail('An exact quotation or UTF-16 position does not match the pinned text.');
}
export function pinAnchor(snapshot: Snapshot, value: unknown): PinnedAnchor {
    exactObject(value, ['blockId', 'start', 'end', 'quote']);
    analysisString(value.blockId, 'blockId', 200);
    const block = snapshot.blocks.find(b => b.id === value.blockId);
    if (!block)
        fail();
    sliceCheck(block.text, value.start, value.end, value.quote);
    return { blockId: block.id, start: value.start as number, end: value.end as number, quote: value.quote as string, blockVersion: block.version, quoteHash: hashBytes(value.quote as string) };
}
export function validateAnchors(value: unknown, snapshot: Snapshot, allowEmpty = false): asserts value is TextAnchor[] {
    array(value, 8);
    if (!allowEmpty && !value.length)
        fail();
    const seen = new Set<string>();
    for (const item of value) {
        const a = pinAnchor(snapshot, item), key = `${a.blockId}:${a.start}:${a.end}`;
        if (seen.has(key))
            fail();
        seen.add(key);
    }
}
export function validateSourceQuotes(value: unknown, sources: readonly SourceContextItem[]): asserts value is SourceQuote[] {
    array(value, 8);
    const seen = new Set<string>();
    for (const q of value) {
        exactObject(q, ['itemIndex', 'start', 'end', 'quote']);
        if (typeof q.itemIndex !== 'number' || !Number.isSafeInteger(q.itemIndex))
            fail();
        const item = sources[q.itemIndex];
        if (!item)
            fail();
        sliceCheck(item.text, q.start, q.end, q.quote);
        const key = `${q.itemIndex}:${q.start}:${q.end}`;
        if (seen.has(key))
            fail();
        seen.add(key);
    }
}
export function validateEvidence(relation: unknown, quotes: unknown, sources: readonly SourceContextItem[]): asserts relation is EvidenceRelation {
    if (!EVIDENCE_RELATIONS.includes(relation as EvidenceRelation))
        fail();
    validateSourceQuotes(quotes, sources);
    if (!sources.length && relation !== 'not-assessed')
        fail('No selected evidence means not-assessed, not unsupported or false.');
    if (relation === 'not-assessed' && quotes.length)
        fail();
    if (['supports', 'partially-supports', 'contradicts'].includes(relation as string) && !quotes.length)
        fail('A positive or conflicting evidence assessment requires an exact source quotation.');
}
export function validateCandidate(value: unknown, snapshot: Snapshot): asserts value is ClaimCandidate {
    exactObject(value, ['ref', 'statement', 'kind', 'anchors']);
    analysisString(value.ref, 'candidate ref', 80);
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value.ref))
        fail();
    analysisString(value.statement, 'statement');
    if (!CLAIM_KINDS.includes(value.kind as ClaimCandidate['kind']))
        fail();
    validateAnchors(value.anchors, snapshot);
}
function candidates(value: unknown, snapshot: Snapshot): Map<string, ClaimCandidate> {
    array(value);
    const refs = new Map<string, ClaimCandidate>();
    for (const c of value) {
        validateCandidate(c, snapshot);
        if (refs.has(c.ref))
            fail();
        refs.set(c.ref, c);
    }
    return refs;
}
export function captureAnalysisRequest(value: AnalysisRequest): AnalysisRequest {
    exactObject(value, ['protocolVersion', 'task', 'documentId', 'baseRevisionId', 'instruction', 'scope', 'documentBlockCount', 'before', 'after', 'changes', 'sources', 'protectedClaims', 'excludedProtectedClaimIds', 'ledgerStamp']);
    if (value.protocolVersion !== 1 || !['claim-extraction', 'semantic-review'].includes(value.task) || !['blocks', 'document'].includes(value.scope))
        fail();
    for (const id of [value.documentId, value.baseRevisionId])
        analysisString(id, 'identity', 200);
    analysisString(value.instruction, 'instruction', 10000);
    analysisString(value.ledgerStamp, 'ledger stamp', 64);
    if (!/^[a-f0-9]{64}$/.test(value.ledgerStamp))
        fail();
    validateSnapshot(value.before);
    if (!Number.isSafeInteger(value.documentBlockCount) || value.documentBlockCount < value.before.blocks.length || value.documentBlockCount > 10000)
        fail();
    if (value.scope === 'document' && value.documentBlockCount !== value.before.blocks.length)
        fail();
    array(value.changes);
    const seen = new Set<string>();
    for (const c of value.changes) {
        exactObject(c, ['id', 'hash']);
        analysisString(c.id, 'changeId', 200);
        if (typeof c.hash !== 'string' || !/^[a-f0-9]{64}$/.test(c.hash) || seen.has(c.id))
            fail();
        seen.add(c.id);
    }
    if (value.task === 'claim-extraction') {
        if (value.after !== null || value.changes.length)
            fail();
    }
    else {
        if (!value.after || !value.changes.length)
            fail();
        validateSnapshot(value.after);
        if (value.before.blocks.map(b => b.id).join('\n') !== value.after.blocks.map(b => b.id).join('\n'))
            fail();
    }
    validateSourceContext(value.sources);
    stringIds(value.excludedProtectedClaimIds);
    array(value.protectedClaims);
    const protectedIds = new Set<string>();
    for (const c of value.protectedClaims) {
        exactObject(c, ['claimId', 'occurrenceId', 'statement', 'anchors']);
        analysisString(c.claimId, 'protected claim ID', 200);
        analysisString(c.occurrenceId, 'occurrence ID', 200);
        analysisString(c.statement);
        const key = c.claimId + ':' + c.occurrenceId;
        if (protectedIds.has(key) || value.excludedProtectedClaimIds.includes(c.claimId))
            fail();
        protectedIds.add(key);
        validateAnchors(c.anchors, value.before);
    }
    bounded(value);
    return structuredClone(value);
}
function refs(value: unknown, known: ReadonlyMap<string, ClaimCandidate>): asserts value is string[] { stringIds(value); for (const id of value)
    if (!known.has(id))
        fail(); }
export function validateAnalysisOutput(value: unknown, request: AnalysisRequest): AnalysisOutput {
    bounded(value);
    if (request.task === 'claim-extraction') {
        exactObject(value, ['protocolVersion', 'task', 'documentId', 'baseRevisionId', 'candidates', 'notes']);
        candidates(value.candidates, request.before);
    }
    else {
        exactObject(value, ['protocolVersion', 'task', 'documentId', 'baseRevisionId', 'beforeClaims', 'afterClaims', 'mappings', 'findings', 'assessments', 'notes']);
        if (!request.after)
            fail();
        const before = candidates(value.beforeClaims, request.before), after = candidates(value.afterClaims, request.after);
        array(value.mappings, 200);
        const coveredBefore = new Set<string>(), coveredAfter = new Set<string>();
        for (const m of value.mappings) {
            exactObject(m, ['beforeRefs', 'afterRefs', 'relation', 'explanation']);
            refs(m.beforeRefs, before);
            refs(m.afterRefs, after);
            analysisString(m.explanation);
            if (!MAPPING_RELATIONS.includes(m.relation as typeof MAPPING_RELATIONS[number]) || (!m.beforeRefs.length && !m.afterRefs.length))
                fail();
            const b = m.beforeRefs.length, a = m.afterRefs.length;
            if ((m.relation === 'added' && (b !== 0 || a !== 1)) || (m.relation === 'removed' && (b !== 1 || a !== 0)) ||
                (m.relation === 'split' && (b !== 1 || a < 2)) || (m.relation === 'merged' && (b < 2 || a !== 1)) ||
                (['equivalent', 'reformulated', 'reversed'].includes(m.relation as string) && (a !== 1 || b !== 1)))
                fail();
            for (const id of m.beforeRefs) {
                if (coveredBefore.has(id))
                    fail();
                coveredBefore.add(id);
            }
            for (const id of m.afterRefs) {
                if (coveredAfter.has(id))
                    fail();
                coveredAfter.add(id);
            }
        }
        if (coveredBefore.size !== before.size || coveredAfter.size !== after.size)
            fail('Every extracted candidate needs an explicit mapping, including uncertain or unmapped cases.');
        array(value.findings);
        const findingIds = new Set<string>();
        for (const f of value.findings) {
            exactObject(f, ['ref', 'category', 'before', 'after', 'beforeRefs', 'afterRefs', 'sourceQuotes', 'importantClaimIds', 'explanation']);
            analysisString(f.ref, 'finding ref', 80);
            if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(f.ref) || findingIds.has(f.ref) || !FINDING_CATEGORIES.includes(f.category as typeof FINDING_CATEGORIES[number]))
                fail();
            findingIds.add(f.ref);
            validateAnchors(f.before, request.before, true);
            validateAnchors(f.after, request.after, true);
            if (!f.before.length && !f.after.length)
                fail();
            refs(f.beforeRefs, before);
            refs(f.afterRefs, after);
            validateSourceQuotes(f.sourceQuotes, request.sources);
            stringIds(f.importantClaimIds);
            analysisString(f.explanation);
            if (f.category === 'claim-added' && !f.after.length)
                fail();
            if (f.category === 'claim-unmapped' && !f.before.length)
                fail();
            if (['certainty', 'attribution', 'scope', 'time', 'numeric', 'causality', 'claim-reversed', 'claim-reformulated'].includes(f.category as string) && (!f.before.length || !f.after.length))
                fail();
            if (f.category === 'evidence-shift' && !f.sourceQuotes.length)
                fail();
            for (const id of f.importantClaimIds)
                if (!request.protectedClaims.some(c => c.claimId === id))
                    fail();
            if (f.category === 'protected-claim' && !f.importantClaimIds.length)
                fail();
        }
        array(value.assessments, 200);
        const assessed = new Set<string>();
        for (const a of value.assessments) {
            exactObject(a, ['side', 'claimRef', 'relation', 'sourceQuotes', 'explanation']);
            if (a.side !== 'before' && a.side !== 'after')
                fail();
            const known = a.side === 'before' ? before : after;
            analysisString(a.claimRef, 'claimRef', 80);
            if (!known.has(a.claimRef))
                fail();
            const key = a.side + ':' + a.claimRef;
            if (assessed.has(key))
                fail();
            assessed.add(key);
            validateEvidence(a.relation, a.sourceQuotes, request.sources);
            analysisString(a.explanation);
        }
    }
    if (value.protocolVersion !== 1 || value.task !== request.task || value.documentId !== request.documentId || value.baseRevisionId !== request.baseRevisionId)
        fail();
    array(value.notes, 20);
    for (const n of value.notes)
        analysisString(n);
    return structuredClone(value) as unknown as ExtractionOutput | SemanticOutput;
}
/** Exact single-span replacement per block, not a minimal edit script or a semantic detector. */
export function textObservation(before: TextBlock, after: TextBlock) {
    let start = 0;
    while (start < before.text.length && start < after.text.length && before.text[start] === after.text[start])
        start++;
    while (!isTextBoundary(before.text, start) || !isTextBoundary(after.text, start))
        start--;
    let oldEnd = before.text.length, newEnd = after.text.length;
    while (oldEnd > start && newEnd > start && before.text[oldEnd - 1] === after.text[newEnd - 1]) {
        oldEnd--;
        newEnd--;
    }
    while (!isTextBoundary(before.text, oldEnd) || !isTextBoundary(after.text, newEnd)) {
        oldEnd++;
        newEnd++;
    }
    return { blockId: before.id, method: 'exact-prefix-suffix-v1', changed: before.text !== after.text,
        beforeVersion: before.version, afterVersion: after.version, start, oldEnd, newEnd,
        removed: before.text.slice(start, oldEnd), inserted: after.text.slice(start, newEnd),
        beforeHash: hashBytes(before.text), afterHash: hashBytes(after.text) };
}
export function analysisObservations(request: AnalysisRequest) {
    return { scope: request.scope, inspectedBlockIds: request.before.blocks.map(b => b.id), documentBlockCount: request.documentBlockCount,
        changes: request.after ? request.before.blocks.map((b, i) => textObservation(b, request.after!.blocks[i]!)).filter(d => d.changed) : [],
        protectedWording: request.protectedClaims.map(c => ({ claimId: c.claimId, exactQuotesStillPresentInInspectedAfter: c.anchors.map(a => ({ quoteHash: hashBytes(a.quote), present: request.after?.blocks.some(b => b.text.includes(a.quote)) ?? null })), meaning: 'Exact wording only; absence is not semantic deletion.' })),
        notice: 'Exact text observations and valid quotations are not factual or semantic certification.' };
}
