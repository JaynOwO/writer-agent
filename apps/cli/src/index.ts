#!/usr/bin/env node
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { MAX_DOCUMENT_BYTES, WriterError, isRecord, requireString, validateEdits } from '@writer-agent/core';
import { Workspace, migrateWorkspace } from '@writer-agent/storage';
import { demo } from './demo.js';
import { ProviderError } from '@writer-agent/models';
import { suggestCommand } from './suggest.js';
import { sourceCommand } from './source-command.js';
import { sourcesDemo } from './sources-demo.js';
import { claimCommand, reviewCommand } from './analysis-command.js';
import { reviewDemo } from './review-demo.js';

const help = `Siglum v0.0.4 (CLI development preview; no API key needed for demos/tests)

  writer help
  writer claim help
  writer review help
  writer demo:review
  writer source help
  writer migrate <workspace> [--apply]
  writer provenance <workspace> <changeId>
  writer demo:sources
  writer model
  writer suggest <workspace> <documentId> --provider ollama|openai-compatible
    --model <model-id> --instruction <text> [--send] [--allow-remote]
    [--sources <snapshotId,...>] [--excerpts <excerptId,...>]
    [--base-url <api-base>] [--key-env <ENV_NAME>] [--timeout-ms <ms>]
    [--max-output-tokens <n>] [--response-format json-schema|json|prompt]
    [--token-parameter max_completion_tokens|max_tokens]
    Use --instruction-file <utf8-file> instead of --instruction for long text.
    Without --send: preview only. With --send: ONLY save validated pending edits.
  writer demo [new-workspace-directory]
  writer init <new-workspace-directory> [name]
  writer import <workspace> <input.md> [title]
  writer list <workspace>
  writer show <workspace> <documentId>
  writer propose <workspace> <documentId> <proposal.json>
  writer changes <workspace> <documentId>
  writer accept <workspace> <changeId> [reason]
  writer reject <workspace> <changeId> [reason]
  writer revert <workspace> <changeId> [reason]
  writer history <workspace> <documentId>
  writer decisions <workspace> <documentId>
  writer export <workspace> <documentId> <new-output.md>

Run from source with: pnpm writer <command> ... (run pnpm build first).
See docs/cli.md and docs/providers.md. Only suggest/claim extract/review run --send make model requests. source add/refresh --fetch explicitly retrieves a public page. No command pushes Git.
Product brand: Siglum. pnpm siglum is an alias for pnpm writer; repository and package IDs stay writer-agent.
`;
function print(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
function readUtf8(path: string): string {
  const file = resolve(path);
  const stat = statSync(file);
  if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES * 4) throw new WriterError('INVALID_INPUT', 'Input must be a regular UTF-8 file smaller than 8 MB.');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(file)); }
  catch { throw new WriterError('INVALID_INPUT', 'Cannot decode file as UTF-8.'); }
}
function requireArgs(args: string[], min: number, max = min): void {
  if (args.length < min || args.length > max) throw new WriterError('INVALID_INPUT', 'Wrong number of arguments. Run "pnpm writer help". Quote paths and reasons containing spaces.');
}
async function main(args: string[]): Promise<void> {
  const [command = 'help', ...rest] = args;
  if (command === 'help' || command === '--help' || command === '-h') { console.log(help); return; }
  if (command === 'claim') { await claimCommand(rest); return; }
  if (command === 'review') { await reviewCommand(rest); return; }
  if (command === 'demo:review') { requireArgs(rest,0); await reviewDemo(); return; }
  if (command === 'source') { await sourceCommand(rest); return; }
  if (command === 'demo:sources') { requireArgs(rest,0); await sourcesDemo(); return; }
  if (command === 'migrate') {
    requireArgs(rest,1,2);
    if (rest[1] !== undefined && rest[1] !== '--apply') throw new WriterError('INVALID_INPUT','Use --apply only after closing other workspace sessions.');
    print(migrateWorkspace(rest[0]!,rest[1] === '--apply')); return;
  }
  if (command === 'suggest') { await suggestCommand(rest); return; }
  if (command === 'model') { requireArgs(rest,0); print({protocolVersion:1,providers:['ollama','openai-compatible'],offline:'MockModelProvider; pnpm demo; pnpm demo:provider',help:'docs/providers.md; no model listing or network request performed'}); return; }
  if (command === 'demo') { requireArgs(rest, 0, 1); await demo(rest[0]); return; }
  if (command === 'init') {
    requireArgs(rest, 1, 2);
    const directory = rest[0]; if (!directory) throw new WriterError('INVALID_INPUT', 'Missing workspace path.');
    const workspace = Workspace.create(directory, rest[1]);
    try { print({ ...workspace.info(), root: workspace.root }); } finally { workspace.close(); }
    return;
  }
  const limits: Record<string, readonly [number, number]> = {
    import: [2,3], list: [1,1], show: [2,2], propose: [3,3], changes: [2,2],
    accept: [2,3], reject: [2,3], revert: [2,3], history: [2,2], decisions: [2,2], export: [3,3], provenance: [2,2],
  };
  const limit = Object.hasOwn(limits, command) ? limits[command] : undefined;
  if (!limit) throw new WriterError('INVALID_INPUT', `Unknown command: ${command}`);
  requireArgs(rest, limit[0], limit[1]);
  const [directory, target, extra] = rest;
  if (!directory) throw new WriterError('INVALID_INPUT', 'Missing workspace path.');
  const workspace = Workspace.open(directory);
  try {
    if (command === 'list') { print(workspace.listDocuments()); return; }
    requireString(target, 'document/change/input-file argument', 4096);
    switch (command) {
      case 'import': print(workspace.createDocument(extra ?? basename(target), readUtf8(target))); break;
      case 'show': print({ document: workspace.getDocument(target), revision: workspace.currentRevision(target), markdown: workspace.markdown(target) }); break;
      case 'propose': {
        requireString(extra, 'proposal.json path', 4096);
        let proposal: unknown;
        try { proposal = JSON.parse(readUtf8(extra)); }
        catch { throw new WriterError('INVALID_INPUT', 'Proposal file is not valid UTF-8 JSON.'); }
        if (!isRecord(proposal)) throw new WriterError('INVALID_INPUT', 'Proposal must be an object.');
        requireString(proposal.baseRevisionId, 'baseRevisionId');
        validateEdits(proposal.edits);
        const providerId = proposal.providerId ?? 'manual';
        requireString(providerId, 'providerId', 200);
        print(workspace.proposeChanges(target, proposal.baseRevisionId, proposal.edits, providerId));
        break;
      }
      case 'provenance': print(workspace.sources.provenance(target)); break;
      case 'changes': print(workspace.listChanges(target)); break;
      case 'accept': print(workspace.accept(target, extra)); break;
      case 'reject': print(workspace.reject(target, extra)); break;
      case 'revert': print(workspace.revert(target, extra)); break;
      case 'history': print(workspace.history(target)); break;
      case 'decisions': print(workspace.decisions(target)); break;
      case 'export': {
        requireString(extra, 'export path', 4096);
        const file = resolve(extra);
        const content = workspace.markdown(target);
        // 'wx' refuses overwrites, including existing symlinks. The parent directory must exist.
        writeFileSync(file, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        print({ documentId: target, path: file }); break;
      }
    }
  } finally { workspace.close(); }
}
main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error instanceof WriterError || error instanceof ProviderError ? `ERROR [${error.code}]: ${message}` : `ERROR: ${message}`);
  process.exitCode = error instanceof WriterError ? 2 : error instanceof ProviderError ? 3 : 1;
});
