// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '@writer-agent/storage';
import type { MemoryTaskRequest,MemoryTaskOutput,IntentCard,PreferenceInput } from '@writer-agent/core';
import type { ModelProvider,MemoryProvider } from '@writer-agent/models';
import { runMemoryTask } from './memory-command.js';
import { suggestChanges } from './suggest.js';
/** Synthetic fixtures. No model download, external network request or user workspace is touched. */
export async function memoryDemo(){
  const dir=mkdtempSync(join(tmpdir(),'siglum-memory-demo-')),w=Workspace.create(join(dir,'workspace'),'Disposable memory fixture');let reopened:Workspace|undefined;
  try{
    const d=w.createDocument('Fictional article','一些团队可能受益。'),p=w.memory.createProfile('Chinese explanation');w.memory.attach(d.id,p.id);
    const card:IntentCard={language:'zh-CN',audience:'普通读者',purpose:'解释一个虚构示例',thesis:'',rules:[],importantOccurrenceIds:[]};w.memory.saveIntent(d.id,card);
    const pref:PreferenceInput={rule:{key:'tone',value:'formal',strength:'preferred'},language:'zh-CN',tasks:['revise','review'],priority:1,example:null};w.memory.addPreference(p.id,pref);
    const editor:ModelProvider={id:'fixture/editor',propose:async r=>{const b=r.snapshot.blocks[0]!;assert.equal(r.guidance!.entries[0]!.rule.value,'formal');return {protocolVersion:1,providerId:'fixture/editor',documentId:r.documentId,baseRevisionId:r.baseRevisionId,edits:[{blockId:b.id,before:b.text,after:'值得注意的是，一些团队可能受益。',summary:'Synthetic change for rejection'}],notes:['Fixture, not real inference.']};}};
    const changes=await suggestChanges(w,d.id,'简化，不改变断言强度。',editor);w.reject(changes.changes[0]!.id,'不要加空洞套话','voice');
    const decision=w.decisions(d.id).at(-1)!;const request=w.memory.prepareTask(d.id,'preference-draft',{brief:'',language:'zh-CN',profileId:p.id,decisionIds:[decision.id],tasks:['revise','review']});
    const reply=async(r:MemoryTaskRequest)=>{const output:MemoryTaskOutput={protocolVersion:1,requestId:r.requestId,task:'preference-draft',candidates:[{rule:{key:'avoid-phrase',value:'值得注意的是',strength:'preferred'},evidenceIds:[r.evidence[0]!.decisionId],explanation:'A scripted fixture, based on this selected explanation only.'}],notes:[]};return {providerId:'fixture/memory',output,usage:null};};
    const provider:MemoryProvider={id:'fixture/memory',describe:()=>({model:'fixture',endpoint:'http://127.0.0.1:1/api/chat',responseFormat:'json-schema',timeoutMs:1000,maxOutputTokens:4096}),draftIntent:reply,draftPreferences:reply};
    const result=await runMemoryTask(w,request,provider);
    assert.equal(w.memory.plan(d.id,'revise').capture.packet.entries.length,1);w.memory.decidePreferences([result.preferences[0]!.id],'activate');
    assert.equal(w.memory.plan(d.id,'revise').capture.packet.entries.length,2);
    const temporary=w.memory.plan(d.id,'revise',{exceptions:[{key:'tone',value:'casual',strength:'preferred'}]});assert.ok(temporary.capture.packet.entries.some(e=>e.rule.value==='casual'));
    assert.ok(w.memory.plan(d.id,'revise').capture.packet.entries.some(e=>e.rule.value==='formal'));
    const other=w.memory.createProfile('Unrelated empty profile');w.memory.attach(d.id,other.id);assert.equal(w.memory.plan(d.id,'revise').capture.packet.entries.length,0);
    w.memory.attach(d.id,p.id);const uses=w.memory.uses(d.id);assert.equal(uses.length,1);assert.equal(w.history(d.id).length,1);assert.equal(w.markdown(d.id),'一些团队可能受益。');
    w.close();reopened=Workspace.open(w.root);assert.equal(reopened.memory.uses(d.id).length,1);assert.equal(reopened.memory.preferences(p.id).filter(x=>x.status==='active').length,2);
    console.log('MEMORY_DEMO_OK — explicit intent/profile, pending proposals, optional rejection reason, candidate-only distillation, selected confirmation, scoped reuse, temporary override and preserved usage history. Scripted fixtures; no actual AI.');
  }finally{reopened?.close();w.close();rmSync(dir,{recursive:true,force:true});}
}
