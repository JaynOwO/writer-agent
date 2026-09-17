// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync, symlinkSync, linkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PanelApplication, servePanel, diagnosticTask } from '../src/server.mjs';
import { readTaskLog, redactLogText, LOG_TAIL_BYTES } from '../src/task-log.mjs';
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'siglum-panel-log-'));
  const a=new PanelApplication(root,{loadTools:()=>{throw Error('Tools must not load for local diagnostics.');}});
  t.after(()=>{a.store.close();rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:100});});
  let task=a.store.create({repositoryId:'1370967185',version:'0.0.9',bundleHash:'a'.repeat(64),repoPath:'PRIVATE/PATH',baseSha:'b'.repeat(40),targetTree:'c'.repeat(40),authorized:true});
  task=a.store.change(task.id,task.revision,{state:'applied',error:{code:'PROCESS_FAILED',message:'A required command did not complete successfully.',details:{exitCode:1,signal:null,stdout:'test group failed',stderr:'specific synthetic assertion',unknownSecret:'NEVER_EXPORT'}}},'failed');
  return {root,a,task,path:join(root,'logs',task.id+'.log')};
}
test('saved failure logs are readable without configuration, tool loading or task execution',t=>{
  const f=fixture(t);writeFileSync(f.path,'Saved before restart\n');
  const old=f.a.store.get(f.task.id),events=f.a.store.events(f.task.id);
  const r=f.a.taskSnapshot(f.task.id);
  assert(r.output.includes('Saved before restart'));assert(r.output.includes('specific synthetic assertion'));
  assert.deepEqual(f.a.store.get(f.task.id),old);assert.deepEqual(f.a.store.events(f.task.id),events);assert.equal(f.a.jobs.size,0);
});
test('log read survives reopening with no in-memory output',t=>{
  const f=fixture(t);writeFileSync(f.path,'persisted log 中文\n');f.a.store.close();
  const reopened=new PanelApplication(f.root);t.after(()=>reopened.store.close());
  assert.equal(reopened.output.size,0);assert(reopened.taskSnapshot(f.task.id).output.includes('persisted log 中文'));
  // Close before the parent fixture's cleanup, independent of test-hook ordering.
  reopened.store.close();
});
test('missing log retains saved exit code and stderr, not an empty success',t=>{
  const f=fixture(t),r=f.a.failureReport({id:f.task.id,confirm:true});
  assert.equal(r.log.available,false);assert.equal(r.processError.exitCode,1);
  assert.equal(r.processError.stderrTail,'specific synthetic assertion');assert.equal(r.diagnostic.state,'applied');
});
test('log tail allocation is bounded and records omitted prefix',t=>{
  const f=fixture(t);writeFileSync(f.path,'x'.repeat(LOG_TAIL_BYTES+5000)+'\nFINAL FAILURE\n');
  const r=readTaskLog(f.root,f.task.id);assert.equal(r.bytesRead,LOG_TAIL_BYTES);assert(r.truncated);assert(r.startByte>0);assert(r.text.endsWith('FINAL FAILURE\n'));
});
test('log growth after initial read appears on next snapshot',t=>{
  const f=fixture(t);writeFileSync(f.path,'first\n');assert.equal(readTaskLog(f.root,f.task.id).text,'first\n');
  appendFileSync(f.path,'second\n');assert.equal(readTaskLog(f.root,f.task.id).text,'first\nsecond\n');
});
test('unsafe task IDs cannot choose a file',t=>{
  const f=fixture(t);for(const id of ['../../config','/etc/passwd','x\\y','a'.repeat(81),'short'])assert.throws(()=>readTaskLog(f.root,id));
});
test('unsafe or zero tail limits fail',t=>{
  const f=fixture(t);for(const maxBytes of [0,-1,Infinity,LOG_TAIL_BYTES+1,1.5])assert.throws(()=>readTaskLog(f.root,f.task.id,{maxBytes}));
});
test('linked task log is refused rather than reading the other file',t=>{
  const f=fixture(t),outside=join(f.root,'unrelated.txt');writeFileSync(outside,'unrelated secret');
  // Hard links work on Windows without developer-mode symlink privileges.
  linkSync(outside,f.path);assert.throws(()=>readTaskLog(f.root,f.task.id),{code:'UNSAFE_PATH'});
  const r=f.a.taskSnapshot(f.task.id);assert(!r.output.includes('unrelated secret'));assert(r.logInfo.error);
});
test('symlink log directory is refused',t=>{
  const f=fixture(t),logs=join(f.root,'logs'),other=join(f.root,'other');rmSync(logs,{recursive:true});mkdirSync(other);
  symlinkSync(other,logs,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>readTaskLog(f.root,f.task.id),{code:'UNSAFE_PATH'});
});
test('failure report exports only the requested task and whitelisted errors',t=>{
  const f=fixture(t);writeFileSync(f.path,'specific selected task');const other=f.a.store.create({version:'other',secret:'OTHER_TASK_SECRET'});
  writeFileSync(join(f.root,'logs',other.id+'.log'),'OTHER_TASK_LOG');
  const r=f.a.failureReport({id:f.task.id,confirm:true}),text=JSON.stringify(r);
  assert(!text.includes('OTHER_TASK'));assert(!text.includes('NEVER_EXPORT'));assert(!text.includes('PRIVATE/PATH'));
  assert(r.noTaskExecution&&r.noGitHubRequest);assert(r.log.tail.includes('specific selected task'));
});
test('unknown existing-file task and missing explicit export consent are refused',t=>{
  const f=fixture(t);writeFileSync(join(f.root,'logs','unknown-12345.log'),'DO NOT READ');
  assert.throws(()=>f.a.failureReport({id:'unknown-12345',confirm:true}),{code:'TASK_NOT_FOUND'});
  assert.throws(()=>f.a.failureReport({id:f.task.id}),{code:'CONFIRMATION_REQUIRED'});
});
test('metadata diagnostic remains free of logs and process details',t=>{
  const f=fixture(t),text=JSON.stringify(diagnosticTask(f.task));
  assert(!text.includes('specific synthetic'));assert(!text.includes('NEVER_EXPORT'));assert(!text.includes('PRIVATE/PATH'));
});
test('known credential patterns and terminal escape sequences are masked',()=>{
  const cases=['gho_'+'A'.repeat(30),'github_pat_'+'B'.repeat(30),'sk-proj-'+'C'.repeat(30),'Bearer hidden-token','Basic abcdef==','https://user:pass@host.test/?api_key=hidden'];
  for(const raw of cases){const out=redactLogText(raw);assert.notEqual(out,raw);assert(out.includes('REDACTED'));}
  assert.equal(redactLogText('\x1b[31m中文😀\x1b[0m\r\n'),'中文😀\r\n');
});
test('export route requires authentication, same-origin POST and explicit confirmation',async t=>{
  const f=fixture(t);writeFileSync(f.path,'SAVED LOCAL ERROR');const panel=await servePanel(f.a);t.after(()=>panel.close());
  const url=panel.origin+'/api/failure-report',headers={Authorization:'Bearer '+panel.token,Origin:panel.origin,'Content-Type':'application/json'};
  assert.equal((await fetch(url,{method:'POST',headers:{Origin:panel.origin,'Content-Type':'application/json'},body:JSON.stringify({id:f.task.id,confirm:true})})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://evil.invalid'},body:JSON.stringify({id:f.task.id,confirm:true})})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({id:f.task.id})})).status,400);
  const r=await fetch(url,{method:'POST',headers,body:JSON.stringify({id:f.task.id,confirm:true})});assert.equal(r.status,200);assert((await r.json()).log.tail.includes('SAVED LOCAL ERROR'));
  assert.equal((await fetch(url+'?id='+f.task.id,{headers:{Authorization:'Bearer '+panel.token}})).status,404);
  const snap=await fetch(panel.origin+'/api/task?id='+f.task.id,{headers:{Authorization:'Bearer '+panel.token}});assert.equal(snap.status,200);assert((await snap.json()).output.includes('SAVED LOCAL ERROR'));
  await panel.close();
});
