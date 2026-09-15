// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '@writer-agent/storage';
import { OllamaProvider } from '@writer-agent/models';
import type { AnalysisRequest, AnalysisOutput, ClaimCandidate } from '@writer-agent/core';
import { runAnalysis } from './analysis-command.js';
/** Deliberately scripted fixture for demos/tests; NOT a language model or a semantic detector. */
export function reviewFixture(r: Pick<AnalysisRequest, 'task' | 'documentId' | 'baseRevisionId' | 'before' | 'after' | 'sources' | 'protectedClaims'>): AnalysisOutput {
    const b = r.before.blocks[0];
    if (!b)
        throw Error('Empty fixture');
    const candidate = (block: typeof b, ref: string): ClaimCandidate => ({ ref, statement: block.text, kind: 'inference', anchors: [{ blockId: block.id, start: 0, end: block.text.length, quote: block.text }] });
    const before = candidate(b, 'c1');
    if (r.task === 'claim-extraction')
        return { protocolVersion: 1, task: r.task, documentId: r.documentId, baseRevisionId: r.baseRevisionId, candidates: [before], notes: ['Synthetic candidate, not real inference.'] };
    const a = r.after?.blocks[0];
    if (!a)
        throw Error('Missing fixture after');
    const after = candidate(a, 'c2');
    const quotes = r.sources[0] ? [{ itemIndex: 0, start: 0, end: r.sources[0].text.length, quote: r.sources[0].text }] : [];
    return { protocolVersion: 1, task: r.task, documentId: r.documentId, baseRevisionId: r.baseRevisionId,
        beforeClaims: [before], afterClaims: [after], mappings: [{ beforeRefs: ['c1'], afterRefs: ['c2'], relation: 'reformulated', explanation: 'Prewritten demo mapping, not a measured semantic judgment.' }],
        findings: [{ ref: 'f1', category: 'certainty', before: before.anchors, after: after.anchors, beforeRefs: ['c1'], afterRefs: ['c2'], sourceQuotes: quotes, importantClaimIds: [], explanation: 'Fixture opinion: removing the qualifier may increase certainty. Check the actual wording.' }],
        assessments: [{ side: 'after', claimRef: 'c2', relation: quotes.length ? 'insufficient' : 'not-assessed', sourceQuotes: quotes, explanation: quotes.length ? 'Fixture opinion: selected material does not establish certainty.' : 'No evidence was selected.' }], notes: ['Scripted fake HTTP response. NOT a real AI evaluation.'] };
}
export async function reviewDemo(directory?: string): Promise<void> {
    const root = directory ?? mkdtempSync(join(tmpdir(), 'siglum-review-'));
    const w = Workspace.create(root, 'Synthetic semantic review demonstration');
    const server = createServer((req, res) => {
        void (async () => {
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const part of req) {
                const b = Buffer.from(part as Uint8Array);
                size += b.length;
                if (size > 1000000)
                    throw Error('Fixture bound');
                chunks.push(b);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
                messages: {
                    role: string;
                    content: string;
                }[];
            };
            const user = body.messages.find(m => m.role === 'user');
            if (!user)
                throw Error();
            const input = JSON.parse(user.content) as AnalysisRequest;
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(reviewFixture(input)) } }));
        })().catch(() => { res.writeHead(500); res.end(); });
    });
    try {
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        const addr = server.address();
        if (!addr || typeof addr === 'string')
            throw Error('Fixture listener');
        const p = new OllamaProvider({ model: 'synthetic-fixture', baseURL: `http://127.0.0.1:${addr.port}` });
        const d = w.createDocument('Fictional example', '这项工具可能影响部分岗位。\n\n另一段保持不变。');
        const source = w.sources.add({ kind: 'file', locator: 'fictional-evidence.txt', raw: Buffer.from('示例材料只讨论可能性，没有确定因果结论。'), mediaType: 'text/plain' });
        const excerpt = w.sources.extract(source.snapshot.id, 1, 1), selection = { excerpts: [excerpt.id] };
        const extraction = w.analysis.prepare(d.id, 'claim-extraction', { instruction: 'Extract example claims.', documentScope: true });
        await runAnalysis(w, extraction, p);
        const occurrence = w.analysis.list(d.id)[0]!;
        w.analysis.decide(occurrence.id, 'confirm', 'Confirms the annotation, not the claim truth.');
        w.analysis.decide(occurrence.id, 'important', 'Keep the uncertainty.');
        const rev = w.currentRevision(d.id), block = rev.snapshot.blocks[0]!;
        const change = w.proposeChanges(d.id, rev.id, [{ blockId: block.id, before: block.text, after: '这项工具影响岗位。', summary: 'Fictional strengthening for review' }])[0]!;
        const input = w.analysis.prepare(d.id, 'semantic-review', { instruction: 'Check changes without rewriting.', changeIds: [change.id], selection });
        const original = w.markdown(d.id), run = await runAnalysis(w, input, p);
        assert.equal(run.freshness, 'current');
        assert.equal(w.markdown(d.id), original);
        w.analysis.feedback(run.id, 'f1', 'disagree', 'Demonstrates author disagreement without changing text.');
        assert.equal(w.markdown(d.id), original);
        w.accept(change.id, 'Separate explicit text decision.');
        assert.equal(w.analysis.report(run.id).freshness, 'stale');
        w.revert(change.id, 'Restore qualifier.');
        assert.equal(w.markdown(d.id), original);
        assert.equal(w.analysis.report(run.id).freshness, 'stale');
        w.close();
        const reopened = Workspace.open(root);
        try {
            assert.equal(reopened.analysis.report(run.id).feedback.length, 1);
            assert.equal(reopened.analysis.run(run.id).usage, null);
        }
        finally {
            reopened.close();
        }
        console.log(JSON.stringify({ fixture: true, root, reportId: run.id, manuscriptRestored: true, feedbackPreserved: true, realInference: false }, null, 2));
        console.log('REVIEW_DEMO_OK');
    }
    finally {
        w.close();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}
