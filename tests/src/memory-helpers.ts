// SPDX-License-Identifier: Apache-2.0
import type { MemoryTaskRequest, MemoryTaskOutput, IntentCard, PreferenceInput, MemoryPlan } from '@writer-agent/core';
import type { MemoryProvider, ModelProvider } from '@writer-agent/models';
import { providerInfo } from './analysis-helpers.js';
const cli = new URL('../../apps/cli/dist/', import.meta.url);
export const {runMemoryTask,parseMemoryTaskArgs,memoryCommand} = await import(new URL('memory-command.js',cli).href) as typeof import('../../apps/cli/src/memory-command.js');
export const {prepareSuggestion,submitSuggestion,suggestChanges}=await import(new URL('suggest.js',cli).href) as typeof import('../../apps/cli/src/suggest.js');
export const {runWizard,menuChoose}=await import(new URL('wizard.js',cli).href) as typeof import('../../apps/cli/src/wizard.js');
export const {WizardCancelled,terminalText}=await import(new URL('terminal.js',cli).href) as typeof import('../../apps/cli/src/terminal.js');
export const card=(patch:Partial<IntentCard>={}):IntentCard=>({language:'zh-CN',audience:'普通读者',purpose:'解释一个虚构示例',thesis:'',rules:[],importantOccurrenceIds:[],...patch});
export const pref=(patch:Partial<PreferenceInput>={}):PreferenceInput=>({rule:{key:'guidance',value:'保留不确定性',strength:'preferred'},language:'zh-CN',tasks:['revise','review'],priority:0,example:null,...patch});
export function memoryFixture(r:MemoryTaskRequest):MemoryTaskOutput{
  return r.task==='intent-draft'?{protocolVersion:1,task:r.task,requestId:r.requestId,card:{audience:'',purpose:r.brief,thesis:'',rules:[]},basis:[{field:'purpose',start:0,end:r.brief.length,quote:r.brief}],suggestedFields:[],questions:[]}:
  {protocolVersion:1,task:r.task,requestId:r.requestId,candidates:[{rule:{key:'avoid-phrase',value:'值得注意的是',strength:'preferred'},evidenceIds:[r.evidence[0]!.decisionId],explanation:'Synthetic candidate from the chosen author explanation; not a learned fact.'}],notes:[]};
}
export function memoryProvider(transform?:(r:MemoryTaskRequest)=>Promise<unknown>):MemoryProvider{
  const reply=async(r:MemoryTaskRequest)=>transform?await transform(r):{providerId:providerInfo.providerId,output:memoryFixture(r),usage:null};
  return {id:providerInfo.providerId,describe:()=>({...providerInfo,tokenParameter:'max_tokens'}),draftIntent:async r=>await reply(r) as Awaited<ReturnType<MemoryProvider['draftIntent']>>,draftPreferences:async r=>await reply(r) as Awaited<ReturnType<MemoryProvider['draftPreferences']>>};
}
export function editProvider(callback?:(r:Parameters<ModelProvider['propose']>[0])=>void):ModelProvider{
  return {id:'fixture/editor',propose:async r=>{callback?.(r);const b=r.snapshot.blocks[0]!;return {protocolVersion:1,providerId:'fixture/editor',documentId:r.documentId,baseRevisionId:r.baseRevisionId,edits:[{blockId:b.id,before:b.text,after:b.text+' Edited.',summary:'Synthetic edit'}],notes:[]};}};
}
export function scriptIO(answers:string[]){
  const remaining=[...answers],lines:string[]=[];
  return {lines,remaining,line:(text:string)=>lines.push(text),ask:async(prompt:string)=>{lines.push(prompt);if(!remaining.length)throw new WizardCancelled();return remaining.shift()!;}};
}
export const packet=(p:MemoryPlan)=>p.capture.packet;
