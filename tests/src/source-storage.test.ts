// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { fixture, edit, expectCode } from './helpers.js';
import { Workspace } from '@writer-agent/storage';
import { hashBytes } from '@writer-agent/core';
function add(w:Workspace,text='First line\n可能相关，但不是因果。\nThird line') {return w.sources.add({kind:'file',locator:'report.txt',mediaType:'text/plain',raw:Buffer.from(text)});}
test('source raw bytes, metadata, excerpts and research notes survive reopening',t=>{
  const{workspace:w}=fixture(t);const {source,snapshot}=add(w);const e=w.sources.extract(snapshot.id,2,2);w.sources.note(snapshot.id,'needs verification',e.id);
  const raw=w.sources.raw(snapshot.id);w.close();const again=Workspace.open(w.root);
  try{assert.deepEqual(again.sources.get(source.id),source);assert.deepEqual(again.sources.snapshot(snapshot.id),snapshot);assert.deepEqual(again.sources.raw(snapshot.id),raw);assert.deepEqual(again.sources.excerpt(e.id),e);assert.equal(again.sources.notes(snapshot.id)[0]?.text,'needs verification');}finally{again.close();}
});
test('refresh appends snapshots without changing older evidence or excerpts',t=>{
  const{workspace:w}=fixture(t);const input={kind:'web' as const,locator:'https://example.org/report',mediaType:'text/plain' as const};
  const a=w.sources.add({...input,raw:Buffer.from('old evidence')});const ex=w.sources.extract(a.snapshot.id,1,1);
  const b=w.sources.add({...input,raw:Buffer.from('new evidence')});
  assert.equal(a.source.id,b.source.id);assert.notEqual(a.snapshot.id,b.snapshot.id);assert.equal(w.sources.history(a.source.id).length,2);
  assert.equal(w.sources.excerpt(ex.id).quote,'old evidence');assert.equal(w.sources.list()[0]?.latestSnapshotId,b.snapshot.id);
});
test('same-basename local imports remain separate unless an existing source is explicitly selected',t=>{
  const{workspace:w}=fixture(t);const a=add(w),b=add(w);assert.notEqual(a.source.id,b.source.id);
  const refreshed=w.sources.add({kind:'file',locator:'report.txt',sourceId:a.source.id,mediaType:'text/plain',raw:Buffer.from('updated')});
  assert.equal(refreshed.source.id,a.source.id);assert.equal(w.sources.history(a.source.id).length,2);
  expectCode(()=>w.sources.add({kind:'file',locator:'another.txt',sourceId:a.source.id,mediaType:'text/plain',raw:Buffer.from('x')}),'INVALID_INPUT');
});
test('invalid extraction or insert failure cannot leave orphan source rows',t=>{
  const{workspace:w}=fixture(t);
  expectCode(()=>add(w,''),'SOURCE_UNSUPPORTED');assert.equal(w.sources.list().length,0);
  const raw=new DatabaseSync(join(w.root,'.writer/workspace.sqlite'));raw.exec("CREATE TRIGGER injected BEFORE INSERT ON source_snapshots BEGIN SELECT RAISE(ABORT,'injected'); END;");raw.close();
  assert.throws(()=>add(w),/injected/);assert.equal(w.sources.list().length,0);
});
test('append-only triggers prevent editing and deleting source history',t=>{
  const{workspace:w}=fixture(t);add(w);const raw=new DatabaseSync(join(w.root,'.writer/workspace.sqlite'));
  try {assert.throws(()=>raw.exec("UPDATE source_snapshots SET text='changed'"),/append-only/);assert.throws(()=>raw.exec('DELETE FROM sources'),/append-only/);assert.throws(()=>raw.exec('DELETE FROM source_snapshots'),/append-only/);}finally{raw.close();}
});
test('raw hashes detect accidental corruption when database owner bypasses triggers',t=>{
  const{workspace:w}=fixture(t);const a=add(w);const raw=new DatabaseSync(join(w.root,'.writer/workspace.sqlite'));
  raw.exec("DROP TRIGGER source_snapshots_no_update; UPDATE source_snapshots SET raw_hash='broken'");raw.close();
  expectCode(()=>w.sources.snapshot(a.snapshot.id),'CORRUPT_DATA');
});
test('local search handles exact Chinese substrings and literal SQL-like queries',t=>{
  const{workspace:w}=fixture(t);add(w);add(w,"quote'); DROP TABLE sources; --");
  assert.equal(w.sources.search('不是因果').length,1);assert.equal(w.sources.search("quote'); DROP TABLE").length,1);
  assert.equal(w.sources.search('%').length,0);assert.equal(w.sources.search('title').length,0,'Metadata property names are not searchable source text');assert.equal(w.sources.list().length,2);
});
test('note rejects excerpt from another source snapshot',t=>{
  const{workspace:w}=fixture(t);const a=add(w),b=add(w);const e=w.sources.extract(b.snapshot.id,1,1);
  expectCode(()=>w.sources.note(a.snapshot.id,'wrong',e.id),'INVALID_INPUT');assert.deepEqual(w.sources.notes(a.snapshot.id),[]);
});
test('empty/oversized excerpt selections and absent IDs are rejected',t=>{
  const{workspace:w}=fixture(t);const s=add(w,'A\n\n'+ 'x'.repeat(81000)).snapshot;
  expectCode(()=>w.sources.extract(s.id,2,2),'INVALID_INPUT');expectCode(()=>w.sources.extract(s.id,3,3),'INVALID_INPUT');
  expectCode(()=>w.sources.snapshot('missing'),'NOT_FOUND');expectCode(()=>w.sources.context({snapshots:[s.id]}),'INVALID_INPUT');
});
test('source context includes only explicitly selected snapshots/excerpts, not research notes',t=>{
  const{workspace:w}=fixture(t);const s=add(w).snapshot;const e=w.sources.extract(s.id,2,2);w.sources.note(s.id,'PRIVATE NOTE DO NOT SEND');
  assert.deepEqual(w.sources.context({}),[]);const items=w.sources.context({excerpts:[e.id]});assert.equal(items[0]?.text,e.quote);assert.equal(items[0]?.contentHash,hashBytes(e.quote));assert.doesNotMatch(JSON.stringify(items),/PRIVATE NOTE/);
  expectCode(()=>w.sources.context({excerpts:[e.id,e.id]}),'INVALID_INPUT');
});
test('pending changes and supplied-source provenance persist atomically, separate from support verdicts',t=>{
  const{workspace:w,document:d}=fixture(t);const s=add(w).snapshot,items=w.sources.context({snapshots:[s.id]});
  const c=w.proposeChanges(d.id,d.headRevisionId,[edit(w,d.id,0,'改稿')],'test',{items,instruction:'shorten'})[0]!;
  assert.equal(w.getDocument(d.id).headRevisionId,d.headRevisionId);assert.equal(w.sources.provenance(c.id)?.verification,'supplied-not-verified');
  w.accept(c.id);w.revert(c.id);assert.equal(w.sources.provenance(c.id)?.items[0]?.snapshotId,s.id);
});
test('forged source IDs, text and hashes reject the whole proposal transaction',t=>{
  const{workspace:w,document:d}=fixture(t);const s=add(w).snapshot,item=w.sources.context({snapshots:[s.id]})[0]!;
  const before=w.history(d.id);
  for(const item2 of [{...item,sourceId:'other'},{...item,text:'fake',contentHash:hashBytes('fake')},{...item,title:'invented'}]){
    expectCode(()=>w.proposeChanges(d.id,d.headRevisionId,[edit(w,d.id,0,'x')],'test',{items:[item2],instruction:'edit'}),'INVALID_INPUT');
    assert.deepEqual(w.listChanges(d.id),[]);assert.deepEqual(w.history(d.id),before);
  }
});
test('context insert failure rolls back pending edits',t=>{
  const{workspace:w,document:d}=fixture(t);const s=add(w).snapshot,items=w.sources.context({snapshots:[s.id]});
  const raw=new DatabaseSync(join(w.root,'.writer/workspace.sqlite'));raw.exec("CREATE TRIGGER context_failure BEFORE INSERT ON change_contexts BEGIN SELECT RAISE(ABORT,'context fail'); END;");raw.close();
  assert.throws(()=>w.proposeChanges(d.id,d.headRevisionId,[edit(w,d.id,0,'x')],'test',{items,instruction:'edit'}),/context fail/);
  assert.deepEqual(w.listChanges(d.id),[]);const verify=new DatabaseSync(join(w.root,'.writer/workspace.sqlite'));assert.equal(verify.prepare('SELECT count(*) n FROM proposal_contexts').get()?.n,0);verify.close();
});
test('bindings mark changed blocks stale, including ABA; unrelated blocks remain current',t=>{
  const{workspace:w,document:d}=fixture(t);const e=w.sources.extract(add(w).snapshot.id,1,1);const blocks=w.currentRevision(d.id).snapshot.blocks;
  w.sources.bind(d.id,blocks[0]!.id,e.id);w.sources.bind(d.id,blocks[1]!.id,e.id);
  const c=w.proposeChanges(d.id,d.headRevisionId,[edit(w,d.id,0,'x')])[0]!;w.accept(c.id);
  assert.deepEqual(w.sources.bindings(d.id).map(b=>b.state),['stale','current']);w.revert(c.id);
  assert.deepEqual(w.sources.bindings(d.id).map(b=>b.state),['stale','current']);
});
test('bindings reject blocks outside the selected document',t=>{
  const{workspace:w,document:d}=fixture(t);const other=w.createDocument('other','text');const b=w.currentRevision(other.id).snapshot.blocks[0]!;const e=w.sources.extract(add(w).snapshot.id,1,1);
  expectCode(()=>w.sources.bind(d.id,b.id,e.id),'NOT_FOUND');assert.deepEqual(w.sources.bindings(d.id),[]);
});
