import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Workspace } from '@writer-agent/storage';
import { fixture, propose, edit, expectCode, temporary } from './helpers.js';

test('workspace, Unicode text, proposal and decision survive reopening', t => {
  const { workspace: w, document: d } = fixture(t, '\ufeff你好😀\r\n\r\n第二段\r\n');
  const info = w.info(); const c = propose(w, d.id, 0, '修改😀');
  w.accept(c.id, '选择理由'); const output = w.markdown(d.id); w.close();
  const again = Workspace.open(w.root);
  try {
    assert.deepEqual(again.info(), info); assert.equal(again.markdown(d.id), output);
    assert.equal(again.getChange(c.id).status, 'accepted'); assert.equal(again.decisions(d.id)[0]?.reason, '选择理由');
    assert.equal(again.history(d.id).length, 2);
  } finally { again.close(); }
});
test('accept/reject/revert preserve unrelated accepted changes', t => {
  const { workspace: w, document: d } = fixture(t, '甲可能成立。\n\n乙。\n\n保留证据。');
  const original = w.currentRevision(d.id);
  const [a,b,c] = w.proposeChanges(d.id, original.id, [edit(w,d.id,0,'甲成立。'),edit(w,d.id,1,'乙已润色。'),edit(w,d.id,2,'')]);
  assert.ok(a && b && c);
  w.accept(a.id); w.accept(b.id); w.reject(c.id, '不要删除依据'); w.revert(a.id, '不要增强断言');
  assert.equal(w.markdown(d.id), '甲可能成立。\n\n乙已润色。\n\n保留证据。');
  assert.equal(w.history(d.id).length, 4);
  assert.deepEqual(w.decisions(d.id).map(x => x.action), ['accepted','accepted','rejected','reverted']);
  assert.deepEqual(w.getRevision(original.id), original);
  assert.equal(w.getChange(b.id).status, 'accepted');
});
test('reject persists a reason without modifying text or creating a revision', t => {
  const { workspace: w, document: d } = fixture(t); const c = propose(w,d.id,0,'修改');
  w.reject(c.id, '不要删除限定词');
  assert.equal(w.getDocument(d.id).headRevisionId,d.headRevisionId);
  assert.equal(w.history(d.id).length,1); assert.equal(w.decisions(d.id)[0]?.reason,'不要删除限定词');
});
test('stale model response cannot silently overwrite current work', t => {
  const { workspace: w, document: d } = fixture(t); const e = edit(w,d.id,1,'第二项');
  const c = propose(w,d.id,0,'第一项'); w.accept(c.id);
  expectCode(() => w.proposeChanges(d.id,d.headRevisionId,[e]),'STALE_REVISION');
  assert.equal(w.listChanges(d.id).length,1);
});
test('two pending alternatives on one block conflict after one is accepted', t => {
  const { workspace: w, document: d } = fixture(t);
  const a=propose(w,d.id,0,'改法A');const b=propose(w,d.id,0,'改法B'); w.accept(a.id);
  expectCode(() => w.accept(b.id),'CHANGE_CONFLICT');
  assert.equal(w.getChange(b.id).status,'pending'); assert.equal(w.history(d.id).length,2);
});
test('reverting an older same-block edit does not destroy a newer edit', t => {
  const { workspace: w, document: d } = fixture(t);
  const a=propose(w,d.id,0,'A');w.accept(a.id);const b=propose(w,d.id,0,'B');w.accept(b.id);
  expectCode(() => w.revert(a.id),'CHANGE_CONFLICT'); assert.ok(w.markdown(d.id).startsWith('B'));
});
test('ABA protection keeps stale proposals invalid after reverting to original text', t => {
  const { workspace: w, document: d } = fixture(t);
  const a=propose(w,d.id,0,'A');const old=propose(w,d.id,0,'stale');w.accept(a.id);w.revert(a.id);
  expectCode(() => w.accept(old.id),'CHANGE_CONFLICT');
  assert.equal(w.currentRevision(d.id).snapshot.blocks[0]?.version,3);
});
test('duplicate accepts, rejects and reverts are invalid transitions', t => {
  const { workspace: w, document: d } = fixture(t);const a=propose(w,d.id,0,'A');
  w.accept(a.id);expectCode(() => w.accept(a.id),'INVALID_TRANSITION');expectCode(() => w.reject(a.id),'INVALID_TRANSITION');
  w.revert(a.id);expectCode(() => w.revert(a.id),'INVALID_TRANSITION');
  const b=propose(w,d.id,1,'B');w.reject(b.id);expectCode(() => w.accept(b.id),'INVALID_TRANSITION');expectCode(() => w.reject(b.id),'INVALID_TRANSITION');
});
test('invalid proposal batch saves none of its entries', t => {
  const { workspace: w, document: d } = fixture(t);const good=edit(w,d.id,0,'A');const bad={...edit(w,d.id,1,'B'),before:'not actual text'};
  expectCode(() => w.proposeChanges(d.id,d.headRevisionId,[good,bad]),'CHANGE_CONFLICT');
  assert.equal(w.listChanges(d.id).length,0);assert.equal(w.history(d.id).length,1);
});
test('SQL transaction rolls back text, head, change status and revision if decision insert fails', t => {
  const { workspace: w, document: d } = fixture(t);const a=propose(w,d.id,0,'A');
  const raw=new DatabaseSync(join(w.root,'.writer/workspace.sqlite'));
  raw.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON decisions BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");raw.close();
  assert.throws(() => w.accept(a.id),/injected failure/);
  assert.equal(w.getDocument(d.id).headRevisionId,d.headRevisionId);assert.equal(w.history(d.id).length,1);
  assert.equal(w.getChange(a.id).status,'pending');assert.equal(w.decisions(d.id).length,0);
});
test('database-level append-only triggers protect revisions and decisions from update/delete', t => {
  const { workspace: w, document: d } = fixture(t);const a=propose(w,d.id,0,'A');w.accept(a.id);
  const raw=new DatabaseSync(join(w.root,'.writer/workspace.sqlite'));
  try {
    assert.throws(() => raw.exec("UPDATE revisions SET kind='reverted'"),/append-only/);
    assert.throws(() => raw.exec('DELETE FROM revisions'),/append-only/);
    assert.throws(() => raw.exec("UPDATE decisions SET reason='x'"),/append-only/);
    assert.throws(() => raw.exec('DELETE FROM decisions'),/append-only/);
  } finally {raw.close();}
});
test('separate connections observe committed changes and detect stale alternatives', t => {
  const { workspace: w, document: d } = fixture(t);const other=Workspace.open(w.root);
  try {
    const a=propose(w,d.id,0,'A');const b=propose(other,d.id,0,'B');w.accept(a.id);
    expectCode(() => other.accept(b.id),'CHANGE_CONFLICT');assert.equal(other.markdown(d.id),w.markdown(d.id));
  } finally {other.close();}
});
test('document boundaries prevent a proposal from targeting another document block', t => {
  const { workspace: w, document: d } = fixture(t);const other=w.createDocument('other','别的文稿');
  const wrong=edit(w,other.id,0,'破坏');
  expectCode(() => w.proposeChanges(d.id,d.headRevisionId,[wrong]),'CHANGE_CONFLICT');
  assert.equal(w.markdown(other.id),'别的文稿');
});
test('SQL-looking text remains literal bound data', t => {
  const { workspace: w } = fixture(t);const text="Robert'); DROP TABLE documents; --";
  const d=w.createDocument(text,text);assert.equal(w.markdown(d.id),text);assert.equal(w.listDocuments().length,2);
});
test('empty documents and empty edit batches are supported without inventing work', t => {
  const { workspace: w, document: d } = fixture(t,'');
  assert.equal(w.markdown(d.id),'');assert.deepEqual(w.proposeChanges(d.id,d.headRevisionId,[]),[]);
  assert.equal(w.history(d.id).length,1);
});
test('a changed returned object cannot mutate stored history', t => {
  const { workspace: w, document: d } = fixture(t);const r=w.currentRevision(d.id);
  const mutated = r.snapshot.blocks[0] as {text: string}; mutated.text='external mutation';
  assert.notEqual(w.currentRevision(d.id).snapshot.blocks[0]?.text,'external mutation');
});
test('new workspaces refuse occupied directories and existing workspaces', t => {
  const dir=temporary(t);writeFileSync(join(dir,'keep.txt'),'keep');
  expectCode(() => Workspace.create(dir),'ALREADY_EXISTS');assert.equal(readFileSync(join(dir,'keep.txt'),'utf8'),'keep');
  const w=Workspace.create(join(dir,'new'));w.close();expectCode(() => Workspace.create(w.root),'ALREADY_EXISTS');
});
test('missing workspace is not auto-created and unknown records are errors', t => {
  const { workspace: w, dir } = fixture(t);
  expectCode(() => Workspace.open(join(dir,'missing')),'NOT_FOUND');
  expectCode(() => w.getDocument('missing'),'NOT_FOUND');expectCode(() => w.getChange('missing'),'NOT_FOUND');
});
test('future schema is refused without migration or overwrite', t => {
  const { workspace: w } = fixture(t);w.close();
  const raw=new DatabaseSync(join(w.root,'.writer/workspace.sqlite'));raw.exec('PRAGMA user_version=999');raw.close();
  expectCode(() => Workspace.open(w.root),'UNSUPPORTED_SCHEMA');
  const verify=new DatabaseSync(join(w.root,'.writer/workspace.sqlite'));
  assert.equal(verify.prepare('PRAGMA user_version').get()?.user_version,999);verify.close();
});
test('close is idempotent and closed workspaces reject operations', t => {
  const { workspace: w } = fixture(t);w.close();w.close();expectCode(() => w.info(),'WORKSPACE_CLOSED');
});
test('accepting independently valid proposals cannot exceed document size limits together', t => {
  const { workspace: w, document: d } = fixture(t,'a\n\nb');
  const a=propose(w,d.id,0,'x'.repeat(1_100_000));const b=propose(w,d.id,1,'y'.repeat(1_100_000));w.accept(a.id);
  expectCode(() => w.accept(b.id),'INVALID_INPUT');assert.equal(w.getChange(b.id).status,'pending');assert.equal(w.history(d.id).length,2);
});
test('workspace .gitignore excludes private writing by default', t => {
  const {workspace:w}=fixture(t);assert.equal(readFileSync(join(w.root,'.gitignore'),'utf8'),'*\n!.gitignore\n');
});
