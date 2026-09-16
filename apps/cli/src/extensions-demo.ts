// SPDX-License-Identifier: Apache-2.0
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Workspace } from '@writer-agent/storage';
import { DEFAULT_WORKFLOW_BUDGET, hashBytes } from '@writer-agent/core';
import type { WorkflowConfig, WorkflowRequest, WorkflowOutput, WorkflowContentRequest, SourceQuote } from '@writer-agent/core';
import { readSkillDirectory } from './skill-import.js';
import { registerMcp, discoverMcp } from './extensions-command.js';
import { executeWorkflow, makeWorkflowModel } from './workflow-runtime.js';

/** Synthetic fixtures only. They test host plumbing, not model reasoning or real research. */
export function extensionWorkflowFixture(r: WorkflowRequest): WorkflowOutput {
  const identity={protocolVersion:1 as const, runId:r.runId, requestId:r.requestId};
  if(r.task==='query-plan') return {...identity,task:'query-plan',queries:['synthetic battery limitations']};
  const itemIndex=r.sources.findIndex(s=>s.text.includes('12 percent'));
  const source=r.sources[itemIndex<0?0:itemIndex];
  const selected=itemIndex<0?0:itemIndex;
  const quote=source?.text.slice(0,Math.min(1200,source.text.length))??'';
  const citations:SourceQuote[]=source?[{itemIndex:selected,start:0,end:quote.length,quote}]:[];
  if(r.task==='outline')return {...identity,task:'outline',direction:'Describe a fictional battery observation without a causal claim.',summary:'Synthetic test material only.',sections:[
    {heading:'Battery endurance observation',points:['Report the synthetic 12% observation.'],sourceQuotes:citations},
    {heading:'Battery limitations and contrary results',points:['Retain the small sample and cold-room exception.'],sourceQuotes:citations}
  ],questions:[],gaps:['Synthetic fixture, not a finding about actual batteries.']};
  if(r.task==='draft-review'){
    const quote=r.draft!.markdown.slice(0,Math.min(100,r.draft!.markdown.length));
    return {...identity,task:'draft-review',issues:[{start:0,end:quote.length,quote,explanation:'Synthetic reviewer requests an explicit small-sample reminder.',sourceQuotes:citations}],needsRevision:true,notes:['Fixture assessment; no genuine inference was performed.']};
  }
  const body=r.section?.index===1?'Only six fictional samples were considered; a cold-room counterexample prevents generalization.':r.task==='draft-revision'?'In six fictional samples, endurance was reported as 12% longer; cold-room results differed. This is not a causal or real-world claim.':'The fictional report records a 12% endurance increase with limitations.';
  return {...identity,task:r.task,title:'Synthetic battery exercise',markdown:body+(source?`[^S${selected+1}]`:''),citations,limitations:['All content in this demonstration is fabricated for software testing.']};
}

/** Actual MCP stdio + model HTTP transports against local fixtures authored in this repository. */
export async function extensionsDemo():Promise<{root:string;documentId:string;runId:string;modelCalls:number;toolCalls:number}> {
  const base=mkdtempSync(join(tmpdir(),'siglum-extensions-demo-'));
  let w=Workspace.create(join(base,'writing'));
  const requests:WorkflowRequest[]=[];
  const server=createServer(async(req,res)=>{
    try {
      const chunks:Buffer[]=[];let bytes=0;
      for await(const chunk of req){bytes+=chunk.length;if(bytes>6_000_000)throw new Error('Fixture request limit');chunks.push(Buffer.from(chunk));}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {messages:{content:string}[]};
      const r=JSON.parse(body.messages[1]!.content) as WorkflowRequest;requests.push(r);
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({message:{role:'assistant',content:JSON.stringify(extensionWorkflowFixture(r))},done:true,done_reason:'stop',prompt_eval_count:10,eval_count:10}));
    }catch {res.writeHead(500);res.end();}
  });
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
    const fixture=fileURLToPath(new URL('../../../examples/mcp/fictional-server.mjs',import.meta.url));
    const skillDir=fileURLToPath(new URL('../../../examples/skills/source-check',import.meta.url));
    const skill=w.extensions.importSkill(readSkillDirectory(skillDir));w.extensions.setSkill(skill.id,true);
    const configured=await registerMcp(w,{name:'Siglum-owned synthetic MCP server',transport:'stdio',protocol:'2026-07-28',command:process.execPath,args:[fixture],cwd:dirname(fixture),env:[],timeoutMs:5000});
    // Explicit simulated author decisions; importing a server/skill never grants these implicitly.
    w.extensions.setTrust(configured.id,true);const catalog=await discoverMcp(w,configured.id);
    const config:WorkflowConfig={template:'new-article',title:'Synthetic battery writing exercise',goal:'Explain battery endurance, sample limitations, and contrary results.',publicBrief:'',language:'en',research:'selected',documentId:null,changeIds:[],selection:{},profileId:null,intent:null,memoryOptions:{language:'en'},model:{provider:'ollama',model:'extensions-fixture',baseURL:`http://127.0.0.1:${address.port}`,apiKeyEnv:null,allowRemote:false,responseFormat:'json-schema',tokenParameter:'max_completion_tokens',timeoutMs:5000,maxOutputTokens:4096},searchKeyEnv:'TAVILY_API_KEY',domains:[],timeRange:null,autoRevision:true,budget:{...DEFAULT_WORKFLOW_BUDGET},extensions:{skills:[{id:skill.id,references:[]}],calls:[{serverId:configured.id,catalogId:catalog.id,kind:'tool',name:'lookup',arguments:{query:'battery endurance limitations'},permission:'read'}],chapterDrafting:true}};
    let r=w.workflows.create(config);const id=r.id;
    const authorize=()=>{const p=w.workflows.preview(id);w.workflows.authorize(id,p.fingerprint,p.limits);};
    authorize();r=await executeWorkflow(w,id,{model:makeWorkflowModel(config.model)});
    assert.equal(r.state,'waiting-approval');assert.ok(r.outlineId);assert.equal(w.listDocuments().length,0);
    const outlinePacket=(w.workflows.artifact(r.outlineId).value as {request:WorkflowContentRequest}).request;
    assert.equal(outlinePacket.skills?.[0]?.hash,skill.package.hash);
    assert.match(outlinePacket.sources.map(s=>s.text).join('\n'),/12 percent/);
    assert.ok(outlinePacket.sources.some(s=>s.startLine>40));
    assert.equal(outlinePacket.sources[0]!.origin?.verification,'external-service-unverified');
    // Close/reopen at the approval point without regenerating the completed research.
    const root=w.root;w.close();w=Workspace.open(root);w.workflows.chooseOutline(id,r.outlineId);authorize();
    r=await executeWorkflow(w,id,{model:makeWorkflowModel(config.model)});
    assert.equal(r.candidateIds.length,2);assert.equal(w.listDocuments().length,0);
    assert.equal(requests.filter(x=>x.task==='draft'&&x.section).length,2);
    assert.equal(requests.filter(x=>x.task==='draft-review').length,1);
    const combined=w.workflows.artifact(r.candidateIds[0]!);assert.equal(combined.origin,'host');
    assert.ok(w.extensions.citations(combined.id)[0]!.map.bindings.length>=2);
    const toolCalls=w.workflows.attempts(id).filter(a=>a.kind==='tool').length;assert.equal(toolCalls,1);
    const documentId=w.workflows.adopt(id,r.candidateIds[0]!);assert.equal(w.workflows.adopt(id,r.candidateIds[0]!),documentId);
    const record=w.extensions.citations(documentId)[0]!;assert.equal(record.map.manuscriptHash,hashBytes(w.markdown(documentId)));
    assert.equal(record.freshness,'current');assert.equal(w.listDocuments().length,1);
    console.log(JSON.stringify({fixture:true,realInference:false,realWebSearch:false,thirdPartyInteropTested:false,root,runId:id,documentId,modelCalls:requests.length,toolCalls,evidenceLines:outlinePacket.sources.map(s=>[s.startLine,s.endLine]),citationBindings:record.map.bindings.length},null,2));
    console.log('EXTENSIONS_DEMO_OK');return {root,documentId,runId:id,modelCalls:requests.length,toolCalls};
  } finally {w.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
