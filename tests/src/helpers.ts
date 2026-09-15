import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { WriterError } from '@writer-agent/core';
import type { ErrorCode, ProposedEdit } from '@writer-agent/core';
import { Workspace } from '@writer-agent/storage';
export function expectCode(fn: () => unknown, code: ErrorCode): void {
  assert.throws(fn, (error: unknown) => error instanceof WriterError && error.code === code);
}
export function temporary(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'writer-agent-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
export function fixture(t: TestContext, markdown = '甲段可能成立。\n\n乙段保持不变。') {
  const dir = mkdtempSync(join(tmpdir(), 'writer-agent-test-'));
  const workspace = Workspace.create(join(dir, 'workspace'), 'Test workspace');
  t.after(() => { workspace.close(); rmSync(dir, { recursive: true, force: true }); });
  const document = workspace.createDocument('测试文稿', markdown);
  return { workspace, document, dir };
}
export function edit(workspace: Workspace, documentId: string, index: number, after: string): ProposedEdit {
  const block = workspace.currentRevision(documentId).snapshot.blocks[index];
  assert.ok(block);
  return { blockId: block.id, before: block.text, after, summary: 'Test edit' };
}
export function propose(workspace: Workspace, documentId: string, index: number, after: string) {
  const changes = workspace.proposeChanges(documentId, workspace.getDocument(documentId).headRevisionId, [edit(workspace, documentId, index, after)], 'test');
  assert.ok(changes[0]);
  return changes[0];
}
