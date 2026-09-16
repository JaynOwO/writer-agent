// SPDX-License-Identifier: Apache-2.0
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { WriterError, validateWorkflowConfig, validateWorkflowBudget, renderWorkflowDraft } from '@writer-agent/core';
import type { WorkflowConfig, WorkflowBudget, WorkflowContentRequest, OutlineOutput, DraftOutput } from '@writer-agent/core';
import { Workspace } from '@writer-agent/storage';
import { parseAnalysisJson } from '@writer-agent/models';
import { executeWorkflow } from './workflow-runtime.js';
export const workflowHelp=`Siglum workflow v1 — bounded foreground execution, never auto-approved manuscripts

  siglum workflow guide <workspace> [--lang zh-CN|en]
  siglum workflow create <workspace> <config.json>
  siglum workflow list <workspace>
  siglum workflow show|attempts|artifacts|events <workspace> <runId>
  siglum workflow budget <workspace> <runId> <limits.json>
  siglum workflow compare <workspace> <runId> <beforeArtifactId> <afterArtifactId>
  siglum workflow preview <workspace> <runId> [limits.json]
  siglum workflow authorize <workspace> <runId> <previewFingerprint> [limits.json]
  siglum workflow run <workspace> <runId>
  siglum workflow recover <workspace> <runId>
  siglum workflow retry <workspace> <runId> <attemptId> [--ack-duplicate]
  siglum workflow revoke|cancel <workspace> <runId>
  siglum workflow refresh <workspace> <runId> [config.json]
  siglum workflow approve-outline <workspace> <runId> <artifactId>
  siglum workflow amend-outline <workspace> <runId> <artifactId> <outline-output.json>
  siglum workflow adopt <workspace> <runId> <artifactId>
  siglum workflow finish <workspace> <runId>
  siglum workflow export <workspace> <artifactId> <new-file.json>
  siglum workflow export-draft <workspace> <artifactId> <new-file.md>
  siglum demo:workflow

create/preview do not call networks. authorize records only the exact stage preview.
run invokes the approved sequence and may spend model/search credits. It is not --send on old commands.
Unknown external outcomes require explicit retry acknowledgement. recover refuses a live lease.
TAVILY_API_KEY is read only locally; never put its value in config or command arguments.
Export never overwrites. Artifacts are private/unverified material, not a published article.
`;
export function readWorkflowJson(path:string):unknown{const s=statSync(path);if(!s.isFile()||s.size>6_000_000)throw new WriterError('INVALID_INPUT','Expected a bounded JSON file.');return parseAnalysisJson(new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(path)));}
function count(a:string[],min:number,max=min){if(a.length<min||a.length>max)throw new WriterError('INVALID_INPUT','Wrong workflow arguments. See siglum workflow help.');}
const print=(v:unknown)=>console.log(JSON.stringify(v,null,2));
export async function workflowCommand(args:string[]):Promise<void>{
  const [action='help',...a]=args;if(action==='help'){count(a,0);console.log(workflowHelp);return;}
  if(action==='guide'){const {workflowGuideCommand}=await import('./workflow-guide.js');await workflowGuideCommand(a);return;}
  const arities:Record<string,[number,number]>={create:[2,2],list:[1,1],show:[2,2],attempts:[2,2],artifacts:[2,2],events:[2,2],budget:[3,3],compare:[4,4],preview:[2,3],authorize:[3,4],run:[2,2],recover:[2,2],retry:[3,4],revoke:[2,2],cancel:[2,2],refresh:[2,3],'approve-outline':[3,3],'amend-outline':[4,4],adopt:[3,3],finish:[2,2],export:[3,3],'export-draft':[3,3]};
  if(!Object.hasOwn(arities,action))throw new WriterError('INVALID_INPUT','Unknown workflow action.');count(a,...arities[action]!);
  const w=Workspace.open(a[0]!),s=w.workflows,id=a[1]!;const controller=new AbortController(),cancel=()=>controller.abort();
  try {
    if(action==='create'){const c=readWorkflowJson(id);validateWorkflowConfig(c);print(s.create(c));}
    else if(action==='list')print(s.list());
    else if(action==='show')print({run:s.run(id),attemptBudget:s.usage(id),monetaryCost:'unknown',notice:'Persisted state; use preview to check freshness before execution.'});
    else if(action==='attempts')print(s.attempts(id));else if(action==='artifacts')print(s.artifacts(id));else if(action==='events')print(s.events(id));
    else if(action==='budget'){const v=readWorkflowJson(a[2]!);validateWorkflowBudget(v);print(s.setBudget(id,v));}
    else if(action==='compare')print(s.compare(id,a[2]!,a[3]!));
    else if(action==='preview'||action==='authorize'){
      const file=action==='preview'?a[2]:a[3];let limits:WorkflowBudget|undefined;if(file){const v=readWorkflowJson(file);validateWorkflowBudget(v);limits=v;}
      print(action==='preview'?s.preview(id,limits):s.authorize(id,a[2]!,limits));
    }else if(action==='run'){process.once('SIGINT',cancel);process.once('SIGTERM',cancel);print(await executeWorkflow(w,id,undefined,controller.signal));}
    else if(action==='recover'){s.recover(id);print(s.run(id));}
    else if(action==='retry'){if(a[3]!==undefined&&a[3]!=='--ack-duplicate')throw new WriterError('INVALID_INPUT','Use --ack-duplicate only to explicitly allow a possibly repeated request.');s.retry(id,a[2]!,a[3]==='--ack-duplicate');print(s.run(id));}
    else if(action==='revoke'||action==='cancel'){s.pause(id,action==='cancel');print(s.run(id));}
    else if(action==='refresh'){const cfg=a[2]?readWorkflowJson(a[2]):undefined;if(cfg!==undefined)validateWorkflowConfig(cfg);print(s.refresh(id,cfg as WorkflowConfig|undefined));}
    else if(action==='approve-outline')print(s.chooseOutline(id,a[2]!));
    else if(action==='amend-outline')print(s.amendOutline(id,a[2]!,readWorkflowJson(a[3]!) as OutlineOutput));
    else if(action==='adopt')print({documentId:s.adopt(id,a[2]!),publishedExternally:false});
    else if(action==='finish'){s.finish(id);print(s.run(id));}
    else {
      const artifact=s.artifact(id);let content=JSON.stringify(artifact,null,2)+'\n';
      if(action==='export-draft'){if(!['draft','draft-revision'].includes(artifact.type))throw new WriterError('INVALID_INPUT','Choose a candidate draft artifact.');const v=artifact.value as {output:DraftOutput;request:WorkflowContentRequest};content=renderWorkflowDraft(v.output,v.request.sources);}
      writeFileSync(a[2]!,content,{encoding:'utf8',flag:'wx',mode:0o600});print({exported:true,artifactId:id,approved:false});
    }
  }finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);w.close();}
}
