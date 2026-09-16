// SPDX-License-Identifier: Apache-2.0
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { WriterError, captureAnalysisRequest, analysisObservations, analysisString, exactObject, stringIds } from '@writer-agent/core';
import type { AnalysisRequest, ClaimCandidate, FindingDecision, ClaimDecisionAction, EvidenceRelation, SourceQuote, SourceSelection } from '@writer-agent/core';
import { Workspace } from '@writer-agent/storage';
import { checkCancelled, validateAnalysisResponse, analysisProviderInfo, parseAnalysisJson } from '@writer-agent/models';
import type { AnalysisProvider } from '@writer-agent/models';
import { parseSuggestArgs } from './suggest.js';
export const analysisHelp = `Siglum claims & semantic review v1 — assessments, not fact certificates

  writer claim add <workspace> <documentId> <annotation.json> [--claim <claimId>]
  writer claim list <workspace> <documentId>
  writer claim show <workspace> <occurrenceId>
  writer claim confirm|dismiss|important|unimportant <workspace> <occurrenceId> <reason>
  writer claim correct <workspace> <occurrenceId> <annotation.json> <reason>
  writer claim assess <workspace> <occurrenceId> <evidence.json>
  writer claim evidence <workspace> <occurrenceId>
  writer claim extract <workspace> <documentId> --blocks <id,...>|--document-scope <provider-options>
  writer review run <workspace> <documentId> --changes <id,...> [--document-scope] <provider-options>
  writer review list <workspace> <documentId>
  writer review show <workspace> <runId>
  writer review export <workspace> <runId> <new-report.json>
  writer review decide <workspace> <runId> <findingRef|mapping:N|assessment:N> agree|disagree|needs-review|correct <reason> [correction]

Provider options are the same as suggest: --provider, --model, --instruction OR --instruction-file,
--base-url, --key-env, --sources, --excerpts, --timeout-ms, --max-output-tokens,
--response-format, --token-parameter. Preview is default. --send opts into THIS request;
remote additionally needs --allow-remote. No implicit retry, source fetch, model download or paid call.
Reports may locate sentences; text acceptance/revert remains block-level. See docs/review.md.
`;
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
function count(args: readonly string[], min: number, max = min): void { if (args.length < min || args.length > max)
    throw new WriterError('INVALID_INPUT', 'Wrong number of analysis arguments. Run writer claim help or writer review help.'); }
function readJson(path: string): unknown {
    try {
        const file = resolve(path), stat = statSync(file);
        if (!stat.isFile() || stat.size > 1000000)
            throw Error();
        return parseAnalysisJson(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file)));
    }
    catch {
        throw new WriterError('INVALID_INPUT', 'Input must be a readable UTF-8 JSON file, at most 1 MB, with unique keys.');
    }
}
/** Application-owned inputs and identity are pinned before calling an untrusted provider. */
export async function runAnalysis(workspace: Workspace, input: AnalysisRequest, provider: AnalysisProvider, signal?: AbortSignal) {
    checkCancelled(signal);
    const request = captureAnalysisRequest(input), providerId = provider.id, info = analysisProviderInfo(provider);
    workspace.analysis.assertFresh(request);
    const start = performance.now();
    const response: unknown = request.task === 'claim-extraction' ? await provider.extractClaims(structuredClone(request), signal) : await provider.reviewChanges(structuredClone(request), signal);
    checkCancelled(signal);
    const checked = validateAnalysisResponse(response, request, providerId);
    const run = workspace.analysis.save(request, checked.output, info, checked.usage, Math.max(0, Math.round(performance.now() - start)));
    return workspace.analysis.report(run.id);
}
export function parseAnalysisArgs(args: string[], task: AnalysisRequest['task']) {
    count(args, 2, 100);
    const [directory, documentId, ...flags] = args;
    analysisString(directory, 'workspace', 4096);
    analysisString(documentId, 'documentId', 200);
    let documentScope = false;
    const specials = new Map<string, string>();
    const pass: string[] = [];
    const paired = new Set(['--provider', '--model', '--instruction', '--instruction-file', '--base-url', '--key-env', '--sources', '--excerpts', '--timeout-ms', '--max-output-tokens', '--response-format', '--token-parameter', '--language', '--preferences', '--examples', '--exceptions-file', '--waive-required']);
    for (let i = 0; i < flags.length; i++) {
        const flag = flags[i]!;
        if (flag === '--document-scope') {
            if (documentScope)
                throw new WriterError('INVALID_INPUT', 'Duplicate scope flag.');
            documentScope = true;
            continue;
        }
        if (flag === '--blocks' || flag === '--changes') {
            if (specials.has(flag))
                throw new WriterError('INVALID_INPUT', 'Duplicate selection option.');
            const val = flags[++i];
            if (!val || val.startsWith('--'))
                throw new WriterError('INVALID_INPUT', 'Selection option needs a value.');
            specials.set(flag, val);
            continue;
        }
        if (paired.has(flag)) {
            const val = flags[++i];
            if (val === undefined || val.startsWith('--'))
                throw new WriterError('INVALID_INPUT', 'Option needs a value.');
            pass.push(flag, val);
            continue;
        }
        if (flag === '--send' || flag === '--allow-remote') {
            pass.push(flag);
            continue;
        }
        throw new WriterError('INVALID_INPUT', 'Unknown analysis option. Literal API keys are not accepted.');
    }
    if (task === 'claim-extraction' && specials.has('--changes') || task === 'semantic-review' && specials.has('--blocks'))
        throw new WriterError('INVALID_INPUT', 'Wrong selection kind for this analysis task.');
    const ids = (key: string) => { const raw = specials.get(key); if (raw === undefined)
        return []; const values = raw.split(','); stringIds(values, 10000); if (values.some(v => v.trim() !== v))
        throw new WriterError('INVALID_INPUT', 'Comma-separated IDs must not include surrounding spaces.'); return values; };
    const blockIds = ids('--blocks'), changeIds = ids('--changes');
    if (task === 'claim-extraction' && (documentScope === !!blockIds.length) || task === 'semantic-review' && !changeIds.length)
        throw new WriterError('INVALID_INPUT', 'Extraction requires blocks OR document scope; review requires explicit changes.');
    const options=parseSuggestArgs([directory,documentId,...pass]);
    if(task==='claim-extraction'&&Object.values(options.memoryOptions).some(v=>Array.isArray(v)?v.length:v!==undefined))throw new WriterError('INVALID_INPUT','Writing-memory selections apply to semantic review, not claim extraction.');
    return {...options,documentScope,blockIds,changeIds};
}
async function modelAnalysisCommand(args: string[], task: AnalysisRequest['task']): Promise<void> {
    const options = parseAnalysisArgs(args, task), workspace = Workspace.open(options.directory), controller = new AbortController(), cancel = () => controller.abort();
    try {
        const request = workspace.analysis.prepare(options.documentId, task, options);
        if (!options.send) {
            print({ status: 'preview-only', sent: false, task, provider: options.provider.describe(), documentId: request.documentId, baseRevisionId: request.baseRevisionId,
                writingMemory: request.memory?.packet ?? null, scope: request.scope, blockIds: request.before.blocks.map(b => b.id), documentBlockCount: request.documentBlockCount, requestBytes: Buffer.byteLength(JSON.stringify(request), 'utf8'),
                sourceSelection: request.sources.map(({ text, ...s }) => ({ ...s, bytes: Buffer.byteLength(text, 'utf8') })), protectedClaimIds: [...new Set(request.protectedClaims.map(c => c.claimId))], excludedProtectedClaimIds: request.excludedProtectedClaimIds,
                notice: 'No inference was requested. --send transmits the inspected before/after text, brief, explicit sources and listed protected claims. May incur provider charges; loopback does not prove local inference.' });
            return;
        }
        process.once('SIGINT', cancel);
        process.once('SIGTERM', cancel);
        print(await runAnalysis(workspace, request, options.provider, controller.signal));
    }
    finally {
        process.removeListener('SIGINT', cancel);
        process.removeListener('SIGTERM', cancel);
        workspace.close();
    }
}
export async function claimCommand(args: string[]): Promise<void> {
    const [action = 'help', ...rest] = args;
    if (action === 'help') {
        count(rest, 0);
        console.log(analysisHelp);
        return;
    }
    if (action === 'extract') {
        await modelAnalysisCommand(rest, 'claim-extraction');
        return;
    }
    const limits: Record<string, readonly [
        number,
        number
    ]> = { add: [3, 5], list: [2, 2], show: [2, 2], confirm: [3, 3], dismiss: [3, 3], important: [3, 3], unimportant: [3, 3], correct: [4, 4], assess: [3, 3], evidence: [2, 2] };
    if (!Object.hasOwn(limits, action))
        throw new WriterError('INVALID_INPUT', 'Unknown claim command.');
    const limit = limits[action]!;
    count(rest, ...limit);
    const [directory, target, extra, last, id] = rest;
    analysisString(directory);
    analysisString(target);
    const w = Workspace.open(directory);
    try {
        switch (action) {
            case 'add':
                if (rest.length !== 3 && (rest.length !== 5 || last !== '--claim'))
                    throw new WriterError('INVALID_INPUT', 'Use --claim <ID> only to add an explicitly equivalent occurrence.');
                print(w.analysis.add(target, readJson(extra!) as ClaimCandidate, id));
                break;
            case 'list':
                print(w.analysis.list(target));
                break;
            case 'show': {
                const c = w.analysis.occurrence(target);
                print(w.analysis.list(c.documentId).find(o => o.id === target));
                break;
            }
            case 'correct':
                print(w.analysis.decide(target, 'correct', last!, readJson(extra!) as ClaimCandidate));
                break;
            case 'evidence':
                print(w.analysis.evidence(target));
                break;
            case 'assess': {
                const input = readJson(extra!);
                exactObject(input, ['selection', 'relation', 'sourceQuotes', 'explanation']);
                print(w.analysis.assess(target, input.selection as SourceSelection, input.relation as EvidenceRelation, input.sourceQuotes as SourceQuote[], input.explanation as string));
                break;
            }
            default: print(w.analysis.decide(target, action as ClaimDecisionAction, extra!));
        }
    }
    finally {
        w.close();
    }
}
export async function reviewCommand(args: string[]): Promise<void> {
    const [action = 'help', ...rest] = args;
    if (action === 'help') {
        count(rest, 0);
        console.log(analysisHelp);
        return;
    }
    if (action === 'run') {
        await modelAnalysisCommand(rest, 'semantic-review');
        return;
    }
    const limits: Record<string, readonly [
        number,
        number
    ]> = { list: [2, 2], show: [2, 2], export: [3, 3], decide: [5, 6] };
    if (!Object.hasOwn(limits, action))
        throw new WriterError('INVALID_INPUT', 'Unknown review command.');
    const limit = limits[action]!;
    count(rest, ...limit);
    const [directory, target, extra, fourth, fifth, sixth] = rest;
    analysisString(directory);
    analysisString(target);
    const w = Workspace.open(directory);
    try {
        if (action === 'list')
            print(w.analysis.runs(target));
        else if (action === 'decide')
            print(w.analysis.feedback(target, extra!, fourth as FindingDecision['action'], fifth!, sixth ?? null));
        else {
            const report = w.analysis.report(target);
            if (action === 'show')
                print(report);
            else {
                writeFileSync(resolve(extra!), JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
                print({ status: 'exported', manuscriptChanged: false });
            }
        }
    }
    finally {
        w.close();
    }
}
/** Helpful for callers constructing an offline exact diff without invoking a model. */
export const observationsForReview = analysisObservations;
