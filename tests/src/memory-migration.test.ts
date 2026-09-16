// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,existsSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace,migrateWorkspace } from '@writer-agent/storage';
import { temporary,propose,expectCode } from './helpers.js';
import { card,pref } from './memory-helpers.js';
import {candidate,providerInfo,reviewFixture} from './analysis-helpers.js';
const {SCHEMA_V1_SQL}=await import(new URL('../../packages/storage/dist/schema.js',import.meta.url).href) as {SCHEMA_V1_SQL:string};
const {SOURCES_SQL}=await import(new URL('../../packages/storage/dist/source-schema.js',import.meta.url).href) as {SOURCES_SQL:string};
const {ANALYSIS_SQL}=await import(new URL('../../packages/storage/dist/analysis-schema.js',import.meta.url).href) as {ANALYSIS_SQL:string};
function legacy(t:Parameters<typeof temporary>[0],version:1|2|3){
  const root=join(temporary(t),'Legacy workspace 数据'),path=join(root,'.writer/workspace.sqlite');mkdirSync(join(root,'.writer'),{recursive:true});const db=new DatabaseSync(path);
  try{db.exec(SCHEMA_V1_SQL+(version>=2?SOURCES_SQL:'')+(version>=3?ANALYSIS_SQL:'')+`PRAGMA user_version=${version}`);db.prepare('INSERT INTO workspace(id,name,created_at) VALUES(?,?,?)').run('w','legacy','2026-09-15');}finally{db.close();}
  const w=Workspace.open(root);let runId:string|null=null;
  try{const d=w.createDocument('old','你好😀\r\n\r\nSome teams may improve.'),c=propose(w,d.id,0,'你好😀！');
    if(version>=2){const s=w.sources.add({kind:'file',locator:'data.txt',mediaType:'text/plain',raw:Buffer.from('original source')});w.sources.extract(s.snapshot.id,1,1);}
    if(version===3){w.analysis.add(d.id,candidate(w.currentRevision(d.id).snapshot));const req=w.analysis.prepare(d.id,'semantic-review',{instruction:'review',changeIds:[c.id]});assert.equal(req.memory,undefined);runId=w.analysis.save(req,reviewFixture(req),providerInfo,null,0).id;}
    return {root,path,documentId:d.id,runId};
  }finally{w.close();}
}
function rows(path:string){const db=new DatabaseSync(path,{readOnly:true});try{const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name!='sqlite_sequence' ORDER BY name").all().map(r=>String(r.name));return Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT * FROM '+t).all()]));}finally{db.close();}}
for(const version of [1,2,3] as const){
 test(`v${version} remains readable, previews v4 without writes and requires memory migration`,t=>{const {root,path}=legacy(t,version),before=rows(path);assert.equal(migrateWorkspace(root).to,4);assert.deepEqual(rows(path),before);assert.equal(existsSync(join(root,'.writer/backups')),false);const w=Workspace.open(root);try{expectCode(()=>w.memory.profiles(),'MIGRATION_REQUIRED');assert.equal(w.info().schemaVersion,version);}finally{w.close();}});
 test(`v${version} -> v4 backs up and preserves every old table row`,t=>{const {root,path,documentId,runId}=legacy(t,version),before=rows(path),m=migrateWorkspace(root,true);assert.ok(m.backup);assert.deepEqual(rows(m.backup),before);const after=rows(path);for(const [k,v]of Object.entries(before))assert.deepEqual(after[k],v,k);const w=Workspace.open(root);try{assert.equal(w.info().schemaVersion,4);const p=w.memory.createProfile('new');w.memory.addPreference(p.id,pref());w.memory.attach(documentId,p.id);w.memory.saveIntent(documentId,card());if(runId){const report=w.analysis.report(runId);assert.equal(report.request.memory,undefined);assert.equal(report.promptVersion,'analysis-v1');}assert.equal(w.history(documentId).length,1);}finally{w.close();}assert.equal(migrateWorkspace(root,true).needed,false);assert.equal(readdirSync(join(root,'.writer/backups')).length,1);});
}
test('v3-to-v4 DDL failure rolls back all added tables without losing sources or analyses',t=>{const {root,path}=legacy(t,3),db=new DatabaseSync(path);try{db.exec('CREATE TABLE preference_versions(dummy TEXT)');}finally{db.close();}const before=rows(path);expectCode(()=>migrateWorkspace(root,true),'CORRUPT_DATA');assert.deepEqual(rows(path),before);const check=new DatabaseSync(path);try{assert.equal(check.prepare('PRAGMA user_version').get()!.user_version,3);assert.equal(check.prepare("SELECT count(*) n FROM sqlite_master WHERE name='writing_profiles'").get()!.n,0);}finally{check.close();}assert.equal(existsSync(join(root,'.writer/migration.lock')),false);assert.equal(readdirSync(join(root,'.writer/backups')).length,1);});
