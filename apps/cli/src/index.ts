#!/usr/bin/env node
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { MAX_DOCUMENT_BYTES, WriterError, isRecord, requireString, validateEdits } from '@writer-agent/core';
import { Workspace } from '@writer-agent/storage';
import { demo } from './demo.js';

const help = `Writer Agent v0.0.1 (CLI development preview; no API key needed)

  writer help
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
See docs/cli.md for proposal JSON. Commands never call cloud APIs or push Git.
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
    accept: [2,3], reject: [2,3], revert: [2,3], history: [2,2], decisions: [2,2], export: [3,3],
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
  console.error(error instanceof WriterError ? `ERROR [${error.code}]: ${message}` : `ERROR: ${message}`);
  process.exitCode = error instanceof WriterError ? 2 : 1;
});
