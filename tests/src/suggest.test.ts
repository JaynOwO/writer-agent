// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '@writer-agent/storage';
import { temporary } from './helpers.js';
import {fakeServer,json,requestFromBody,wire,chatEnvelope,ollamaEnvelope} from './provider-helpers.js';
const cli=fileURLToPath(new URL('../../apps/cli/dist/index.js',import.meta.url));
function run(args:string[]) {
  return new Promise<{status:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
    const child=spawn(process.execPath,[cli,...args],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill();reject(new Error('CLI test timeout'));},20000);
    child.stdout.on('data',(b:Buffer)=>{stdout+=b.toString();});child.stderr.on('data',(b:Buffer)=>{stderr+=b.toString();});
    child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr});});
  });
}
function fixture(t:Parameters<typeof temporary>[0]) {
  const dir=join(temporary(t),'workspace');const w=Workspace.create(dir);const d=w.createDocument('test','甲可能成立。\n\n乙。');w.close();return{dir,d};
}
function args(dir:string,id:string,base:string,provider='ollama') {return ['suggest',dir,id,'--provider',provider,'--model','synthetic-test','--base-url',base,'--instruction','精简但不改变含义'];}
test('suggest preview sends no HTTP request and creates no proposal',async t=>{
  const{dir,d}=fixture(t);const s=await fakeServer(t,(_req,res)=>json(res,{}));const r=await run(args(dir,d.id,s.base));
  assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).sent,false);assert.equal(s.requests.length,0);
  const w=Workspace.open(dir);try{assert.equal(w.listChanges(d.id).length,0);}finally{w.close();}
});
for(const provider of ['ollama','openai-compatible'])test(`CLI ${provider} validates and saves pending changes, not manuscript edits`,async t=>{
  const{dir,d}=fixture(t);const s=await fakeServer(t,(req,res)=>{const proposal=wire(requestFromBody(req.body));json(res,provider==='ollama'?ollamaEnvelope(proposal):chatEnvelope(proposal));});
  const r=await run([...args(dir,d.id,s.base,provider),'--send']);assert.equal(r.status,0,r.stderr);
  const output=JSON.parse(r.stdout) as {status:string;manuscriptChanged:boolean;changes:{id:string;status:string}[];modelNotes:{verified:boolean;persisted:boolean}};
  assert.equal(output.status,'pending-review');assert.equal(output.manuscriptChanged,false);assert.equal(output.modelNotes.verified,false);assert.equal(output.modelNotes.persisted,false);
  const w=Workspace.open(dir);try{assert.equal(w.markdown(d.id),'甲可能成立。\n\n乙。');assert.equal(w.history(d.id).length,1);assert.equal(w.decisions(d.id).length,0);assert.equal(w.listChanges(d.id)[0]?.status,'pending');}finally{w.close();}
  const accepted=await run(['accept',dir,output.changes[0]!.id,'明确接受']);assert.equal(accepted.status,0,accepted.stderr);
  const reverted=await run(['revert',dir,output.changes[0]!.id,'保留原句']);assert.equal(reverted.status,0,reverted.stderr);
});
test('a document changed during inference refuses the entire stale model batch',async t=>{
  const{dir,d}=fixture(t);const s=await fakeServer(t,(req,res)=>{
    const proposal=wire(requestFromBody(req.body));const w=Workspace.open(dir);
    try{const revision=w.currentRevision(d.id);const b=revision.snapshot.blocks[1]!;const[c]=w.proposeChanges(d.id,revision.id,[{blockId:b.id,before:b.text,after:'用户已改写乙。',summary:'用户修改'}]);assert.ok(c);w.accept(c.id);}finally{w.close();}
    json(res,ollamaEnvelope(proposal));
  });
  const r=await run([...args(dir,d.id,s.base),'--send']);assert.equal(r.status,2);assert.match(r.stderr,/STALE_REVISION/);
  const w=Workspace.open(dir);try{assert.equal(w.markdown(d.id),'甲可能成立。\n\n用户已改写乙。');assert.equal(w.listChanges(d.id).length,1);}finally{w.close();}
});
for(const kind of ['wrong-before','bad-json','extra-fields','http-error','timeout'])test(`CLI failure ${kind} saves no partial changes`,async t=>{
  const{dir,d}=fixture(t);const s=await fakeServer(t,(req,res)=>{
    const p=wire(requestFromBody(req.body));if(kind==='timeout')return;
    if(kind==='http-error'){json(res,{error:'do-not-print-this-secret'},429);return;}
    if(kind==='bad-json'){res.writeHead(200,{'content-type':'application/json'});res.end('{');return;}
    if(kind==='wrong-before')p.edits[0]!.before='wrong';
    json(res,ollamaEnvelope(kind==='extra-fields'?{...p,autoAccept:true}:p));
  });
  const r=await run([...args(dir,d.id,s.base),'--timeout-ms','100','--send']);assert.equal(r.status,3,r.stderr);assert.doesNotMatch(r.stderr,/do-not-print-this-secret/);
  const w=Workspace.open(dir);try{assert.equal(w.getDocument(d.id).headRevisionId,d.headRevisionId);assert.equal(w.listChanges(d.id).length,0);assert.equal(w.decisions(d.id).length,0);}finally{w.close();}
});
test('an empty valid response changes neither text nor history',async t=>{const{dir,d}=fixture(t);const s=await fakeServer(t,(req,res)=>json(res,ollamaEnvelope({...wire(requestFromBody(req.body)),edits:[]})));const r=await run([...args(dir,d.id,s.base),'--send']);assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout).changes,[]);const w=Workspace.open(dir);try{assert.equal(w.history(d.id).length,1);}finally{w.close();}});
test('remote opt-in and auth failures happen before any request',async t=>{
  const{dir,d}=fixture(t);let r=await run([...args(dir,d.id,'https://example.invalid/v1','openai-compatible'),'--send']);assert.equal(r.status,3);assert.match(r.stderr,/PROVIDER_CONFIG/);
  const s=await fakeServer(t,(_req,res)=>json(res,{}));r=await run([...args(dir,d.id,s.base,'openai-compatible'),'--key-env','WRITER_TEST_MISSING_9AD31','--send']);assert.equal(r.status,3);assert.match(r.stderr,/PROVIDER_AUTH/);assert.equal(s.requests.length,0);
});
test('UTF-8 instruction files and spaces work without exposing instruction contents in preview',async t=>{const{dir,d}=fixture(t);const file=join(dir,'编辑要求 含空格.txt');writeFileSync(file,'请保留推测语气。');const a=args(dir,d.id,'http://127.0.0.1:11434');a.splice(-2,2,'--instruction-file',file);const r=await run(a);assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stdout,/请保留推测语气/);});
test('unknown, duplicate, missing, mixed and invalid numeric options return usage errors',async t=>{
  const{dir,d}=fixture(t);const a=args(dir,d.id,'http://127.0.0.1:11434');
  for(const extra of [['--api-key','DO_NOT_ECHO_SECRET'],['--send','--send'],['--model','other'],['--instruction-file','missing'],['--timeout-ms','abc'],['--response-format','json'],['--key-env']]){
    const r=await run([...a,...extra]);assert.equal(r.status,2,r.stderr);assert.doesNotMatch(r.stderr,/DO_NOT_ECHO_SECRET/);
  }
});
test('model command is offline and does not require a workspace',async()=>{const r=await run(['model']);assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout).providers,['ollama','openai-compatible']);});
test('separate provider HTTP demo runs both wire formats without real AI',async()=>{
  const script=fileURLToPath(new URL('../../apps/cli/dist/provider-demo.js',import.meta.url));
  const result=await new Promise<string>((resolve,reject)=>{const c=spawn(process.execPath,[script],{stdio:['ignore','pipe','pipe']});let out='',err='';c.stdout.on('data',(b:Buffer)=>out+=String(b));c.stderr.on('data',(b:Buffer)=>err+=String(b));c.on('error',reject);c.on('close',status=>status===0?resolve(out):reject(new Error(err)));});
  assert.match(result,/PROVIDER_DEMO_OK/);assert.match(result,/fake HTTP only/);
});
