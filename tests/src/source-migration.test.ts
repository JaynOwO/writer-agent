// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdirSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { Workspace, migrateWorkspace } from '@writer-agent/storage';
import { temporary, propose, expectCode } from './helpers.js';
const {SCHEMA_V1_SQL}=await import(new URL('../../packages/storage/dist/schema.js',import.meta.url).href) as {SCHEMA_V1_SQL:string};
function legacy(t:Parameters<typeof temporary>[0]) {
  const dir=join(temporary(t),'old workspace');mkdirSync(join(dir,'.writer'),{recursive:true});
  const path=join(dir,'.writer','workspace.sqlite'),db=new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL;'+SCHEMA_V1_SQL);db.prepare('INSERT INTO workspace(id,name,created_at) VALUES(?,?,?)').run('ws_old','v002',new Date().toISOString());db.close();
  const w=Workspace.open(dir),d=w.createDocument('原稿','甲可能成立。\r\n\r\n乙。');
  const c=propose(w,d.id,0,'甲成立。');w.accept(c.id,'old accept');w.revert(c.id,'old revert');w.close();return{dir,path,d};
}
function rows(path:string) {
  const db=new DatabaseSync(path,{readOnly:true});try{return ['workspace','documents','revisions','changes','decisions'].map(table=>db.prepare('SELECT * FROM '+table).all());}finally{db.close();}
}
test('old schema remains usable for original editing without implicit migration',t=>{
  const{dir}=legacy(t);const w=Workspace.open(dir);try{assert.equal(w.info().schemaVersion,1);assert.equal(w.listDocuments().length,1);assert.deepEqual(w.sources.context({}),[]);expectCode(()=>w.sources.list(),'MIGRATION_REQUIRED');}finally{w.close();}
});
test('migration preview does not change schema, make backup or modify manuscript records',t=>{
  const{dir,path}=legacy(t),before=rows(path);const r=migrateWorkspace(dir);assert.equal(r.applied,false);assert.equal(r.from,1);assert.equal(r.to,3);assert.equal(r.needed,true);
  assert.deepEqual(rows(path),before);assert.equal(existsSync(join(dir,'.writer','backups')),false);const w=Workspace.open(dir);assert.equal(w.info().schemaVersion,1);w.close();
});
test('explicit migration makes a readable v1 backup, retains every old row and enables sources',t=>{
  const{dir,path,d}=legacy(t),before=rows(path);const r=migrateWorkspace(dir,true);assert.equal(r.applied,true);assert.ok(r.backup);assert.deepEqual(rows(path),before);assert.deepEqual(rows(r.backup),before);
  const w=Workspace.open(dir);try{assert.equal(w.info().schemaVersion,3);assert.equal(w.history(d.id).length,3);assert.equal(w.markdown(d.id),'甲可能成立。\r\n\r\n乙。');assert.deepEqual(w.sources.list(),[]);w.sources.add({kind:'file',locator:'a.txt',raw:Buffer.from('source'),mediaType:'text/plain'});}finally{w.close();}
  const backup=new DatabaseSync(r.backup,{readOnly:true});assert.equal(backup.prepare('PRAGMA user_version').get()?.user_version,1);backup.close();assert.equal(existsSync(join(dir,'.writer','migration.lock')),false);
});
test('repeated migration is a no-op and does not create a second backup',t=>{
  const{dir}=legacy(t);migrateWorkspace(dir,true);const before=readdirSync(join(dir,'.writer','backups'));const r=migrateWorkspace(dir,true);
  assert.equal(r.applied,false);assert.equal(r.needed,false);assert.deepEqual(readdirSync(join(dir,'.writer','backups')),before);
});
test('a schema creation failure rolls back and retains an independently readable backup',t=>{
  const{dir,path}=legacy(t);const raw=new DatabaseSync(path);raw.exec('CREATE TABLE sources(dummy TEXT)');raw.close();const before=rows(path);
  expectCode(()=>migrateWorkspace(dir,true),'CORRUPT_DATA');assert.deepEqual(rows(path),before);assert.equal(existsSync(join(dir,'.writer','migration.lock')),false);
  const check=new DatabaseSync(path);assert.equal(check.prepare('PRAGMA user_version').get()?.user_version,1);assert.equal(check.prepare("SELECT count(*) n FROM sqlite_master WHERE name='source_snapshots'").get()?.n,0);check.close();
  assert.equal(readdirSync(join(dir,'.writer','backups')).length,1);
});
test('active migration locks block opening/editing without being removed by another process',t=>{
  const{dir}=legacy(t);writeFileSync(join(dir,'.writer','migration.lock'),'test-owned-lock');
  expectCode(()=>Workspace.open(dir),'WORKSPACE_BUSY');expectCode(()=>migrateWorkspace(dir,true),'WORKSPACE_BUSY');assert.ok(existsSync(join(dir,'.writer','migration.lock')));
});
test('unknown schema and wrong application IDs are refused without a backup or reset',t=>{
  const{dir,path}=legacy(t);const db=new DatabaseSync(path);db.exec('PRAGMA user_version=999');db.close();
  expectCode(()=>migrateWorkspace(dir,true),'UNSUPPORTED_SCHEMA');assert.equal(existsSync(join(dir,'.writer','backups')),false);
  const fix=new DatabaseSync(path);fix.exec('PRAGMA user_version=1; PRAGMA application_id=123');fix.close();expectCode(()=>migrateWorkspace(dir,true),'UNSUPPORTED_SCHEMA');
});
