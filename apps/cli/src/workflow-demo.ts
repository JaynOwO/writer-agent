// SPDX-License-Identifier: Apache-2.0
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { Workspace } from '@writer-agent/storage';
import { DEFAULT_WORKFLOW_BUDGET } from '@writer-agent/core';
import type { WorkflowConfig, WorkflowRequest, WorkflowOutput, SourceQuote } from '@writer-agent/core';
import { TavilySearch } from '@writer-agent/models';
import { executeWorkflow, makeWorkflowModel } from './workflow-runtime.js';
/** Explicit fictional fixture, never claimed to be genuine AI reasoning. Also used by regression tests. */
export function workflowFixture(r:WorkflowRequest):WorkflowOutput {
  const base={protocolVersion:1 as const,task:r.task,runId:r.runId,requestId:r.requestId};
  if(r.task==='query-plan')return {...base,task:'query-plan',queries:['fictional study sample uncertainty']};
  const s=r.sources[0];const citations:SourceQuote[]=s?[{itemIndex:0,start:0,end:s.text.length,quote:s.text}]:[];
  if(r.task==='outline')return {...base,task:'outline',direction:'Explain uncertainty, not an established causal effect.',summary:'Synthetic source-based overview; not factual research.',sections:[{heading:'What was observed',points:['Preserve the study limitations.'],sourceQuotes:citations}],gaps:['Fictional fixture only.'],questions:['Does this cautious direction match your goal?']};
  if(r.task==='draft-review'){const quote=r.draft!.markdown.split('\n')[0]!;return {...base,task:'draft-review',issues:[{start:0,end:quote.length,quote,explanation:'Fictional review: make the sample limitation clearer.',sourceQuotes:citations}],needsRevision:true,notes:['This is a scripted test assessment, not a real model judgment.']};}
  return {...base,task:r.task,title:'Synthetic uncertainty example',markdown:r.task==='draft'?'Some teams may improve.[^S1]':'Some teams may improve, but the sample is small.[^S1]',citations,limitations:['Fictional content for testing only.']};
}
export async function workflowDemo():Promise<{root:string;documentId:string;runId:string}>{
  const source='Fictional fixture: a small observational sample; no causal conclusion.',base=mkdtempSync(join(tmpdir(),'siglum-workflow-demo-')),w=Workspace.create(join(base,'writing'));
  const keyName='SIGLUM_WORKFLOW_DEMO_KEY',previous=process.env[keyName];process.env[keyName]='fictional-loopback-demo-key';
  const server=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',(c:Buffer)=>chunks.push(c));req.on('end',()=>{try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>;let result:unknown;
    if(req.url==='/search')result={query:body.query,results:[{url:'https://research.example.org/fixture',title:'Fictional study',content:source,score:0.5}],usage:{credits:0},request_id:'fixture-search'};
    else{const m=body.messages as {content:string}[];const r=JSON.parse(m[1]!.content) as WorkflowRequest;result={message:{role:'assistant',content:JSON.stringify(workflowFixture(r))},done:true,done_reason:'stop',prompt_eval_count:10,eval_count:10};}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));}catch{res.writeHead(500);res.end();}});});
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}`;
    const c:WorkflowConfig={template:'new-article',title:'Workflow fixture',goal:'Explain uncertainty from the supplied synthetic material.',publicBrief:'A fictional observational study and uncertainty.',language:'en',research:'web',documentId:null,changeIds:[],selection:{},profileId:null,intent:null,memoryOptions:{language:'en'},model:{provider:'ollama',model:'workflow-fixture',baseURL:url,apiKeyEnv:null,allowRemote:false,responseFormat:'json-schema',tokenParameter:'max_completion_tokens',timeoutMs:5000,maxOutputTokens:4096},searchKeyEnv:keyName,domains:['example.org'],timeRange:null,autoRevision:true,budget:{...DEFAULT_WORKFLOW_BUDGET}};
    const run=w.workflows.create(c),deps={model:makeWorkflowModel(c.model),search:new TavilySearch({keyEnv:keyName,testEndpoint:url+'/search'}),fetchPage:async(target:string)=>({url:target,raw:Buffer.from(source),mediaType:'text/plain' as const})};
    const first=w.workflows.preview(run.id);w.workflows.authorize(run.id,first.fingerprint,first.limits);
    const research=await executeWorkflow(w,run.id,deps);assert.equal(research.state,'waiting-approval');assert.ok(research.outlineId);assert.equal(w.listDocuments().length,0);
    w.workflows.chooseOutline(run.id,research.outlineId);const second=w.workflows.preview(run.id);w.workflows.authorize(run.id,second.fingerprint,second.limits);
    const composed=await executeWorkflow(w,run.id,deps);assert.equal(composed.candidateIds.length,2);assert.equal(w.listDocuments().length,0);
    const documentId=w.workflows.adopt(run.id,composed.candidateIds[1]!);assert.equal(w.workflows.adopt(run.id,composed.candidateIds[1]!),documentId);assert.equal(w.listDocuments().length,1);
    console.log(JSON.stringify({fixture:true,realInference:false,realSearch:false,root:w.root,runId:run.id,documentId,budget:w.workflows.usage(run.id),state:w.workflows.run(run.id).state},null,2));console.log('WORKFLOW_DEMO_OK');
    return {root:w.root,documentId,runId:run.id};
  }finally {w.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));if(previous===undefined)delete process.env[keyName];else process.env[keyName]=previous;}
}
