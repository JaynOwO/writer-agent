// SPDX-License-Identifier: Apache-2.0
import { WriterError, isRecord } from './errors.js';
import { validateText } from './document.js';
import { hashBytes, validateSourceContext } from './sources.js';
import { normalizeSourceUrl } from './source-policy.js';
import { exactObject, stringIds, validateSourceQuotes } from './analysis.js';
import { validateIntentCard, normalizeMemoryOptions, validateMemoryPacket } from './memory.js';
import type { WorkflowBudget, WorkflowConfig, WorkflowRequest, WorkflowContentRequest, WorkflowOutput, WorkflowModel, WorkflowStage, WorkflowTemplate, SourceContextItem, DraftOutput } from './index.js';
export const WORKFLOW_MAX_BYTES=6_000_000;
export const DEFAULT_WORKFLOW_BUDGET:WorkflowBudget={models:8,searches:3,fetches:5,activeMs:900000};
export function wfError(message:string):never {throw new WriterError('WORKFLOW_INVALID',message);}
export function wfInteger(v:unknown,min:number,max:number):asserts v is number {if(!Number.isSafeInteger(v)||(v as number)<min||(v as number)>max)wfError('Invalid workflow count or time limit.');}
const text=(v:unknown,max=2000,empty=false)=>{validateText(v);if((v as string).length>max||(!empty&&!(v as string).trim()))wfError('Workflow text is empty or too long.');};
export function validateWorkflowBudget(v:unknown):asserts v is WorkflowBudget{
  exactObject(v,['models','searches','fetches','activeMs']);wfInteger(v.models,0,40);wfInteger(v.searches,0,12);wfInteger(v.fetches,0,30);wfInteger(v.activeMs,100,7200000);
}
export function validateWorkflowModel(v:unknown):asserts v is WorkflowModel {
  exactObject(v,['provider','model','baseURL','apiKeyEnv','allowRemote','responseFormat','tokenParameter','timeoutMs','maxOutputTokens']);
  if(!['ollama','openai-compatible'].includes(v.provider as string)||!['json-schema','json','prompt'].includes(v.responseFormat as string)||!['max_tokens','max_completion_tokens'].includes(v.tokenParameter as string)||typeof v.allowRemote!=='boolean')wfError('Unknown workflow model settings.');
  if(typeof v.model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,127}$/.test(v.model))wfError('Invalid model identifier.');
  if(v.apiKeyEnv!==null&&(typeof v.apiKeyEnv!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(v.apiKeyEnv)))wfError('Use an environment-variable name, not a key.');
  try {if(typeof v.baseURL!=='string'||/[\s\\]/.test(v.baseURL)||v.baseURL.length>2048)throw Error();const u=new URL(v.baseURL);if(u.username||u.password||u.hash||u.search||!['http:','https:'].includes(u.protocol))throw Error();if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&(!v.allowRemote||u.protocol!=='https:'))throw Error();}catch{wfError('Use a loopback model URL or explicitly authorized HTTPS endpoint without URL credentials.');}
  wfInteger(v.timeoutMs,10,600000);wfInteger(v.maxOutputTokens,128,32768);
}
export function validateWorkflowConfig(v:unknown):asserts v is WorkflowConfig {
  exactObject(v,['template','title','goal','publicBrief','language','research','documentId','changeIds','selection','profileId','intent','memoryOptions','model','searchKeyEnv','domains','timeRange','autoRevision','budget']);
  if(!['new-article','revise-article','review-changes'].includes(v.template as string)||!['zh-CN','en'].includes(v.language as string)||!['web','selected'].includes(v.research as string)||typeof v.autoRevision!=='boolean')wfError('Unknown workflow template/language/mode.');
  text(v.title,200);text(v.goal,10000);text(v.publicBrief,4000,true);stringIds(v.changeIds,100);
  if(v.template==='new-article'){if(v.documentId!==null||v.changeIds.length)wfError('A new candidate is not an existing document.');}
  else {text(v.documentId,200);if(v.research!=='selected'||v.profileId!==null||v.intent!==null)wfError('Existing-document templates use their current intent/profile and explicit existing sources.');if(v.template==='review-changes'&&(!v.changeIds.length||v.autoRevision))wfError('Review-only needs changes and cannot revise.');if(v.template==='revise-article'&&v.changeIds.length)wfError('Revision template proposes its own alternatives.');}
  if(v.research==='web'&&!(v.publicBrief as string).trim())wfError('Web research requires a separate explicitly public brief.');
  if(v.profileId!==null)text(v.profileId,200);
  if(v.intent!==null){validateIntentCard(v.intent);if(v.intent.importantOccurrenceIds.length)wfError('New-article intent cannot refer to nonexistent manuscript occurrences.');}
  if(!isRecord(v.selection)||Object.keys(v.selection).some(k=>!['snapshots','excerpts'].includes(k)))wfError('Unknown source selection fields.');
  stringIds(v.selection.snapshots??[],8);stringIds(v.selection.excerpts??[],8);
  const memoryOptions=normalizeMemoryOptions(v.memoryOptions as never);if(memoryOptions.language&&memoryOptions.language!=='any'&&memoryOptions.language!==v.language)wfError('Workflow and memory selection languages must agree.');if(v.intent!==null&&(v.intent as {language:string}).language!=='any'&&(v.intent as {language:string}).language!==v.language)wfError('Workflow and intent languages must agree.');validateWorkflowModel(v.model);validateWorkflowBudget(v.budget);
  if(typeof v.searchKeyEnv!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(v.searchKeyEnv))wfError('Search key must be specified by environment name.');
  stringIds(v.domains,20);for(const d of v.domains)if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d))wfError('Domain limits must be lower-case DNS names, not URLs/wildcards.');
  if(v.timeRange!==null&&!['day','week','month','year'].includes(v.timeRange as string))wfError('Unsupported time range.');
  if(Buffer.byteLength(JSON.stringify(v))>160000)wfError('Workflow config too large.');
}
export function workflowStage(template:WorkflowTemplate):WorkflowStage{return template==='new-article'?'research':template==='revise-article'?'edit':'audit';}
export function stageTasks(stage:WorkflowStage):string[]{return ({research:['query-plan','search','fetch','outline'],compose:['draft','draft-review','draft-revision'],edit:['propose','semantic-review','revise-proposal'],audit:['semantic-review']} as const)[stage].slice();}
export function publicResultUrl(value:string,domains:readonly string[]):string {
  const u=normalizeSourceUrl(value);
  if(domains.length&&!domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))throw new WriterError('SOURCE_BLOCKED','Result outside approved domain scope.');
  return u.href;
}
export function workflowHash(value:unknown):string{return hashBytes(JSON.stringify(value));}
export function validateWorkflowRequest(v:unknown):asserts v is WorkflowRequest {
  if(!isRecord(v))wfError('Invalid workflow request.');
  if(v.task==='query-plan'){
    exactObject(v,['protocolVersion','task','runId','requestId','publicBrief','language','maxQueries']);text(v.publicBrief,4000);wfInteger(v.maxQueries,1,3);
  }else{
    exactObject(v,['protocolVersion','task','runId','requestId','goal','language','guidance','sources','gaps','feedback','outline','draft','review']);
    if(!['outline','draft','draft-review','draft-revision'].includes(v.task as string))wfError('Unknown workflow task.');text(v.goal,10000);text(v.feedback,4000,true);
    if(v.guidance!==null)validateMemoryPacket(v.guidance);validateSourceContext(v.sources);stringList(v.gaps,60,2000);
    if(v.task!=='outline'&&v.outline===null)wfError('Writing needs an approved outline.');
    if((v.task==='draft-review'||v.task==='draft-revision')&&v.draft===null)wfError('Review/revision needs an actual candidate.');
    if(v.task==='draft-revision'&&v.review===null)wfError('Revision needs its parent review.');
    const current=v as unknown as WorkflowContentRequest;
    if(current.outline!==null){const o=current.outline;if(!isRecord(o)||o.runId!==current.runId||o.task!=='outline')wfError('Outline belongs to another task.');text(o.requestId,200);checkWorkflowOutput(o,{...current,task:'outline',requestId:o.requestId});}
    if(current.draft!==null){const d=current.draft;if(!isRecord(d)||d.runId!==current.runId||!['draft','draft-revision'].includes(d.task as string))wfError('Invalid candidate parent.');text(d.requestId,200);checkWorkflowOutput(d,{...current,task:d.task as 'draft'|'draft-revision',requestId:d.requestId});}
    if(current.review!==null){const r=current.review;if(current.draft===null||!isRecord(r)||r.runId!==current.runId||r.task!=='draft-review')wfError('Invalid review parent.');text(r.requestId,200);checkWorkflowOutput(r,{...current,task:'draft-review',requestId:r.requestId});}

  }
  if(v.protocolVersion!==1||!['zh-CN','en'].includes(v.language as string))wfError('Unknown workflow request version/language.');text(v.runId,200);text(v.requestId,200);
  if(Buffer.byteLength(JSON.stringify(v))>WORKFLOW_MAX_BYTES)wfError('Workflow request exceeds the input bound.');
}
function stringList(v:unknown,max:number,size:number):asserts v is string[]{if(!Array.isArray(v)||v.length>max)wfError('Too many strings.');for(const s of v)text(s,size);}
export function validateWorkflowOutput(v:unknown,request:WorkflowRequest):asserts v is WorkflowOutput {
  validateWorkflowRequest(request);checkWorkflowOutput(v,request);
}
function checkWorkflowOutput(v:unknown,request:WorkflowRequest):asserts v is WorkflowOutput {
  if(!isRecord(v))wfError('Expected a JSON workflow result.');
  if(v.protocolVersion!==1||v.task!==request.task||v.runId!==request.runId||v.requestId!==request.requestId)wfError('Workflow result identity does not match this task.');
  const common=['protocolVersion','task','runId','requestId'];
  if(request.task==='query-plan'){
    exactObject(v,[...common,'queries']);stringIds(v.queries,request.maxQueries);if(!v.queries.length)wfError('No search queries proposed.');for(const q of v.queries)text(q,400);
  }else if(request.task==='outline'){
    exactObject(v,[...common,'direction','summary','sections','gaps','questions']);text(v.direction,2000);text(v.summary,8000);stringList(v.gaps,20,2000);stringList(v.questions,10,1000);
    if(!Array.isArray(v.sections)||!v.sections.length||v.sections.length>20)wfError('Outline needs 1–20 sections.');
    for(const s of v.sections){exactObject(s,['heading','points','sourceQuotes']);text(s.heading,300);stringList(s.points,20,1000);validateSourceQuotes(s.sourceQuotes,request.sources);}
  }else if(request.task==='draft'||request.task==='draft-revision'){
    exactObject(v,[...common,'title','markdown','citations','limitations']);text(v.title,200);text(v.markdown,200000);stringList(v.limitations,20,2000);validateSourceQuotes(v.citations,request.sources);
    // Only host-provided footnotes are source links. Reject model-invented URL destinations.
    if(/(?:https?:\/\/|\]\(\s*(?:file:|javascript:|data:))/i.test(v.markdown as string)||/^\[\^S\d+\]:/m.test(v.markdown as string))wfError('Use host-resolved [^S1] source markers, not model-authored URLs/footnote definitions.');
    const markers=[...(v.markdown as string).matchAll(/\[\^S(\d+)\]/g)].map(m=>Number(m[1])-1);
    for(const index of markers)if(!request.sources[index]||!(v.citations as {itemIndex:number}[]).some(q=>q.itemIndex===index))wfError('Source marker has no exact selected quote.');
    for(const q of v.citations as {itemIndex:number}[])if(!markers.includes(q.itemIndex))wfError('A cited quote needs a corresponding manuscript source marker.');
  }else{
    exactObject(v,[...common,'issues','needsRevision','notes']);if(!Array.isArray(v.issues)||v.issues.length>50||typeof v.needsRevision!=='boolean')wfError('Invalid candidate review.');stringList(v.notes,20,2000);
    const draft=request.draft!;
    for(const item of v.issues){exactObject(item,['start','end','quote','explanation','sourceQuotes']);wfInteger(item.start,0,draft.markdown.length);wfInteger(item.end,1,draft.markdown.length);text(item.quote,10000);text(item.explanation,2000);if((item.end as number)<=(item.start as number)||draft.markdown.slice(item.start as number,item.end as number)!==item.quote)wfError('Review quote is not an exact candidate span.');validateSourceQuotes(item.sourceQuotes,request.sources);}
    if(v.needsRevision&&!v.issues.length)wfError('A revision request needs at least one anchored issue.');
  }
  if(Buffer.byteLength(JSON.stringify(v))>1000000)wfError('Workflow output exceeds its bound.');
}
/** Host-generated footnotes bind to immutable selected material; not a factual endorsement. */
export function renderWorkflowDraft(draft:DraftOutput,sources:readonly SourceContextItem[]):string {
  const indices=[...new Set([...draft.markdown.matchAll(/\[\^S(\d+)\]/g)].map(m=>Number(m[1])-1))];
  return draft.markdown+(indices.length?'\n\n'+indices.map(i=>{const s=sources[i];if(!s)wfError('Missing stored source for export.');return `[^S${i+1}]: ${s.locator.replace(/[\r\n]/g,' ')} — snapshot ${s.snapshotId}; extracted-text lines ${s.startLine}–${s.endLine}. Supplied material, not verified support.`;}).join('\n'):'');
}
