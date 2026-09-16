// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_WORKFLOW_BUDGET } from '@writer-agent/core';
import type { WorkflowConfig, WorkflowRequest } from '@writer-agent/core';
import { fixture } from './helpers.js';
import { reviewFixture } from './analysis-helpers.js';
import type { ModelRequest } from '@writer-agent/models';
import type { RuntimeModel, WorkflowDependencies } from '../../apps/cli/src/workflow-runtime.js';
export const {workflowFixture,workflowDemo}=await import(new URL('../../apps/cli/dist/workflow-demo.js',import.meta.url).href) as typeof import('../../apps/cli/src/workflow-demo.js');
export const {executeWorkflow}=await import(new URL('../../apps/cli/dist/workflow-runtime.js',import.meta.url).href) as typeof import('../../apps/cli/src/workflow-runtime.js');
export const {runWorkflowGuide}=await import(new URL('../../apps/cli/dist/workflow-guide.js',import.meta.url).href) as typeof import('../../apps/cli/src/workflow-guide.js');
export function workflowConfig(extra:Partial<WorkflowConfig>={}):WorkflowConfig {
  return {template:'new-article',title:'Fictional research',goal:'Explain selected fictional findings carefully.',publicBrief:'Public fictional observations',language:'en',research:'selected',documentId:null,changeIds:[],selection:{},profileId:null,intent:null,memoryOptions:{language:'en'},model:{provider:'ollama',model:'workflow-fixture',baseURL:'http://127.0.0.1:11434',apiKeyEnv:null,allowRemote:false,responseFormat:'json-schema',tokenParameter:'max_completion_tokens',timeoutMs:1000,maxOutputTokens:4096},searchKeyEnv:'TAVILY_API_KEY',domains:[],timeRange:null,autoRevision:true,budget:{...DEFAULT_WORKFLOW_BUDGET},...extra};
}
export function workflowSetup(t:Parameters<typeof fixture>[0],extra:Partial<WorkflowConfig>={}){
  const f=fixture(t);const source=f.workspace.sources.add({kind:'file',locator:'fiction.txt',raw:Buffer.from('Fictional observation; small sample; not a causal conclusion.'),mediaType:'text/plain'});
  const c=workflowConfig({selection:{snapshots:[source.snapshot.id]},...extra});const run=f.workspace.workflows.create(c);return {...f,w:f.workspace,run,c,source};
}
export function modelFixture(hook?:(r:WorkflowRequest)=>Promise<void>|void):RuntimeModel{
  return {id:'ollama/workflow-fixture',describe:()=>({provider:'ollama',model:'workflow-fixture',endpoint:'http://127.0.0.1:11434/api/chat',responseFormat:'json-schema',timeoutMs:1000,maxOutputTokens:4096}),workflowTask:async r=>{await hook?.(r);return {providerId:'ollama/workflow-fixture',output:workflowFixture(r),usage:null};},propose:async(r:ModelRequest)=>({protocolVersion:1,providerId:'ollama/workflow-fixture',documentId:r.documentId,baseRevisionId:r.baseRevisionId,edits:[{blockId:r.snapshot.blocks[0]!.id,before:r.snapshot.blocks[0]!.text,after:r.snapshot.blocks[0]!.text+' Edited.',summary:'Fictional revision'}],notes:[]}),extractClaims:async r=>({providerId:'ollama/workflow-fixture',output:reviewFixture(r),usage:null}),reviewChanges:async r=>({providerId:'ollama/workflow-fixture',output:reviewFixture(r),usage:null})};
}
export function grant(w:ReturnType<typeof workflowSetup>['w'],id:string){const p=w.workflows.preview(id);return w.workflows.authorize(id,p.fingerprint,p.limits);}
export function dependencies(hook?:(r:WorkflowRequest)=>Promise<void>|void):WorkflowDependencies{return {model:modelFixture(hook)};}
