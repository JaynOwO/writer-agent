// SPDX-License-Identifier: Apache-2.0
/** Shared desktop application service. No renderer-controlled filesystem or shell API. */
import { Workspace, migrateWorkspace } from '@writer-agent/storage';
import { WriterError, requireString, exactObject, isRecord, workflowHash, newId,
  renderCitedDraft, renderWorkflowDraft, validateWorkflowConfig,
  validateIntentCard, validateText, stringIds } from '@writer-agent/core';
import type { WorkflowConfig, WorkflowContentRequest, DraftOutput, SourceSelection,
  AnalysisRequest, WorkflowBudget } from '@writer-agent/core';
import { prepareSuggestion, submitSuggestion } from '../suggest.js';
import type { SuggestionCapture } from '../suggest.js';
import { runAnalysis } from '../analysis-command.js';
import { executeWorkflow } from '../workflow-runtime.js';
import { ConnectionStore, attachPreset } from './presets.js';
import type { ConnectionPreset, PresetSettings } from './presets.js';
import { modelFromPreset, presetDependencies } from './connections-runtime.js';
import { localDiagnostics, recoveryView, safeProductCode, prepareProbe, runProbe } from './diagnostics.js';
import type { ProbePlan } from './diagnostics.js';
import { reportSnapshot, renderReadingReport } from './report.js';
import type { ReportOptions } from './report.js';

export interface DesktopJob {
  id:string; kind:string; target:string|null; state:'running'|'completed'|'failed'|'cancelled';
  startedAt:string; finishedAt:string|null; result:unknown; error:{code:string;message:string}|null;
}
interface Ticket { id:string; fingerprint:string; expires:number; kind:'suggest'|'review'|'probe';
  preview:unknown; capture:SuggestionCapture|AnalysisRequest|ProbePlan; preset:ConnectionPreset|null; workspaceId:string|null }
function invalid(message:string):never {throw new WriterError('INVALID_INPUT',message);}
function object(v:unknown, required:string[], optional:string[]=[]):Record<string,unknown>{
  if(!isRecord(v))invalid('Expected an object.');
  exactObject(v,[...required,...optional.filter(k=>v[k]!==undefined)]);return v;
}
function text(v:unknown,label='text',max=10000):string{requireString(v,label,max);return v;}
function flag(v:unknown):boolean{if(typeof v!=='boolean')invalid('Expected an explicit boolean.');return v;}
function strings(v:unknown):string[]{stringIds(v,1000);return [...v];}
function count(v:unknown):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)invalid('Expected a non-negative integer.');return v;}
const publicPreset=(p:ConnectionPreset)=>({id:p.id,version:p.version,name:p.name,settings:p.settings,enabled:p.enabled,credentialMode:p.credential.mode});
function selection(v:unknown):SourceSelection{const r=object(v,['snapshots','excerpts']);return {snapshots:strings(r.snapshots),excerpts:strings(r.excerpts)};}
export function desktopError(e:unknown){return {code:safeProductCode(e),message:e instanceof WriterError ? e.message : 'The operation stopped. Credentials and raw remote error bodies are not displayed. Inspect the saved task or connection settings.'};}
export class DesktopApplication {
  private workspace:Workspace|null=null;
  private tickets=new Map<string,Ticket>();
  private jobs=new Map<string,{value:DesktopJob;controller:AbortController;promise:Promise<void>}>();
  private shuttingDown=false;
  constructor(readonly connections=new ConnectionStore()){}
  get activeJobs(){return [...this.jobs.values()].filter(j=>j.value.state==='running').length;}
  private w():Workspace {if(!this.workspace)throw new WriterError('NOT_FOUND','Open a writing workspace first.');return this.workspace;}
  /** Host-only: directory must come from a native file dialog, never renderer RPC. */
  openWorkspace(root:string,create=false,name='My writing workspace'){
    if(this.activeJobs)throw new WriterError('WORKSPACE_BUSY','Stop the active task before changing workspaces.');
    const next=create?Workspace.create(root,name):Workspace.open(root);
    this.workspace?.close();this.workspace=next;this.tickets.clear();
    return {info:next.info(),migrationRequired:next.info().schemaVersion<7};
  }
  /** Host-only: explicit native confirmation is needed before calling this. */
  migrateCurrent(){const w=this.w(),root=w.root;if(this.activeJobs)throw new WriterError('WORKSPACE_BUSY','Stop active tasks before migration.');w.close();this.workspace=null;try{const result=migrateWorkspace(root,true);this.workspace=Workspace.open(root);this.tickets.clear();return result;}catch(e){try{this.workspace=Workspace.open(root);}catch{}throw e;}}
  migrationPreview(){return migrateWorkspace(this.w().root);}
  importDocument(title:string,markdown:string){text(title,'title',512);validateText(markdown);return this.w().createDocument(title,markdown);}
  importSource(name:string,raw:Uint8Array,mediaType:'text/plain'|'text/markdown'|'text/html'){return this.w().sources.add({kind:'file',locator:name,raw,mediaType});}
  exportDocument(id:string){return this.w().markdown(text(id,'document ID',200));}
  exportReport(options:ReportOptions){return renderReadingReport(reportSnapshot(this.w(),options));}
  private listJobs(){return [...this.jobs.values()].map(j=>j.value);}
  private start(kind:string,target:string|null,fn:(signal:AbortSignal)=>Promise<unknown>){
    if(this.shuttingDown||this.activeJobs)throw new WriterError('WORKSPACE_BUSY','One foreground model/workflow job at a time.');
    const controller=new AbortController(),value:DesktopJob={id:newId('job'),kind,target,state:'running',startedAt:new Date().toISOString(),finishedAt:null,result:null,error:null};
    const promise=Promise.resolve().then(()=>fn(controller.signal)).then(result=>{value.result=result;value.state='completed';},e=>{value.error=desktopError(e);value.state=controller.signal.aborted?'cancelled':'failed';}).finally(()=>{value.finishedAt=new Date().toISOString();});
    this.jobs.set(value.id,{value,controller,promise});
    if(this.jobs.size>50){for(const [id,j] of this.jobs){if(j.value.state!=='running'){this.jobs.delete(id);break;}}}
    return {jobId:value.id};
  }
  private ticket(kind:Ticket['kind'],capture:Ticket['capture'],preset:ConnectionPreset|null){
    for(const [id,t] of this.tickets)if(t.expires<Date.now())this.tickets.delete(id);
    if(this.tickets.size>=20)throw new WriterError('WORKSPACE_BUSY','Too many unsent previews. Close a preview before requesting another.');
    const id=newId('preview'),preview={kind,input:capture,preset:preset?publicPreset(preset):null,notice:'Exact selected content. Sending may incur charges. No automatic manuscript approval or retry.'},fingerprint=workflowHash(preview);
    const t:Ticket={id,preview,fingerprint,expires:Date.now()+5*60_000,kind,capture:structuredClone(capture),preset:preset?structuredClone(preset):null,workspaceId:this.workspace?.info().id??null};this.tickets.set(id,t);
    return {id,fingerprint,preview};
  }
  private preset(id:unknown):ConnectionPreset{return this.connections.list().find(p=>p.id===text(id,'preset ID',200))??invalid('Choose an existing enabled connection.');}
  /** RPC contains only business actions. Import/export paths and workspace selection are not present. */
  async request(method:string,input:unknown={}) : Promise<unknown> {
    if(this.shuttingDown)throw new WriterError('WORKSPACE_CLOSED','Application is closing.');
    if(typeof method!=='string'||Buffer.byteLength(JSON.stringify(input))>6_000_000)invalid('Invalid or oversized desktop request.');
    if(method==='overview'){
      object(input,[]);const w=this.workspace;
      return {version:'0.0.9',workspace:w?.info()??null,documents:w?.listDocuments()??[],jobs:this.listJobs(),
        presets:this.connections.list().map(publicPreset),sources:w&&w.info().schemaVersion>=2?w.sources.list():[],
        profiles:w&&w.info().schemaVersion>=4?w.memory.profiles():[],
        runs:w&&w.info().schemaVersion>=5?w.workflows.list().map(r=>({id:r.id,title:r.config.title,state:r.state,stage:r.stage,notice:r.notice})):[]};
    }
    if(method==='diagnostics'){object(input,[]);return localDiagnostics(this.workspace,this.connections);}
    if(method==='document'){
      const a=object(input,['id']),w=this.w(),id=text(a.id,'document ID',200),revision=w.currentRevision(id),schema=w.info().schemaVersion;
      return {document:w.getDocument(id),revision,changes:w.listChanges(id).map(c=>({...c,rangeSet:schema>=7?w.ranges.forChange(c.id):null})),
        ranges:schema>=7?w.ranges.list(id).map(o=>({operation:o,...(['pending','accepted'].includes(o.status)?{preview:w.ranges.preview(o.id)}:{preview:null})})):[],
        citations:schema>=6?w.extensions.citations(id):[],buffer:schema>=7?w.ranges.buffer(id):null,reports:schema>=3?w.analysis.runs(id).map(r=>w.analysis.report(r.id)):[],
        history:w.history(id).map(r=>({id:r.id,kind:r.kind,createdAt:r.createdAt,action:schema>=7?w.ranges.journal(r.id)?.kind??r.kind:r.kind})),
        profile:schema>=4?w.memory.attachedProfile(id):null,intent:schema>=4?w.memory.activeIntent(id):null};
    }
    if(method==='documentCreate'){const a=object(input,['title','text']);return this.importDocument(text(a.title,'title',512),typeof a.text==='string'?a.text:invalid('Expected text.'));}
    if(method==='bufferSave'){
      const a=object(input,['documentId','baseRevisionId','expectedVersion','blocks']);
      if(!Array.isArray(a.blocks))invalid('Expected stable text blocks.');
      const blocks=a.blocks.map(v=>{const b=object(v,['blockId','text']);if(typeof b.text!=='string')invalid('Expected block text.');return {blockId:text(b.blockId,'block ID',200),text:b.text};});
      return this.w().ranges.saveBuffer(text(a.documentId),text(a.baseRevisionId),count(a.expectedVersion),blocks);
    }
    if(method==='bufferCommit'){const a=object(input,['documentId','head','bufferVersion']);return this.w().ranges.commitBuffer(text(a.documentId),text(a.head),count(a.bufferVersion));}
    if(method==='bufferDiscard'){const a=object(input,['documentId','bufferVersion']);this.w().ranges.discardBuffer(text(a.documentId),count(a.bufferVersion));return {discarded:true};}
    if(method==='rangeSplit'){const a=object(input,['changeId','head']);return this.w().ranges.splitChange(text(a.changeId),text(a.head));}
    if(method==='rangeDecide'){
      const a=object(input,['documentId','ids','action','head','reason']);if(!['accept','reject','revert'].includes(String(a.action)))invalid('Unknown range decision.');if(typeof a.reason!=='string')invalid('Expected optional reason.');
      return this.w().ranges.decide(text(a.documentId),strings(a.ids),a.action as 'accept'|'reject'|'revert',text(a.head),a.reason);
    }
    if(method==='legacyDecide'){const a=object(input,['changeId','action','head','reason']),w=this.w(),c=w.getChange(text(a.changeId));if(w.currentRevision(c.documentId).id!==a.head)throw new WriterError('STALE_REVISION','Refresh the document before deciding.');if(typeof a.reason!=='string'||!['reject','revert'].includes(String(a.action)))invalid('Use ranges for new acceptance.');return a.action==='reject'?w.reject(c.id,a.reason):w.revert(c.id,a.reason);}
    if(method==='profileCreate'){const a=object(input,['name']);return this.w().memory.createProfile(text(a.name,'profile name',120));}
    if(method==='profileAttach'){const a=object(input,['documentId','profileId']);this.w().memory.attach(text(a.documentId),a.profileId===null?null:text(a.profileId));return {saved:true};}
    if(method==='profile'){const a=object(input,['id']);return {profile:this.w().memory.profile(text(a.id)),preferences:this.w().memory.preferences(text(a.id))};}
    if(method==='preferenceSave'){const a=object(input,['profileId','rule']);return this.w().memory.addPreference(text(a.profileId),{rule:{key:'guidance',value:text(a.rule,'rule',4000),strength:'preferred'},language:'any',tasks:['revise','review'],priority:50,example:null});}
    if(method==='preferenceDecide'){const a=object(input,['id','action']);if(!['activate','disable','dismiss'].includes(String(a.action)))invalid('Unknown preference action.');return this.w().memory.decidePreferences([text(a.id)],a.action as 'activate'|'disable'|'dismiss');}
    if(method==='intentSave'){const a=object(input,['documentId','card']);validateIntentCard(a.card);return this.w().memory.saveIntent(text(a.documentId),a.card);}
    if(method==='suggestPreview'||method==='reviewPreview'){
      const a=object(input,['documentId','instruction','selection','presetId'],['rangeIds','changeIds','documentScope']);
      const id=text(a.documentId),instruction=text(a.instruction,'instruction',10000),p=this.preset(a.presetId);if(p.settings.kind!=='model')invalid('Choose a model connection.');
      if(method==='suggestPreview')return this.ticket('suggest',prepareSuggestion(this.w(),id,instruction,selection(a.selection)),p);
      const request=this.w().analysis.prepare(id,'semantic-review',{instruction,selection:selection(a.selection),documentScope:a.documentScope===true,
        ...(a.rangeIds!==undefined?{rangeOperationIds:strings(a.rangeIds)}:{changeIds:strings(a.changeIds??[])})});return this.ticket('review',request,p);
    }
    if(method==='previewDiscard'){const a=object(input,['id']);this.tickets.delete(text(a.id));return {discarded:true};}
    if(method==='previewSend'){
      const a=object(input,['id','fingerprint']),id=text(a.id),t=this.tickets.get(id);
      if(!t||t.fingerprint!==a.fingerprint||t.expires<Date.now()||t.workspaceId!==(this.workspace?.info().id??null))throw new WriterError('STALE_REVISION','Preview expired or workspace changed.');
      if(this.activeJobs)throw new WriterError('WORKSPACE_BUSY','Wait for the current model task.');this.tickets.delete(id);
      if(t.kind==='probe')return this.start('probe',null,signal=>runProbe(t.capture as ProbePlan,t.fingerprint===a.fingerprint?(t.capture as ProbePlan).fingerprint:'',this.connections,signal));
      if(!t.preset)invalid('Preview has no model identity.');const provider=modelFromPreset(this.connections,t.preset.id,t.preset.version),w=this.w();
      return this.start(t.kind,(t.kind==='suggest'?(t.capture as SuggestionCapture).request:(t.capture as AnalysisRequest)).documentId,signal=>t.kind==='suggest'?submitSuggestion(w,t.capture as SuggestionCapture,provider,signal):runAnalysis(w,t.capture as AnalysisRequest,provider,signal));
    }
    if(method==='jobCancel'){const a=object(input,['id']),j=this.jobs.get(text(a.id));if(j)j.controller.abort();return {cancellationRequested:!!j};}
    if(method==='presetSave'){
      const a=object(input,['name','settings','mode','input']);if(!['none','env','system','session'].includes(String(a.mode)))invalid('Choose a credential mode.');if(a.input!==null&&typeof a.input!=='string')invalid('Invalid credential input.');
      const p=await this.connections.save(text(a.name,'connection name',200),a.settings as PresetSettings,a.mode as 'none'|'env'|'system'|'session',a.input===null?undefined:a.input);return publicPreset(p);
    }
    if(method==='presetRemove'){const a=object(input,['id','version']);return this.connections.remove({id:text(a.id),version:text(a.version)});}
    if(method==='probePreview'){const a=object(input,['kind','presetId']);if(!['model','search','mcp-discovery','keyring'].includes(String(a.kind)))invalid('Unknown probe.');const p=a.presetId===null?undefined:this.preset(a.presetId);return this.ticket('probe',await prepareProbe(a.kind as ProbePlan['kind'],this.connections,p),p??null);}
    if(method==='source'){const a=object(input,['snapshotId']);return this.w().sources.snapshot(text(a.snapshotId));}
    if(method==='runCreate'){
      const a=object(input,['title','goal','publicBrief','language','research','template','documentId','changeIds','selection','profileId','modelPresetId','searchPresetId','autoRevision','navigationSummary','chapterDrafting','budget']);
      const p=this.preset(a.modelPresetId);if(p.settings.kind!=='model')invalid('Choose a model connection.');
      if(a.template!=='new-article'&&(a.navigationSummary===true||a.chapterDrafting===true))invalid('Navigation summaries and chapter drafting are for new articles.');
      const searchPreset=a.searchPresetId===null?null:this.preset(a.searchPresetId);if(searchPreset&&searchPreset.settings.kind!=='search')invalid('Choose a search connection.');
      const config:WorkflowConfig={title:text(a.title,'title',512),goal:text(a.goal,'goal',10000),publicBrief:typeof a.publicBrief==='string'?a.publicBrief:invalid('Expected a public brief.'),language:a.language as WorkflowConfig['language'],research:a.research as WorkflowConfig['research'],template:a.template as WorkflowConfig['template'],documentId:a.documentId===null?null:text(a.documentId),changeIds:strings(a.changeIds),selection:selection(a.selection),profileId:a.profileId===null?null:text(a.profileId),intent:null,memoryOptions:{},model:structuredClone(p.settings.model),searchKeyEnv:'TAVILY_API_KEY',domains:[],timeRange:null,autoRevision:flag(a.autoRevision),...(a.template==='new-article'?{navigationSummary:flag(a.navigationSummary)}:{}),budget:a.budget as WorkflowBudget,extensions:{skills:[],calls:[],chapterDrafting:flag(a.chapterDrafting)}};
      validateWorkflowConfig(config);let run=this.w().workflows.create(config);run=attachPreset(this.w(),run.id,p,this.connections);
      if(searchPreset)run=attachPreset(this.w(),run.id,searchPreset,this.connections);return run;
    }
    if(method==='run'){
      const a=object(input,['id']),w=this.w(),id=text(a.id),run=w.workflows.run(id),artifacts=w.workflows.artifacts(id);
      return {run,recovery:recoveryView(w,id),attempts:w.workflows.attempts(id),events:w.workflows.events(id),
        artifacts:artifacts.map(a=>{if(['draft','draft-revision'].includes(a.type)){const v=a.value as {request:WorkflowContentRequest;output:DraftOutput};return {...a,markdown:run.capture.extensions?renderCitedDraft(v.output,v.request.sources).markdown:renderWorkflowDraft(v.output,v.request.sources)};}return a;})};
    }
    if(method==='runPreview'){const a=object(input,['id']);return this.w().workflows.preview(text(a.id));}
    if(method==='runAuthorize'){const a=object(input,['id','fingerprint','limits']);return this.w().workflows.authorize(text(a.id),text(a.fingerprint),a.limits as WorkflowBudget);}
    if(method==='runStart'){const a=object(input,['id']),id=text(a.id),w=this.w();w.workflows.run(id);return this.start('workflow',id,signal=>executeWorkflow(w,id,presetDependencies(w,w.workflows.run(id),this.connections),signal));}
    if(method==='runPause'){const a=object(input,['id']),id=text(a.id);this.w().workflows.pause(id);for(const j of this.jobs.values())if(j.value.target===id)j.controller.abort();return {paused:true};}
    if(method==='runRecover'){const a=object(input,['id']);this.w().workflows.recover(text(a.id));return {recovered:true};}
    if(method==='runRetry'){const a=object(input,['id','attemptId','acknowledgeDuplicate']);this.w().workflows.retry(text(a.id),text(a.attemptId),flag(a.acknowledgeDuplicate));return {retryApproved:true};}
    if(method==='runRefresh'){const a=object(input,['id']);return this.w().workflows.refresh(text(a.id));}
    if(method==='runOutline'){const a=object(input,['id','artifactId']);return this.w().workflows.chooseOutline(text(a.id),text(a.artifactId));}
    if(method==='runReply'){const a=object(input,['id','reply']),w=this.w(),id=text(a.id),run=w.workflows.run(id);return w.workflows.refresh(id,{...run.config,goal:run.config.goal+'\nAuthor follow-up: '+text(a.reply)});}
    if(method==='runAdopt'){const a=object(input,['id','artifactId']);return {documentId:this.w().workflows.adopt(text(a.id),text(a.artifactId))};}
    if(method==='runFinish'){const a=object(input,['id']);this.w().workflows.finish(text(a.id));return {finished:true};}
    invalid('Unknown desktop action.');
  }
  async close(){this.shuttingDown=true;for(const j of this.jobs.values())j.controller.abort();await Promise.all([...this.jobs.values()].map(j=>j.promise));this.tickets.clear();this.workspace?.close();this.workspace=null;}
}
