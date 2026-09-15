// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Workspace } from '@writer-agent/storage';
import { temporary } from './helpers.js';
import { fakeServer, json, requestFromBody, wire, ollamaEnvelope, chatEnvelope } from './provider-helpers.js';
const cli=fileURLToPath(new URL('../../apps/cli/dist/index.js',import.meta.url));
function run(args:string[]){return spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:20000});}
function success(args:string[]){const r=run(args);assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
function runAsync(args:string[]) {
  return new Promise<{status:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
    const c=spawn(process.execPath,[cli,...args],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    const timer=setTimeout(()=>{c.kill();reject(new Error('CLI timed out'));},20000);
    c.stdout.on('data',(b:Buffer)=>stdout+=b.toString());c.stderr.on('data',(b:Buffer)=>stderr+=b.toString());
    c.on('error',e=>{clearTimeout(timer);reject(e);});c.on('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr});});
  });
}
function fixture(t:Parameters<typeof temporary>[0]) {
  const root=temporary(t),dir=join(root,'workspace'),w=Workspace.create(dir),d=w.createDocument('D','可能相关。\n\n未改动段落。');
  const s=w.sources.add({kind:'file',locator:'资料.txt',raw:Buffer.from('SOURCE SELECTED\n保留推测语气。\nDO NOT SEND LAST LINE'),mediaType:'text/plain'});
  const ex=w.sources.extract(s.snapshot.id,2,2);w.sources.note(s.snapshot.id,'SECRET PRIVATE NOTE');w.close();return{root,dir,d,s,ex};
}
test('CLI source commands import, list, show, extract, note, search, bind and export in spaced Unicode paths',t=>{
  const{root,dir,d}=fixture(t);const file=join(root,'新 资料.md');writeFileSync(file,'第一行\r\n第二行😀\r\n');
  const imported=JSON.parse(success(['source','import',dir,file])) as {source:{id:string};snapshot:{id:string}};
  assert.match(success(['source','list',dir]),new RegExp(imported.source.id));
  assert.match(success(['source','show',dir,imported.snapshot.id]),/第二行/);
  const ex=JSON.parse(success(['source','extract',dir,imported.snapshot.id,'--lines','2:2'])) as {id:string;quote:string};assert.equal(ex.quote,'第二行😀');
  success(['source','note',dir,imported.snapshot.id,'这只是笔记','--excerpt',ex.id]);assert.match(success(['source','notes',dir,imported.snapshot.id]),/这只是笔记/);
  const search=JSON.parse(success(['source','search',dir,'第二行'])) as {results:unknown[]};assert.equal(search.results.length,1);
  const w=Workspace.open(dir);const block=w.currentRevision(d.id).snapshot.blocks[0]!;w.close();
  success(['source','bind',dir,d.id,block.id,ex.id]);assert.match(success(['source','links',dir,d.id]),/user-linked-not-verified/);
  const output=join(root,'source export');success(['source','export',dir,imported.snapshot.id,output]);
  assert.deepEqual(readFileSync(join(output,'raw.bin')),readFileSync(file));assert.equal(existsSync(join(output,'text.txt')),true);
  const duplicate=run(['source','export',dir,imported.snapshot.id,output]);assert.notEqual(duplicate.status,0);assert.deepEqual(readFileSync(join(output,'raw.bin')),readFileSync(file));
});
test('source add preview returns without any network lookup, snapshot or manuscript change',t=>{
  const{dir,d}=fixture(t);const result=JSON.parse(success(['source','add',dir,'https://does-not-exist.invalid/report'])) as {fetched:boolean;status:string};assert.equal(result.fetched,false);assert.equal(result.status,'preview-only');
  const w=Workspace.open(dir);assert.equal(w.sources.list().length,1);assert.equal(w.history(d.id).length,1);w.close();
});
test('CLI refuses local addresses and ignores no invalid fetch/overwrite options',t=>{
  const{dir,s}=fixture(t);
  for(const args of [['source','add',dir,'http://127.0.0.1/','--fetch'],['source','add',dir,'https://example.org/','--unsafe'],['source','extract',dir,s.snapshot.id,'--lines','x:y'],['source','note',dir,s.snapshot.id,'hi','--bad','x']])assert.equal(run(args).status,2);
});
test('suggest source preview discloses selected IDs/byte counts but not source bodies or notes',t=>{
  const{dir,d,ex}=fixture(t);
  const out=success(['suggest',dir,d.id,'--provider','ollama','--model','synthetic','--instruction','edit','--excerpts',ex.id]);
  assert.match(out,new RegExp(ex.id));assert.doesNotMatch(out,/保留推测语气|SECRET PRIVATE NOTE|DO NOT SEND/);assert.equal(JSON.parse(out).sent,false);
});
for(const provider of ['ollama','openai-compatible'])test(`${provider} receives only selected excerpt; persistent proposal context is supplied-not-verified`,async t=>{
  const{dir,d,ex,s}=fixture(t);
  const server=await fakeServer(t,(req,res)=>{
    const body=JSON.stringify(req.body);assert.match(body,new RegExp(ex.id));assert.match(body,/保留推测语气/);assert.doesNotMatch(body,/SECRET PRIVATE NOTE|DO NOT SEND LAST LINE/);
    const p=wire(requestFromBody(req.body));json(res,provider==='ollama'?ollamaEnvelope(p):chatEnvelope(p));
  });
  const r=await runAsync(['suggest',dir,d.id,'--provider',provider,'--model','synthetic','--instruction','edit','--base-url',server.base,'--excerpts',ex.id,'--send']);
  assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout) as {changes:{id:string}[]};const c=result.changes[0]!;
  const provenance=JSON.parse(success(['provenance',dir,c.id])) as {verification:string;items:{snapshotId:string;text:string}[]};
  assert.equal(provenance.verification,'supplied-not-verified');assert.equal(provenance.items[0]?.snapshotId,s.snapshot.id);assert.equal(provenance.items[0]?.text,ex.quote);
  const w=Workspace.open(dir);assert.equal(w.markdown(d.id),'可能相关。\n\n未改动段落。');w.close();
});
test('nonexistent source and duplicate source selections fail before any model request',async t=>{
  const{dir,d,ex}=fixture(t);const server=await fakeServer(t,(_q,res)=>json(res,{}));
  const args=['suggest',dir,d.id,'--provider','ollama','--model','synthetic','--instruction','edit','--base-url',server.base,'--send'];
  for(const val of ['missing',ex.id+','+ex.id]){const r=await runAsync([...args,'--excerpts',val]);assert.equal(r.status,2,r.stderr);}
  assert.equal(server.requests.length,0);
});
test('source refresh during inference does not silently replace the selected immutable snapshot',async t=>{
  const{dir,d,s}=fixture(t);
  const server=await fakeServer(t,(req,res)=>{
    const w=Workspace.open(dir);w.sources.add({kind:'file',locator:'资料.txt',sourceId:s.source.id,mediaType:'text/plain',raw:Buffer.from('NEW SNAPSHOT')});w.close();
    json(res,ollamaEnvelope(wire(requestFromBody(req.body))));
  });
  const r=await runAsync(['suggest',dir,d.id,'--provider','ollama','--model','synthetic','--instruction','edit','--base-url',server.base,'--sources',s.snapshot.id,'--send']);assert.equal(r.status,0,r.stderr);
  const w=Workspace.open(dir),change=w.listChanges(d.id)[0]!;assert.equal(w.sources.provenance(change.id)?.items[0]?.snapshotId,s.snapshot.id);assert.equal(w.sources.history(s.source.id).length,2);w.close();
});
test('source-aware stale document response saves neither model proposal nor context',async t=>{
  const{dir,d,s}=fixture(t);
  const server=await fakeServer(t,(req,res)=>{
    const w=Workspace.open(dir),rev=w.currentRevision(d.id),b=rev.snapshot.blocks[0]!;
    const c=w.proposeChanges(d.id,rev.id,[{blockId:b.id,before:b.text,after:'人类已编辑',summary:'manual'}])[0]!;w.accept(c.id);w.close();
    json(res,ollamaEnvelope(wire(requestFromBody(req.body))));
  });
  const r=await runAsync(['suggest',dir,d.id,'--provider','ollama','--model','synthetic','--instruction','edit','--base-url',server.base,'--sources',s.snapshot.id,'--send']);assert.equal(r.status,2);assert.match(r.stderr,/STALE_REVISION/);
  const w=Workspace.open(dir);assert.equal(w.listChanges(d.id).length,1);assert.equal(w.sources.provenance(w.listChanges(d.id)[0]!.id),null);w.close();
});
test('source demo completes offline and explicitly calls its data synthetic',()=>{
  const output=success(['demo:sources']);assert.match(output,/SOURCES_DEMO_OK/);assert.match(output,/synthetic source/);assert.match(output,/supplied-not-verified/);
});
test('custom provider cannot rewrite the application-owned source provenance by mutating its request',async t=>{
  const{dir,d,ex}=fixture(t);const w=Workspace.open(dir);try {
  const {suggestChanges}=await import(new URL('../../apps/cli/dist/suggest.js',import.meta.url).href) as {
    suggestChanges: (w:Workspace,id:string,instruction:string,provider:import('@writer-agent/models').ModelProvider,s?:AbortSignal,selection?:{excerpts:string[]})=>Promise<{changes:{id:string}[]}>;
  };
  const provider:import('@writer-agent/models').ModelProvider={id:'synthetic-mutation',async propose(request){
    const block=request.snapshot.blocks[0]!;
    const context=request.sources![0]! as {text:string};context.text='FAKE EVIDENCE';
    return{providerId:this.id,protocolVersion:1,documentId:request.documentId,baseRevisionId:request.baseRevisionId,
      edits:[{blockId:block.id,before:block.text,after:'修改后的虚构测试文本',summary:'synthetic'}],notes:[]};
  }};
  const result=await suggestChanges(w,d.id,'edit',provider,undefined,{excerpts:[ex.id]});
  assert.equal(w.sources.provenance(result.changes[0]!.id)?.items[0]?.text,ex.quote);
  assert.equal(w.markdown(d.id),'可能相关。\n\n未改动段落。');
  }finally{w.close();}
});
