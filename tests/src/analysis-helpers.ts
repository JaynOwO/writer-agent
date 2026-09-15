// SPDX-License-Identifier: Apache-2.0
import { importMarkdown, hashBytes } from '@writer-agent/core';
import type { AnalysisRequest, ClaimCandidate, AnalysisProviderInfo, Snapshot } from '@writer-agent/core';
import type { AnalysisProvider } from '@writer-agent/models';
const cli = new URL('../../apps/cli/dist/', import.meta.url);
export const { reviewFixture } = await import(new URL('review-demo.js', cli).href) as typeof import('../../apps/cli/src/review-demo.js');
export const { runAnalysis, parseAnalysisArgs, claimCommand, reviewCommand } = await import(new URL('analysis-command.js', cli).href) as typeof import('../../apps/cli/src/analysis-command.js');
export function analysisRequest(task: AnalysisRequest['task'] = 'semantic-review', text = '甲可能成立。\r\n\r\n乙。'): AnalysisRequest {
    const before = importMarkdown(text), after = { blocks: before.blocks.map((b, i) => i === 0 ? { ...b, text: '甲成立。', version: b.version + 1 } : b) };
    return { protocolVersion: 1, task, documentId: 'doc_test', baseRevisionId: 'rev_test', instruction: 'Compare meaning; do not edit.', scope: 'document', documentBlockCount: before.blocks.length,
        before, after: task === 'semantic-review' ? after : null, changes: task === 'semantic-review' ? [{ id: 'chg_test', hash: hashBytes('synthetic') }] : [], sources: [], protectedClaims: [], excludedProtectedClaimIds: [], ledgerStamp: hashBytes('ledger') };
}
export function candidate(snapshot: Snapshot, index = 0, ref = 'c1'): ClaimCandidate { const b = snapshot.blocks[index]!; return { ref, statement: b.text, kind: 'inference', anchors: [{ blockId: b.id, start: 0, end: b.text.length, quote: b.text }] }; }
export const providerInfo: AnalysisProviderInfo = { providerId: 'test/fake', model: 'synthetic', endpoint: 'http://127.0.0.1:1/api/chat', responseFormat: 'json-schema', tokenParameter: null, timeoutMs: 1000, maxOutputTokens: 4096 };
export function scripted(transform?: (r: AnalysisRequest) => Promise<unknown>): AnalysisProvider {
    const reply = async (r: AnalysisRequest) => transform ? await transform(r) : { providerId: providerInfo.providerId, output: reviewFixture(r), usage: null };
    return { id: providerInfo.providerId, describe: () => ({ provider: 'ollama', ...providerInfo, tokenParameter: 'max_tokens' }),
        extractClaims: async (r) => await reply(r) as Awaited<ReturnType<AnalysisProvider['extractClaims']>>,
        reviewChanges: async (r) => await reply(r) as Awaited<ReturnType<AnalysisProvider['reviewChanges']>> };
}
