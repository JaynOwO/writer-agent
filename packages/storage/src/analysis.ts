// SPDX-License-Identifier: Apache-2.0
import type { DatabaseSync } from 'node:sqlite';
import { newId, hashBytes, WriterError, analysisString, stringIds, validateCandidate, pinAnchor, captureAnalysisRequest, validateAnalysisOutput, applyChange, validateEvidence, validateSourceQuotes, analysisObservations, exactObject, optionsFromCapture, } from '@writer-agent/core';
import type { Revision, Change, SourceSelection, Snapshot, ClaimCandidate, ClaimOccurrence, AnalysisRequest, AnalysisRun, AnalysisProviderInfo, AnalysisUsage, ClaimDecision, ClaimDecisionAction, FindingDecision, HumanEvidenceAssessment, EvidenceRelation, SourceQuote, MemoryOptions, } from '@writer-agent/core';
import type { WritingMemory } from './memory.js';
import type { SourceLibrary } from './sources.js';
interface Host {
    currentRevision(id: string): Revision;
    getRevision(id: string): Revision;
    getChange(id: string): Change;
    readonly sources: SourceLibrary;
    readonly memory: WritingMemory;
    info(): {schemaVersion:number};
}
const now = () => new Date().toISOString();
const tables = ['analysis_runs', 'claim_occurrences', 'claim_decisions', 'analysis_feedback', 'claim_evidence'];
function unpack<T>(row: Record<string, unknown> | undefined): T {
    if (!row)
        throw new WriterError('NOT_FOUND', 'Analysis record not found.');
    if (typeof row.payload !== 'string' || typeof row.payload_hash !== 'string' || hashBytes(row.payload) !== row.payload_hash)
        throw new WriterError('CORRUPT_DATA', 'Analysis record integrity check failed.');
    try {
        return JSON.parse(row.payload) as T;
    }
    catch {
        throw new WriterError('CORRUPT_DATA', 'Stored analysis JSON is invalid.');
    }
}
export function safeProvider(info: AnalysisProviderInfo): AnalysisProviderInfo {
    exactObject(info, ['providerId', 'model', 'endpoint', 'responseFormat', 'tokenParameter', 'timeoutMs', 'maxOutputTokens']);
    for (const s of [info.providerId, info.model, info.responseFormat])
        analysisString(s, 'provider metadata', 200);
    if (info.tokenParameter !== null)
        analysisString(info.tokenParameter, 'tokenParameter', 80);
    try {
        const url = new URL(info.endpoint);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || info.endpoint.length > 4096)
            throw Error();
    }
    catch {
        throw new WriterError('INVALID_INPUT', 'Provider metadata must contain a non-secret HTTP endpoint.');
    }
    if (!Number.isSafeInteger(info.timeoutMs) || info.timeoutMs < 10 || !Number.isSafeInteger(info.maxOutputTokens) || info.maxOutputTokens < 128)
        throw new WriterError('INVALID_INPUT', 'Invalid provider metadata.');
    return structuredClone(info);
}
export function safeUsage(value: AnalysisUsage | null): AnalysisUsage | null {
    if (value === null)
        return null;
    exactObject(value, ['inputTokens', 'outputTokens', 'totalTokens']);
    for (const v of Object.values(value))
        if (v !== null && (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0))
            throw new WriterError('INVALID_INPUT', 'Invalid usage metadata.');
    return structuredClone(value);
}
/** Private workspace ledger. Neither providers nor model output get a reference to this object. */
export class AnalysisLedger {
    constructor(private readonly db: DatabaseSync, private readonly ready: () => void, private readonly transaction: <T>(fn: () => T) => T, private readonly host: Host) { }
    private insert(table: string, id: string, payload: unknown, columns: Record<string, string | null>): void {
        if (!tables.includes(table))
            throw Error('Unknown analysis table');
        const json = JSON.stringify(payload);
        const keys = ['id', ...Object.keys(columns), 'payload', 'payload_hash'];
        this.db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(id, ...Object.values(columns), json, hashBytes(json));
    }
    private record<T>(table: string, id: string): T {
        this.ready();
        analysisString(id, 'record ID', 200);
        if (!tables.includes(table))
            throw Error('Unknown analysis table');
        return unpack<T>(this.db.prepare(`SELECT payload,payload_hash FROM ${table} WHERE id=?`).get(id));
    }
    private stamp(documentId: string): string {
        return hashBytes(JSON.stringify(['claim_occurrences', 'claim_decisions'].map(t => this.db.prepare(`SELECT COUNT(*) n,MAX(seq) latest FROM ${t} WHERE document_id=?`).get(documentId))));
    }
    occurrence(id: string): ClaimOccurrence {
        const c = this.record<ClaimOccurrence>('claim_occurrences', id), r = this.host.getRevision(c.revisionId);
        if (c.id !== id || r.documentId !== c.documentId)
            throw new WriterError('CORRUPT_DATA', 'Claim occurrence identity mismatch.');
        const candidate = { ref: 'saved', statement: c.statement, kind: c.kind, anchors: c.anchors.map(({ blockId, start, end, quote }) => ({ blockId, start, end, quote })) };
        try {
            validateCandidate(candidate, r.snapshot);
            for (let i = 0; i < c.anchors.length; i++)
                if (JSON.stringify(pinAnchor(r.snapshot, candidate.anchors[i])) !== JSON.stringify(c.anchors[i]))
                    throw Error();
        }
        catch {
            throw new WriterError('CORRUPT_DATA', 'Saved claim anchors do not match their revision.');
        }
        return c;
    }
    decisions(documentId: string): ClaimDecision[] { this.ready(); this.host.currentRevision(documentId); return this.db.prepare('SELECT payload,payload_hash FROM claim_decisions WHERE document_id=? ORDER BY seq').all(documentId).map(r => unpack<ClaimDecision>(r)); }
    private current(c: ClaimOccurrence): boolean {
        const revision = this.host.currentRevision(c.documentId);
        return c.anchors.every(a => { const b = revision.snapshot.blocks.find(b => b.id === a.blockId); return b?.version === a.blockVersion && b.text.slice(a.start, a.end) === a.quote; });
    }
    list(documentId: string) {
        this.ready();
        this.host.currentRevision(documentId);
        const rows = this.db.prepare('SELECT id FROM claim_occurrences WHERE document_id=? ORDER BY seq LIMIT 1001').all(documentId);
        if (rows.length > 1000)
            throw new WriterError('INVALID_INPUT', 'This prototype lists at most 1000 claim occurrences per document. Export or select records explicitly.');
        const decisions = this.decisions(documentId);
        return rows.map(row => {
            const c = this.occurrence(String(row.id));
            const events = decisions.filter(d => d.occurrenceId === c.id);
            const decision = events.filter(d => ['confirm', 'dismiss', 'correct'].includes(d.action)).at(-1);
            const important = decisions.filter(d => d.claimId === c.claimId && ['important', 'unimportant'].includes(d.action)).at(-1)?.action === 'important';
            return { ...c, annotation: decision?.action === 'dismiss' ? 'dismissed' : decision?.action === 'correct' ? 'superseded' : decision?.action === 'confirm' || c.origin === 'manual' ? 'confirmed' : 'candidate',
                state: this.current(c) ? 'current' : 'stale', important, truth: 'not-certified', decisions: events };
        });
    }
    private addOccurrence(documentId: string, revision: Revision, candidate: ClaimCandidate, origin: ClaimOccurrence['origin'], runId: string | null, existingClaimId?: string): ClaimOccurrence {
        validateCandidate(candidate, revision.snapshot);
        let claimId = existingClaimId;
        if (claimId) {
            const row = this.db.prepare('SELECT document_id FROM ledger_claims WHERE id=?').get(claimId);
            if (row?.document_id !== documentId)
                throw new WriterError('INVALID_INPUT', 'A claim cannot cross document boundaries.');
        }
        else {
            claimId = newId('clm');
            this.db.prepare('INSERT INTO ledger_claims(id,document_id,created_at) VALUES(?,?,?)').run(claimId, documentId, now());
        }
        const c: ClaimOccurrence = { id: newId('occ'), claimId, documentId, revisionId: revision.id, statement: candidate.statement, kind: candidate.kind,
            anchors: candidate.anchors.map(a => pinAnchor(revision.snapshot, a)), origin, runId, createdAt: now() };
        this.insert('claim_occurrences', c.id, c, { claim_id: claimId, document_id: documentId, revision_id: revision.id, run_id: runId });
        return c;
    }
    add(documentId: string, candidate: ClaimCandidate, claimId?: string): ClaimOccurrence {
        this.ready();
        return this.transaction(() => this.addOccurrence(documentId, this.host.currentRevision(documentId), candidate, 'manual', null, claimId));
    }
    decide(occurrenceId: string, action: ClaimDecisionAction, reason: string, replacement?: ClaimCandidate): ClaimDecision {
        this.ready();
        analysisString(reason, 'decision reason');
        if (!['confirm', 'dismiss', 'correct', 'important', 'unimportant'].includes(action))
            throw new WriterError('INVALID_INPUT', 'Unknown annotation decision.');
        if ((action === 'correct') !== (replacement !== undefined))
            throw new WriterError('INVALID_INPUT', 'Only a correction requires a replacement annotation.');
        return this.transaction(() => {
            const c = this.occurrence(occurrenceId);
            if (!this.current(c))
                throw new WriterError('STALE_REVISION', 'Claim text changed; annotate the new revision instead.');
            const state = this.list(c.documentId).find(o => o.id === c.id);
            if (state?.annotation === 'superseded')
                throw new WriterError('INVALID_TRANSITION', 'Use the replacement occurrence; this annotation was superseded.');
            if (action === 'important' && state?.annotation !== 'confirmed')
                throw new WriterError('INVALID_TRANSITION', 'Confirm a candidate annotation before marking its claim important.');
            const next = replacement ? this.addOccurrence(c.documentId, this.host.currentRevision(c.documentId), replacement, 'manual', null, c.claimId) : null;
            const d: ClaimDecision = { id: newId('acd'), claimId: c.claimId, occurrenceId, action, reason, replacementOccurrenceId: next?.id ?? null, createdAt: now() };
            this.insert('claim_decisions', d.id, d, { claim_id: c.claimId, occurrence_id: occurrenceId, document_id: c.documentId });
            return d;
        });
    }
    prepare(documentId: string, task: AnalysisRequest['task'], options: {
        instruction: string;
        blockIds?: readonly string[];
        changeIds?: readonly string[];
        documentScope?: boolean;
        selection?: SourceSelection;
        memoryOptions?: MemoryOptions;
        useMemory?: boolean;
    }): AnalysisRequest {
        this.ready();
        const revision = this.host.currentRevision(documentId);
        analysisString(options.instruction, 'instruction', 10000);
        const changeIds = options.changeIds ?? [], blockIds = options.blockIds ?? [];
        stringIds(changeIds);
        stringIds(blockIds, 10000);
        if (task !== 'claim-extraction' && task !== 'semantic-review')
            throw new WriterError('INVALID_INPUT', 'Unknown analysis task.');
        if ((task === 'semantic-review' && (!changeIds.length || blockIds.length)) || (task === 'claim-extraction' && (changeIds.length || (!options.documentScope && !blockIds.length))))
            throw new WriterError('INVALID_INPUT', 'Choose pending changes for review, or explicit blocks / full document for extraction.');
        if (options.documentScope && blockIds.length)
            throw new WriterError('INVALID_INPUT', 'Full document and selected-block scopes are mutually exclusive.');
        let projected = revision.snapshot;
        const selectedChanges = changeIds.map(id => { const c = this.host.getChange(id); if (c.documentId !== documentId)
            throw new WriterError('INVALID_INPUT', 'Review changes must belong to one document.'); projected = applyChange(projected, c); return c; });
        const selected = options.documentScope ? revision.snapshot.blocks.map(b => b.id) : task === 'semantic-review' ? selectedChanges.map(c => c.blockId) : [...blockIds];
        if (new Set(selected).size !== selected.length)
            throw new WriterError('INVALID_INPUT', 'Review batch cannot edit one block twice.');
        if (selected.some(id => !revision.snapshot.blocks.some(b => b.id === id)))
            throw new WriterError('NOT_FOUND', 'Selected block not found.');
        const view = (s: Snapshot): Snapshot => ({ blocks: s.blocks.filter(b => selected.includes(b.id)) });
        const memory = task === 'semantic-review' && this.host.info().schemaVersion >= 4 && options.useMemory !== false ? this.host.memory.plan(documentId,'review',options.memoryOptions) : undefined;
        if(memory?.conflicts.length)throw new WriterError('GUIDANCE_CONFLICT','Resolve conflicting author guidance before analysis.');
        const intentImportantIds = new Set(memory?.capture.packet.importantClaims.map(c=>c.occurrenceId) ?? []);
        const ledger = this.list(documentId), importantIds = [...new Set(ledger.filter(c => c.important || intentImportantIds.has(c.id)).map(c => c.claimId))];
        const chosen = ledger.filter(c => (c.important || intentImportantIds.has(c.id)) && c.annotation === 'confirmed' && c.state === 'current' && c.anchors.every(a => selected.includes(a.blockId)));
        return captureAnalysisRequest({ ...(memory ? {memory:memory.capture} : {}), protocolVersion: 1, task, documentId, baseRevisionId: revision.id, instruction: options.instruction,
            scope: options.documentScope ? 'document' : 'blocks', documentBlockCount: revision.snapshot.blocks.length, before: view(revision.snapshot), after: task === 'semantic-review' ? view(projected) : null,
            changes: selectedChanges.map(c => ({ id: c.id, hash: hashBytes(JSON.stringify(c)) })), sources: this.host.sources.context(options.selection ?? {}),
            protectedClaims: chosen.map(c => ({ claimId: c.claimId, occurrenceId: c.id, statement: c.statement, anchors: c.anchors.map(({ blockId, start, end, quote }) => ({ blockId, start, end, quote })) })),
            excludedProtectedClaimIds: importantIds.filter(id => !chosen.some(c => c.claimId === id)), ledgerStamp: this.stamp(documentId) });
    }
    assertFresh(request: AnalysisRequest): void { this.ready(); captureAnalysisRequest(request); this.verifyRequest(request); }
    private verifyRequest(request: AnalysisRequest): void {
        if (this.host.currentRevision(request.documentId).id !== request.baseRevisionId || this.stamp(request.documentId) !== request.ledgerStamp || request.changes.some(c => hashBytes(JSON.stringify(this.host.getChange(c.id))) !== c.hash))
            throw new WriterError('STALE_REVISION', 'Captured analysis inputs are stale. No current report was saved.');
        if(request.memory)this.host.memory.assertFresh(request.memory);
        const nowRequest = this.prepare(request.documentId, request.task, { instruction: request.instruction, documentScope: request.scope === 'document', useMemory: request.memory!==undefined, ...(request.memory ? {memoryOptions:optionsFromCapture(request.memory.options)} : {}),
            ...(request.task === 'claim-extraction' && request.scope === 'blocks' ? { blockIds: request.before.blocks.map(b => b.id) } : {}),
            changeIds: request.changes.map(c => c.id), selection: { snapshots: request.sources.filter(s => s.excerptId === null).map(s => s.snapshotId), excerpts: request.sources.filter(s => s.excerptId !== null).map(s => s.excerptId!) } });
        // Preserve source selection order exactly; context() deterministically groups snapshots then excerpts.
        if (JSON.stringify(nowRequest) !== JSON.stringify(request))
            throw new WriterError('STALE_REVISION', 'Document, pending changes, selected context or claim decisions changed. Start a fresh analysis.');
        this.host.sources.verifyContext(request.sources);
    }
    save(request: AnalysisRequest, output: unknown, provider: AnalysisProviderInfo, usage: AnalysisUsage | null, durationMs: number): AnalysisRun {
        this.ready();
        const retained = captureAnalysisRequest(request), checked = validateAnalysisOutput(output, retained), info = safeProvider(provider), tokens = safeUsage(usage);
        if (!Number.isSafeInteger(durationMs) || durationMs < 0)
            throw new WriterError('INVALID_INPUT', 'Invalid run duration.');
        return this.transaction(() => {
            this.verifyRequest(retained);
            const run: AnalysisRun = { id: newId('run'), documentId: retained.documentId, baseRevisionId: retained.baseRevisionId,
                request: retained, output: checked, provider: info, usage: tokens, durationMs, promptVersion: retained.memory ? 'analysis-memory-v1' : 'analysis-v1', status: 'completed', interpretation: 'model-assessment-not-verified', createdAt: now() };
            this.insert('analysis_runs', run.id, run, { document_id: run.documentId, revision_id: run.baseRevisionId, task: run.request.task });
            if (checked.task === 'claim-extraction') {
                const revision = this.host.getRevision(run.baseRevisionId);
                for (const c of checked.candidates)
                    this.addOccurrence(run.documentId, revision, c, 'model-candidate', run.id);
            }
            return run;
        });
    }
    run(id: string): AnalysisRun {
        const run = this.record<AnalysisRun>('analysis_runs', id);
        try {
            if (run.id !== id || run.documentId !== run.request.documentId || run.baseRevisionId !== run.request.baseRevisionId || run.status !== 'completed')
                throw Error();
            captureAnalysisRequest(run.request);
            validateAnalysisOutput(run.output, run.request);
            safeProvider(run.provider);
            safeUsage(run.usage);
            this.host.sources.verifyContext(run.request.sources);
        }
        catch {
            throw new WriterError('CORRUPT_DATA', 'Saved analysis or pinned evidence failed validation.');
        }
        return run;
    }
    runs(documentId: string) {
        this.ready();
        this.host.currentRevision(documentId);
        return this.db.prepare('SELECT id FROM analysis_runs WHERE document_id=? ORDER BY seq DESC LIMIT 100').all(documentId).map(r => { const run = this.run(String(r.id)); return { id: run.id, task: run.request.task, createdAt: run.createdAt, baseRevisionId: run.baseRevisionId, model: run.provider.model }; });
    }
    report(id: string) {
        const run = this.run(id);
        let freshness: 'current' | 'stale' = 'current';
        // Extraction itself adds candidates; its own ledger stamp change is expected. Document and pending targets still govern freshness.
        if (this.host.currentRevision(run.documentId).id !== run.baseRevisionId)
            freshness = 'stale';
        if (run.request.task === 'semantic-review' && this.stamp(run.documentId) !== run.request.ledgerStamp)
            freshness = 'stale';
        for (const c of run.request.changes)
            if (hashBytes(JSON.stringify(this.host.getChange(c.id))) !== c.hash)
                freshness = 'stale';
        if(run.request.memory){try{this.host.memory.assertFresh(run.request.memory);}catch{freshness='stale';}}
        const feedback = this.db.prepare('SELECT payload,payload_hash FROM analysis_feedback WHERE run_id=? ORDER BY seq').all(id).map(r => unpack<FindingDecision>(r));
        const output = run.output;
        const evidenceView = output.task === 'semantic-review' ? (['before', 'after'] as const).flatMap(side => (side === 'before' ? output.beforeClaims : output.afterClaims).map(c => {
            const assessment = output.assessments.find(a => a.side === side && a.claimRef === c.ref);
            return { side, claimRef: c.ref, relation: assessment?.relation ?? 'not-assessed', origin: assessment ? 'model-assessment-not-verified' : 'no-assessment-returned' };
        })) : [];
        return { ...run, freshness, writingGuidance: run.request.memory ? 'captured-not-guaranteed' : 'not-captured', observations: analysisObservations(run.request), evidenceView, feedback,
            notice: 'Model findings/mappings/evidence relations are assessments, not facts. Missing assessments mean not-assessed. Empty findings do not mean safe to accept. Review feedback does not alter text.' };
    }
    feedback(runId: string, findingRef: string, action: FindingDecision['action'], reason: string, correction: string | null = null): FindingDecision {
        this.ready();
        analysisString(reason, 'feedback reason');
        if (!['agree', 'disagree', 'needs-review', 'correct'].includes(action))
            throw new WriterError('INVALID_INPUT', 'Unknown feedback action.');
        if (action === 'correct') {
            analysisString(correction, 'correction');
        }
        else if (correction !== null)
            throw new WriterError('INVALID_INPUT', 'Correction text belongs only to correct.');
        return this.transaction(() => {
            const run = this.run(runId);
            if (run.output.task !== 'semantic-review')
                throw new WriterError('NOT_FOUND', 'This is not a semantic review report.');
            const positional = /^(mapping|assessment):(0|[1-9][0-9]*)$/.exec(findingRef);
            const valid = positional ? Number(positional[2]) < (positional[1] === 'mapping' ? run.output.mappings.length : run.output.assessments.length) : run.output.findings.some(f => f.ref === findingRef);
            if (!valid)
                throw new WriterError('NOT_FOUND', 'Finding, mapping or assessment does not belong to this immutable report.');
            const f: FindingDecision = { id: newId('afb'), runId, findingRef, action, reason, correction, documentRevisionAtDecision: this.host.currentRevision(run.documentId).id, createdAt: now() };
            this.insert('analysis_feedback', f.id, f, { run_id: runId });
            return f;
        });
    }
    assess(occurrenceId: string, selection: SourceSelection, relation: EvidenceRelation, sourceQuotes: readonly SourceQuote[], explanation: string): HumanEvidenceAssessment {
        this.ready();
        analysisString(explanation);
        return this.transaction(() => {
            const c = this.occurrence(occurrenceId), sources = this.host.sources.context(selection);
            validateEvidence(relation, sourceQuotes, sources);
            const a: HumanEvidenceAssessment = { id: newId('eva'), occurrenceId, sources, relation, sourceQuotes: structuredClone(sourceQuotes), explanation, origin: 'human-assessment', createdAt: now() };
            this.insert('claim_evidence', a.id, a, { occurrence_id: c.id });
            return a;
        });
    }
    evidence(occurrenceId: string) {
        const c = this.occurrence(occurrenceId);
        return this.db.prepare('SELECT payload,payload_hash FROM claim_evidence WHERE occurrence_id=? ORDER BY seq').all(occurrenceId).map(r => {
            const a = unpack<HumanEvidenceAssessment>(r);
            this.host.sources.verifyContext(a.sources);
            validateSourceQuotes(a.sourceQuotes, a.sources);
            validateEvidence(a.relation, a.sourceQuotes, a.sources);
            return { ...a, state: this.current(c) ? 'current' : 'stale', truth: 'not-certified' };
        });
    }
}
