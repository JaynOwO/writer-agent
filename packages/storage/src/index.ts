// SPDX-License-Identifier: Apache-2.0
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  WriterError, requireString, validateText, validateEdits, importMarkdown, renderMarkdown,
  parseSnapshot, validateSnapshot, newId, reviewTextChange, applyChange, revertChange,
} from '@writer-agent/core';
import type {
  WorkspaceInfo, DocumentRecord, Revision, Change, Decision, Snapshot, ProposedEdit, ReviewHint, MemoryCapture, RejectionCategory,
} from '@writer-agent/core';
import { APPLICATION_ID, SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';
import { WritingMemory } from './memory.js';
export { WritingMemory } from './memory.js';
export type { MemoryTaskRun } from './memory.js';
import { SourceLibrary } from './sources.js';
import { AnalysisLedger } from './analysis.js';
export { AnalysisLedger } from './analysis.js';
export { migrateWorkspace } from './migration.js';
export { SourceLibrary } from './sources.js';
import type { ProposalContextInput } from '@writer-agent/core';

// Keep SQL decoding at the storage boundary. Domain code never receives raw SQLite values.
type Row = Record<string, unknown>;
function field(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new WriterError('CORRUPT_DATA', `Invalid database field: ${key}.`);
  return value;
}
function optionalField(row: Row, key: string): string | null { return row[key] === null ? null : field(row, key); }
function integer(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new WriterError('CORRUPT_DATA', `Invalid numeric field: ${key}.`);
  return value;
}
function decodeDocument(row: Row): DocumentRecord {
  return { id: field(row, 'id'), title: field(row, 'title'), headRevisionId: field(row, 'head_revision_id'), createdAt: field(row, 'created_at') };
}
function decodeRevision(row: Row): Revision {
  const kind = field(row, 'kind');
  if (kind !== 'created' && kind !== 'accepted' && kind !== 'reverted') throw new WriterError('CORRUPT_DATA', 'Invalid revision kind.');
  return {
    id: field(row, 'id'), documentId: field(row, 'document_id'), parentId: optionalField(row, 'parent_id'),
    kind, changeId: optionalField(row, 'change_id'), snapshot: parseSnapshot(field(row, 'snapshot_json')),
    createdAt: field(row, 'created_at'),
  };
}
function decodeChange(row: Row): Change {
  const status = field(row, 'status');
  if (!['pending','accepted','rejected','reverted'].includes(status)) throw new WriterError('CORRUPT_DATA', 'Invalid change status.');
  let hints: ReviewHint[];
  try {
    const parsed: unknown = JSON.parse(field(row, 'hints_json'));
    if (!Array.isArray(parsed)) throw new Error('Invalid hints');
    // Recompute deterministic hints: stored metadata is not a trusted semantic verdict.
    hints = reviewTextChange(field(row, 'before_text'), field(row, 'after_text'));
  } catch { throw new WriterError('CORRUPT_DATA', 'Invalid review metadata.'); }
  return {
    id: field(row, 'id'), documentId: field(row, 'document_id'), baseRevisionId: field(row, 'base_revision_id'),
    blockId: field(row, 'block_id'), baseBlockVersion: integer(row, 'base_block_version'),
    before: field(row, 'before_text'), after: field(row, 'after_text'), summary: field(row, 'summary'),
    providerId: field(row, 'provider_id'), hints, status: status as Change['status'],
    acceptedRevisionId: optionalField(row, 'accepted_revision_id'),
    acceptedBlockVersion: row.accepted_block_version === null ? null : integer(row, 'accepted_block_version'),
    createdAt: field(row, 'created_at'),
  };
}
function decodeDecision(row: Row): Decision {
  const action = field(row, 'action');
  if (action !== 'accepted' && action !== 'rejected' && action !== 'reverted') throw new WriterError('CORRUPT_DATA', 'Invalid decision action.');
  return {
    sequence: integer(row, 'seq'), id: field(row, 'id'), changeId: field(row, 'change_id'), action,
    reason: field(row, 'reason'), revisionId: field(row, 'revision_id'), createdAt: field(row, 'created_at'),
  };
}
function ensureRealPath(path: string, directory: boolean): void {
  if (!existsSync(path)) throw new WriterError('NOT_FOUND', `Not found: ${path}`);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    throw new WriterError('INVALID_INPUT', 'Workspace paths must be ordinary local directories/files, not symlinks.');
  }
}

/** One SQLite database is authoritative. Markdown exports are explicit, never silently re-imported. */
export class Workspace {
  readonly root: string;
  private readonly db: DatabaseSync;
  private closed = false;
  readonly sources: SourceLibrary;
  readonly analysis: AnalysisLedger;
  readonly memory: WritingMemory;
  private constructor(root: string, db: DatabaseSync) {
    this.root = root; this.db = db;
    this.sources = new SourceLibrary(db, () => {
      this.assertOpen();
      if (this.schemaVersion() < 2) throw new WriterError('MIGRATION_REQUIRED', 'Sources need schema v2. Run writer migrate <workspace> to preview, then --apply after closing other sessions.');
    }, fn => this.transaction(fn));
    this.memory = new WritingMemory(db, () => {
      this.assertOpen();
      if (this.schemaVersion() < 4) throw new WriterError('MIGRATION_REQUIRED', 'Writing memory requires schema v4. Preview writer migrate, then explicitly --apply.');
    }, fn => this.transaction(fn), this);
    this.analysis = new AnalysisLedger(db, () => {
      this.assertOpen();
      if (this.schemaVersion() < 3) throw new WriterError('MIGRATION_REQUIRED', 'Analysis requires schema v3. Preview writer migrate, then --apply after backup and closing other sessions.');
    }, fn => this.transaction(fn), this);
  }
  private schemaVersion(): number {
    const v = this.db.prepare('PRAGMA user_version').get()?.user_version;
    if (v !== 1 && v !== 2 && v !== 3 && v !== SCHEMA_VERSION) throw new WriterError('UNSUPPORTED_SCHEMA', 'Unknown workspace schema.');
    return v;
  }

  static create(directory: string, name = 'My writing workspace'): Workspace {
    requireString(directory, 'workspace directory', 4096);
    requireString(name, 'workspace name');
    const root = resolve(directory);
    if (existsSync(root)) {
      ensureRealPath(root, true);
      if (readdirSync(root).length > 0) throw new WriterError('ALREADY_EXISTS', 'Choose a new or empty workspace directory, not the source repository.');
    } else mkdirSync(root, { recursive: true, mode: 0o700 });
    const stateDir = join(root, '.writer');
    // Exclusive mkdir also prevents two initializers from clobbering each other.
    mkdirSync(stateDir, { mode: 0o700 });
    const dbPath = join(stateDir, 'workspace.sqlite');
    const db = new DatabaseSync(dbPath, { timeout: 5000 });
    const workspace = new Workspace(root, db);
    try {
      if (process.platform !== 'win32') chmodSync(dbPath, 0o600);
      db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      workspace.transaction(() => {
        db.exec(SCHEMA_SQL);
        db.prepare('INSERT INTO workspace(id,name,created_at) VALUES(?,?,?)').run(newId('ws'), name, new Date().toISOString());
      });
      // User writing data is private by default, even if placed beneath a Git repository.
      writeFileSync(join(root, '.gitignore'), '*\n!.gitignore\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      return workspace;
    } catch (error) {
      workspace.close();
      // Do not remove a user-selected directory on failure. Partial initialization is visible.
      throw error;
    }
  }

  static open(directory: string): Workspace {
    requireString(directory, 'workspace directory', 4096);
    const root = resolve(directory);
    ensureRealPath(root, true);
    ensureRealPath(join(root, '.writer'), true);
    const dbPath = join(root, '.writer', 'workspace.sqlite');
    ensureRealPath(dbPath, false);
    const db = new DatabaseSync(dbPath, { timeout: 5000 });
    try {
      const version = db.prepare('PRAGMA user_version').get();
      const app = db.prepare('PRAGMA application_id').get();
      if (!version || ![1,2,3,SCHEMA_VERSION].includes(integer(version, 'user_version')) || !app || integer(app, 'application_id') !== APPLICATION_ID) {
        throw new WriterError('UNSUPPORTED_SCHEMA', 'Unknown workspace format/version. No migration or overwrite was attempted.');
      }
      db.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;');
      const result = new Workspace(root, db);
      result.info();
      return result;
    } catch (error) { db.close(); throw error; }
  }

  close(): void { if (!this.closed) { this.db.close(); this.closed = true; } }
  private assertOpen(): void {
    if (this.closed) throw new WriterError('WORKSPACE_CLOSED', 'Workspace is closed.');
    if (existsSync(join(this.root, '.writer', 'migration.lock'))) throw new WriterError('WORKSPACE_BUSY', 'Workspace migration is locked.');
  }
  private transaction<T>(fn: () => T): T {
    this.assertOpen();
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  info(): WorkspaceInfo {
    this.assertOpen();
    const rows = this.db.prepare('SELECT * FROM workspace').all();
    if (rows.length !== 1 || !rows[0]) throw new WriterError('CORRUPT_DATA', 'Invalid workspace metadata.');
    return { id: field(rows[0], 'id'), name: field(rows[0], 'name'), createdAt: field(rows[0], 'created_at'), schemaVersion: this.schemaVersion() };
  }
  createDocument(title: string, markdown: string): DocumentRecord {
    requireString(title, 'title');
    const snapshot = importMarkdown(markdown);
    return this.transaction(() => {
      const id = newId('doc');
      const createdAt = new Date().toISOString();
      this.db.prepare('INSERT INTO documents(id,title,head_revision_id,created_at) VALUES(?,?,NULL,?)').run(id, title, createdAt);
      const revision = this.appendRevision(id, null, snapshot, 'created', null);
      this.db.prepare('UPDATE documents SET head_revision_id=? WHERE id=?').run(revision.id, id);
      return this.getDocument(id);
    });
  }
  getDocument(id: string): DocumentRecord {
    this.assertOpen(); requireString(id, 'documentId');
    const row = this.db.prepare('SELECT * FROM documents WHERE id=?').get(id);
    if (!row) throw new WriterError('NOT_FOUND', `Document not found: ${id}`);
    return decodeDocument(row);
  }
  listDocuments(): DocumentRecord[] {
    this.assertOpen();
    return this.db.prepare('SELECT * FROM documents ORDER BY created_at,id').all().map(decodeDocument);
  }
  getRevision(id: string): Revision {
    this.assertOpen(); requireString(id, 'revisionId');
    const row = this.db.prepare('SELECT * FROM revisions WHERE id=?').get(id);
    if (!row) throw new WriterError('NOT_FOUND', `Revision not found: ${id}`);
    return decodeRevision(row);
  }
  currentRevision(documentId: string): Revision { return this.getRevision(this.getDocument(documentId).headRevisionId); }
  markdown(documentId: string): string { return renderMarkdown(this.currentRevision(documentId).snapshot); }
  history(documentId: string): Revision[] {
    this.getDocument(documentId);
    return this.db.prepare('SELECT * FROM revisions WHERE document_id=? ORDER BY seq').all(documentId).map(decodeRevision);
  }
  getChange(id: string): Change {
    this.assertOpen(); requireString(id, 'changeId');
    const row = this.db.prepare('SELECT * FROM changes WHERE id=?').get(id);
    if (!row) throw new WriterError('NOT_FOUND', `Change not found: ${id}`);
    return decodeChange(row);
  }
  listChanges(documentId: string): Change[] {
    this.getDocument(documentId);
    return this.db.prepare('SELECT * FROM changes WHERE document_id=? ORDER BY seq').all(documentId).map(decodeChange);
  }
  decisions(documentId: string): Decision[] {
    this.getDocument(documentId);
    return this.db.prepare(`SELECT d.* FROM decisions d JOIN changes c ON c.id=d.change_id WHERE c.document_id=? ORDER BY d.seq`).all(documentId).map(decodeDecision);
  }

  proposeChanges(documentId: string, baseRevisionId: string, edits: readonly ProposedEdit[], providerId = 'manual', context?: ProposalContextInput, guidance?: { capture: MemoryCapture; instruction: string }): Change[] {
    requireString(baseRevisionId, 'baseRevisionId'); requireString(providerId, 'providerId', 200); validateEdits(edits);
    return this.transaction(() => {
      const doc = this.getDocument(documentId);
      if (doc.headRevisionId !== baseRevisionId) throw new WriterError('STALE_REVISION', 'The document changed while the proposal was prepared. Regenerate it against the current revision.');
      const base = this.currentRevision(documentId);
      let projected = base.snapshot;
      const changes: Change[] = edits.map(edit => {
        const block = base.snapshot.blocks.find(b => b.id === edit.blockId);
        if (!block || block.text !== edit.before) throw new WriterError('CHANGE_CONFLICT', 'Proposal text does not exactly match its target block.');
        const change: Change = {
          ...edit, id: newId('chg'), documentId, baseRevisionId, baseBlockVersion: block.version,
          providerId, hints: reviewTextChange(edit.before, edit.after), status: 'pending',
          acceptedRevisionId: null, acceptedBlockVersion: null, createdAt: new Date().toISOString(),
        };
        projected = applyChange(projected, change); // Enforce the final document size before persisting any proposal.
        return change;
      });
      const insert = this.db.prepare(`INSERT INTO changes(id,document_id,base_revision_id,block_id,base_block_version,before_text,after_text,summary,provider_id,hints_json,status,accepted_revision_id,accepted_block_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',NULL,NULL,?)`);
      for (const c of changes) insert.run(c.id,c.documentId,c.baseRevisionId,c.blockId,c.baseBlockVersion,c.before,c.after,c.summary,c.providerId,JSON.stringify(c.hints),c.createdAt);
      if (context !== undefined) {
        if (this.schemaVersion() < 2) throw new WriterError('MIGRATION_REQUIRED', 'Source contexts need an explicit workspace migration.');
        requireString(context.instruction, 'instruction', 10000); validateText(context.instruction);
        this.sources.verifyContext(context.items);
        const contextId = newId('ctx');
        this.db.prepare('INSERT INTO proposal_contexts(id,document_id,base_revision_id,provider_id,instruction,items_json,created_at) VALUES(?,?,?,?,?,?,?)')
          .run(contextId, documentId, baseRevisionId, providerId, context.instruction, JSON.stringify(context.items), new Date().toISOString());
        for (const change of changes) this.db.prepare('INSERT INTO change_contexts(change_id,context_id) VALUES(?,?)').run(change.id, contextId);
      }
      if (guidance !== undefined) {
        if (guidance.capture.documentId !== documentId || guidance.capture.task !== 'revise') throw new WriterError('INVALID_INPUT', 'Wrong writing guidance target/task.');
        this.memory.saveUse(guidance.capture, baseRevisionId, guidance.instruction, providerId, changes.map(c => c.id));
      }
      return changes;
    });
  }

  accept(changeId: string, reason = ''): Revision {
    return this.decideContent(changeId, 'accepted', reason);
  }
  revert(changeId: string, reason = ''): Revision {
    return this.decideContent(changeId, 'reverted', reason);
  }
  reject(changeId: string, reason = '', category?: RejectionCategory): Change {
    this.validateReason(reason);
    return this.transaction(() => {
      const change = this.getChange(changeId);
      if (change.status !== 'pending') throw new WriterError('INVALID_TRANSITION', 'Only pending changes can be rejected. Use revert for accepted changes.');
      this.db.prepare("UPDATE changes SET status='rejected' WHERE id=?").run(changeId);
      const decisionId = this.appendDecision(changeId, 'rejected', reason, this.getDocument(change.documentId).headRevisionId);
      if (category !== undefined) this.memory.recordRejectionCategory(decisionId, category);
      return this.getChange(changeId);
    });
  }
  private decideContent(changeId: string, action: 'accepted' | 'reverted', reason: string): Revision {
    this.validateReason(reason);
    return this.transaction(() => {
      const change = this.getChange(changeId);
      const current = this.currentRevision(change.documentId);
      const snapshot = action === 'accepted' ? applyChange(current.snapshot, change) : revertChange(current.snapshot, change);
      const revision = this.appendRevision(change.documentId, current.id, snapshot, action, change.id);
      const updated = this.db.prepare('UPDATE documents SET head_revision_id=? WHERE id=? AND head_revision_id=?').run(revision.id, change.documentId, current.id);
      if (Number(updated.changes) !== 1) throw new WriterError('STALE_REVISION', 'Document head changed; transaction rolled back.');
      if (action === 'accepted') {
        const block = snapshot.blocks.find(b => b.id === change.blockId);
        if (!block) throw new WriterError('CORRUPT_DATA', 'Missing accepted block.');
        this.db.prepare("UPDATE changes SET status='accepted',accepted_revision_id=?,accepted_block_version=? WHERE id=?").run(revision.id, block.version, change.id);
      } else this.db.prepare("UPDATE changes SET status='reverted' WHERE id=?").run(change.id);
      this.appendDecision(change.id, action, reason, revision.id);
      return revision;
    });
  }
  private appendRevision(documentId: string, parentId: string | null, snapshot: Snapshot, kind: Revision['kind'], changeId: string | null): Revision {
    validateSnapshot(snapshot);
    const revision: Revision = { id: newId('rev'), documentId, parentId, kind, changeId, snapshot, createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO revisions(id,document_id,parent_id,kind,change_id,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?)').run(revision.id,documentId,parentId,kind,changeId,JSON.stringify(snapshot),revision.createdAt);
    return revision;
  }
  private appendDecision(changeId: string, action: Decision['action'], reason: string, revisionId: string): string {
    const decisionId = newId('dec');
    this.db.prepare('INSERT INTO decisions(id,change_id,action,reason,revision_id,created_at) VALUES(?,?,?,?,?,?)').run(decisionId,changeId,action,reason,revisionId,new Date().toISOString());
    return decisionId;
  }
  private validateReason(reason: string): void {
    validateText(reason, 'reason');
    if (reason.length > 4000) throw new WriterError('INVALID_INPUT', 'Decision reason exceeds 4000 characters.');
  }
}
