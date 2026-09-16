// SPDX-License-Identifier: Apache-2.0
import type { DatabaseSync } from 'node:sqlite';
import { newId, hashBytes, WriterError, validateIntentCard, validatePreferenceInput, validatePreferenceRecord, validateMemoryCapture,
  validateWritingLanguage, memoryText, memoryIds, buildMemoryPlan,
  optionsFromCapture, captureMemoryTask, validateMemoryTaskOutput, validateProfileExport, validateWritingExample, REJECTION_CATEGORIES } from '@writer-agent/core';
import type { IntentCard, IntentVersion, WritingProfile, PreferenceInput, PreferenceVersion, PreferenceStatus, MemoryOptions, MemoryCapture, MemoryPlan, MemoryUse,
  WritingTask, FeedbackEvidence, RejectionCategory, MemoryTaskRequest, MemoryTaskOutput, WritingLanguage, AnalysisProviderInfo, AnalysisUsage, Revision,
  Decision, Change, ProfileExport, WritingExample } from '@writer-agent/core';
import type { AnalysisLedger } from './analysis.js';
import { safeProvider, safeUsage } from './analysis.js';
interface Host {
  currentRevision(id:string):Revision;
  getRevision(id:string):Revision;
  getChange(id:string):Change;
  decisions(id:string):Decision[];
  readonly analysis:AnalysisLedger;
}
export interface MemoryTaskRun {
  readonly id:string; readonly request:MemoryTaskRequest; readonly output:MemoryTaskOutput;
  readonly provider:AnalysisProviderInfo; readonly usage:AnalysisUsage|null; readonly createdAt:string;
  readonly authority:'model-draft-not-active'; readonly promptVersion:'memory-v1';
}
const now=()=>new Date().toISOString();
const tables=['writing_profiles','profile_bindings','intent_versions','intent_confirmations','preference_versions','guidance_uses','memory_task_runs'];
function unpack<T>(r:Record<string,unknown>|undefined):T{
  if(!r)throw new WriterError('NOT_FOUND','Writing memory record not found.');
  if(typeof r.payload!=='string'||typeof r.payload_hash!=='string'||hashBytes(r.payload)!==r.payload_hash)throw new WriterError('CORRUPT_DATA','Writing memory failed its integrity check.');
  try{return JSON.parse(r.payload) as T;}catch{throw new WriterError('CORRUPT_DATA','Invalid saved memory JSON.');}
}
/** No provider has a handle to this author-controlled store. */
export class WritingMemory {
  constructor(private readonly db:DatabaseSync,private readonly ready:()=>void,private readonly transaction:<T>(fn:()=>T)=>T,private readonly host:Host){}
  private insert(table:string,id:string,data:unknown,columns:Record<string,string|null>={}):void{
    if(!tables.includes(table))throw Error('Unknown memory table');const json=JSON.stringify(data),keys=['id',...Object.keys(columns),'payload','payload_hash'];
    this.db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(id,...Object.values(columns),json,hashBytes(json));
  }
  private record<T>(table:string,id:string):T{
    this.ready();memoryText(id,240);if(!tables.includes(table))throw Error('Unknown memory table');
    return unpack<T>(this.db.prepare(`SELECT payload,payload_hash FROM ${table} WHERE id=?`).get(id));
  }
  profiles():WritingProfile[]{this.ready();return this.db.prepare('SELECT payload,payload_hash FROM writing_profiles ORDER BY seq LIMIT 201').all().map(r=>unpack<WritingProfile>(r));}
  profile(id:string):WritingProfile{const p=this.record<WritingProfile>('writing_profiles',id);if(p.id!==id)throw new WriterError('CORRUPT_DATA','Profile identity mismatch.');memoryText(p.name,120);return p;}
  createProfile(name:string):WritingProfile{this.ready();memoryText(name,120);return this.transaction(()=>{if(this.profiles().length>=200)throw new WriterError('INVALID_INPUT','This workspace supports at most 200 profiles.');const p={id:newId('profile'),name,createdAt:now()};this.insert('writing_profiles',p.id,p);return p;});}
  private binding(documentId:string):{id:string;profileId:string|null}|null {
    this.ready();const r=this.db.prepare('SELECT payload,payload_hash FROM profile_bindings WHERE document_id=? ORDER BY seq DESC LIMIT 1').get(documentId);return r?unpack(r):null;
  }
  attachedProfile(documentId:string):WritingProfile|null{this.host.currentRevision(documentId);const b=this.binding(documentId);return b?.profileId?this.profile(b.profileId):null;}
  attach(documentId:string,profileId:string|null):void{
    this.ready();this.host.currentRevision(documentId);if(profileId!==null)this.profile(profileId);
    this.transaction(()=>{const b={id:newId('binding'),documentId,profileId,createdAt:now()};this.insert('profile_bindings',b.id,b,{document_id:documentId,profile_id:profileId});});
  }
  private confirmation(documentId:string):{id:string;intentId:string}|null{
    const r=this.db.prepare('SELECT payload,payload_hash FROM intent_confirmations WHERE document_id=? ORDER BY seq DESC LIMIT 1').get(documentId);return r?unpack(r):null;
  }
  intent(id:string):IntentVersion{const v=this.record<IntentVersion>('intent_versions',id);validateIntentCard(v.card);if(v.id!==id||this.host.getRevision(v.baseRevisionId).documentId!==v.documentId)throw new WriterError('CORRUPT_DATA','Intent identity mismatch.');return v;}
  activeIntent(documentId:string):IntentVersion|null{this.ready();this.host.currentRevision(documentId);const c=this.confirmation(documentId);return c?this.intent(c.intentId):null;}
  intents(documentId:string){this.ready();this.host.currentRevision(documentId);const active=this.confirmation(documentId)?.intentId;
    return this.db.prepare('SELECT id FROM intent_versions WHERE document_id=? ORDER BY seq DESC LIMIT 200').all(documentId).map(r=>{const v=this.intent(String(r.id));const confirmed=!!this.db.prepare('SELECT 1 FROM intent_confirmations WHERE intent_id=?').get(v.id);return {...v,status:active===v.id?'active':confirmed?'superseded':'draft'};});
  }
  private important(documentId:string,card:IntentCard){
    if(!card.importantOccurrenceIds.length)return [];
    const list=this.host.analysis.list(documentId);
    return card.importantOccurrenceIds.map(id=>{const c=list.find(c=>c.id===id);if(!c||c.annotation!=='confirmed'||c.state!=='current')throw new WriterError('STALE_REVISION','An intent references an unconfirmed, missing or stale claim. Re-annotate it or explicitly change the intent.');return {occurrenceId:c.id,claimId:c.claimId,statement:c.statement};});
  }
  private insertIntent(documentId:string,card:IntentCard,origin:IntentVersion['origin'],runId:string|null):IntentVersion{
    validateIntentCard(card);this.important(documentId,card);
    const v:IntentVersion={id:newId('intent'),documentId,baseRevisionId:this.host.currentRevision(documentId).id,parentId:this.activeIntent(documentId)?.id??null,card:structuredClone(card),origin,runId,createdAt:now()};
    this.insert('intent_versions',v.id,v,{document_id:documentId,revision_id:v.baseRevisionId,run_id:runId});return v;
  }
  private confirmInside(id:string):IntentVersion{
    const v=this.intent(id),active=this.activeIntent(v.documentId);
    if(active?.id===v.id)throw new WriterError('INVALID_TRANSITION','Intent is already active.');
    if((active?.id??null)!==v.parentId||this.host.currentRevision(v.documentId).id!==v.baseRevisionId)throw new WriterError('STALE_REVISION','This draft is based on an older document/intent. Make a new draft before confirming.');
    this.important(v.documentId,v.card);const c={id:newId('intentdecision'),intentId:v.id,documentId:v.documentId,createdAt:now()};this.insert('intent_confirmations',c.id,c,{document_id:v.documentId,intent_id:v.id});return v;
  }
  saveIntent(documentId:string,card:IntentCard):IntentVersion{this.ready();return this.transaction(()=>this.confirmInside(this.insertIntent(documentId,card,'manual',null).id));}
  confirmIntent(id:string):IntentVersion{this.ready();return this.transaction(()=>this.confirmInside(id));}
  preferences(profileId:string):PreferenceVersion[]{this.ready();this.profile(profileId);
    const rows=this.db.prepare(`SELECT p.payload,p.payload_hash FROM preference_versions p WHERE p.profile_id=? AND NOT EXISTS(SELECT 1 FROM preference_versions n WHERE n.preference_id=p.preference_id AND n.seq>p.seq) ORDER BY p.seq LIMIT 1001`).all(profileId);
    if(rows.length>1000)throw new WriterError('INVALID_INPUT','Too many preferences; narrow this profile.');
    return rows.map(r=>{const p=unpack<PreferenceVersion>(r);validatePreferenceRecord(p);return p;});
  }
  preference(id:string):PreferenceVersion{const p=this.record<PreferenceVersion>('preference_versions',id);validatePreferenceRecord(p);if(p.id!==id)throw new WriterError('CORRUPT_DATA','Preference version mismatch.');return p;}
  private assertLatest(p:PreferenceVersion):void{if(this.preferences(p.profileId).find(x=>x.preferenceId===p.preferenceId)?.id!==p.id)throw new WriterError('STALE_REVISION','Preference changed since it was displayed. Refresh the candidate list.');}
  private insertPreference(profileId:string,input:PreferenceInput,status:PreferenceStatus,origin:PreferenceVersion['origin'],previous:PreferenceVersion|null,evidenceIds:readonly string[],runId:string|null,reason:string):PreferenceVersion{
    this.profile(profileId);validatePreferenceInput(input);memoryText(reason,2000,true);memoryIds(evidenceIds,20);
    if(!previous&&this.preferences(profileId).length>=1000)throw new WriterError('INVALID_INPUT','This profile has reached the preference limit.');
    const p:PreferenceVersion={...structuredClone(input),id:newId('prefv'),preferenceId:previous?.preferenceId??newId('pref'),profileId,previousId:previous?.id??null,status,origin,evidenceIds:[...evidenceIds],runId,reason,createdAt:now()};
    this.insert('preference_versions',p.id,p,{preference_id:p.preferenceId,profile_id:profileId,previous_id:p.previousId,run_id:runId});return p;
  }
  addPreference(profileId:string,input:PreferenceInput):PreferenceVersion{this.ready();return this.transaction(()=>this.insertPreference(profileId,input,'active','manual',null,[],null,''));}
  decidePreferences(versionIds:readonly string[],action:'activate'|'disable'|'dismiss'):PreferenceVersion[]{
    this.ready();memoryIds(versionIds,100);if(!versionIds.length||!['activate','disable','dismiss'].includes(action))throw new WriterError('INVALID_INPUT','Select specific preference versions and an action.');
    return this.transaction(()=>{const selected=versionIds.map(id=>this.preference(id));const profileId=selected[0]!.profileId;
      for(const p of selected){this.assertLatest(p);if(p.profileId!==profileId)throw new WriterError('INVALID_INPUT','One batch must belong to one profile.');
        const valid=action==='activate'?['candidate','disabled'].includes(p.status):action==='disable'?p.status==='active':p.status==='candidate';if(!valid)throw new WriterError('INVALID_TRANSITION','This preference cannot make the requested transition.');}
      return selected.map(p=>this.insertPreference(p.profileId,{rule:p.rule,language:p.language,tasks:p.tasks,priority:p.priority,example:p.example},action==='activate'?'active':action==='disable'?'disabled':'dismissed',p.origin,p,p.evidenceIds,p.runId,`Author chose ${action}`));});
  }
  correctPreference(id:string,input:PreferenceInput):PreferenceVersion{this.ready();return this.transaction(()=>{const p=this.preference(id);this.assertLatest(p);return this.insertPreference(p.profileId,input,'active','human-correction',p,p.evidenceIds,p.runId,'Author edited and confirmed this rule.');});}
  plan(documentId:string,task:WritingTask,options:MemoryOptions={}):MemoryPlan{
    this.ready();this.host.currentRevision(documentId);const binding=this.binding(documentId),profile=binding?.profileId?this.profile(binding.profileId):null,intent=this.activeIntent(documentId);
    return buildMemoryPlan({documentId,task,options,intent,profile,preferences:profile?this.preferences(profile.id):[],bindingId:binding?.id??null,
      activeIntentEvent:this.confirmation(documentId)?.id??null,importantClaims:intent?this.important(documentId,intent.card):[]});
  }
  assertFresh(capture:MemoryCapture):void{
    this.ready();validateMemoryCapture(capture);const current=this.plan(capture.documentId,capture.task,optionsFromCapture(capture.options));
    if(current.conflicts.length)throw new WriterError('GUIDANCE_CONFLICT','Writing requirements conflict. Resolve them explicitly before sending.');
    if(JSON.stringify(current.capture)!==JSON.stringify(capture))throw new WriterError('STALE_REVISION','Intent, selected profile or applicable preferences changed. Start a new request.');
  }
  /** Called ONLY inside the workspace proposal transaction. */
  saveUse(capture:MemoryCapture,revisionId:string,instruction:string,providerId:string,changeIds:readonly string[]):MemoryUse{
    this.assertFresh(capture);memoryText(instruction,10000);memoryText(providerId,200);memoryIds(changeIds,100);
    if(this.host.currentRevision(capture.documentId).id!==revisionId)throw new WriterError('STALE_REVISION','Document changed before saving guidance usage.');
    for(const id of changeIds)if(this.host.getChange(id).documentId!==capture.documentId)throw new WriterError('INVALID_INPUT','Change belongs to another document.');
    const u:MemoryUse={id:newId('use'),documentId:capture.documentId,baseRevisionId:revisionId,task:capture.task,capture:structuredClone(capture),changeIds:[...changeIds],instruction,providerId,createdAt:now()};
    this.insert('guidance_uses',u.id,u,{document_id:u.documentId,revision_id:revisionId});for(const id of changeIds)this.db.prepare('INSERT INTO change_guidance(change_id,use_id) VALUES(?,?)').run(id,u.id);return u;
  }
  uses(documentId:string){this.ready();this.host.currentRevision(documentId);return this.db.prepare('SELECT payload,payload_hash FROM guidance_uses WHERE document_id=? ORDER BY seq DESC LIMIT 100').all(documentId).map(r=>unpack<MemoryUse>(r));}
  use(id:string){const u=this.record<MemoryUse>('guidance_uses',id);validateMemoryCapture(u.capture);let freshness='current';try{this.assertFresh(u.capture);if(this.host.currentRevision(u.documentId).id!==u.baseRevisionId)freshness='stale';}catch{freshness='stale';}return {...u,freshness};}
  forChange(id:string){this.ready();this.host.getChange(id);const r=this.db.prepare('SELECT use_id FROM change_guidance WHERE change_id=?').get(id);return r?this.use(String(r.use_id)):null;}
  feedbackChoices(documentId:string){this.ready();return this.host.decisions(documentId).filter(d=>d.action==='rejected'||d.action==='reverted').map(d=>({...d,category:this.db.prepare('SELECT category FROM decision_reasons WHERE decision_id=?').get(d.id)?.category??null}));}
  evidence(documentId:string,ids:readonly string[],exampleIds:readonly string[]=[]):FeedbackEvidence[]{
    this.ready();memoryIds(ids,20);memoryIds(exampleIds,3);if(exampleIds.some(id=>!ids.includes(id)))throw new WriterError('INVALID_INPUT','Example permission must refer to selected feedback.');
    const choices=this.feedbackChoices(documentId);return ids.map(id=>{const d=choices.find(x=>x.id===id);if(!d)throw new WriterError('NOT_FOUND','Selected rejection/revert was not found in this document.');
      if(!d.reason.trim()&&d.category===null)throw new WriterError('INVALID_INPUT','A reasonless rejection is not evidence of a style preference.');
      let example:WritingExample|null=null;if(exampleIds.includes(id)){const c=this.host.getChange(d.changeId);example={before:c.before,after:c.after,reason:d.reason||String(d.category)};validateWritingExample(example);}
      return {decisionId:d.id,documentId,changeId:d.changeId,action:d.action as 'rejected'|'reverted',category:d.category as RejectionCategory|null,reason:d.reason,example};});
  }
  prepareTask(documentId:string,task:MemoryTaskRequest['task'],options:{brief:string;language:WritingLanguage;tasks?:readonly WritingTask[];profileId?:string;decisionIds?:readonly string[];exampleDecisionIds?:readonly string[]}):MemoryTaskRequest{
    this.ready();const revision=this.host.currentRevision(documentId);validateWritingLanguage(options.language);
    if(task==='preference-draft'){if(!options.profileId)throw new WriterError('INVALID_INPUT','Choose a destination profile.');this.profile(options.profileId);}
    return captureMemoryTask({protocolVersion:1,requestId:newId('memoryreq'),task,documentId,baseRevisionId:revision.id,baseIntentId:this.activeIntent(documentId)?.id??null,
      profileId:task==='intent-draft'?null:options.profileId!,language:options.language,tasks:options.tasks??['revise','review'],brief:options.brief,
      evidence:task==='intent-draft'?[]:this.evidence(documentId,options.decisionIds??[],options.exampleDecisionIds??[])});
  }
  assertTaskFresh(request:MemoryTaskRequest):void{
    this.ready();captureMemoryTask(request);
    if(this.host.currentRevision(request.documentId).id!==request.baseRevisionId||(this.activeIntent(request.documentId)?.id??null)!==request.baseIntentId)throw new WriterError('STALE_REVISION','Document or active intent changed while this draft was prepared.');
    if(request.task==='preference-draft'){
      this.profile(request.profileId!);const evidence=this.evidence(request.documentId,request.evidence.map(e=>e.decisionId),request.evidence.filter(e=>e.example!==null).map(e=>e.decisionId));
      if(JSON.stringify(evidence)!==JSON.stringify(request.evidence))throw new WriterError('STALE_REVISION','Selected feedback no longer matches this request.');
    }
  }
  saveTask(input:MemoryTaskRequest,value:unknown,provider:AnalysisProviderInfo,usage:AnalysisUsage|null){
    this.ready();const request=captureMemoryTask(input),output=validateMemoryTaskOutput(value,request),info=safeProvider(provider),tokens=safeUsage(usage);
    return this.transaction(()=>{this.assertTaskFresh(request);const run:MemoryTaskRun={id:newId('memoryrun'),request,output,provider:info,usage:tokens,createdAt:now(),authority:'model-draft-not-active',promptVersion:'memory-v1'};
      this.insert('memory_task_runs',run.id,run,{document_id:request.documentId,revision_id:request.baseRevisionId});
      if(output.task==='intent-draft'){
        const intent=this.insertIntent(request.documentId,{...output.card,language:request.language,importantOccurrenceIds:[]},'model-draft',run.id);return {run,intent,preferences:[] as PreferenceVersion[]};
      }
      const prefs=output.candidates.map(c=>this.insertPreference(request.profileId!,{rule:c.rule,language:request.language,tasks:request.tasks,priority:0,example:null},'candidate','model-candidate',null,c.evidenceIds,run.id,c.explanation));
      return {run,intent:null,preferences:prefs};});
  }
  taskRun(id:string):MemoryTaskRun{const r=this.record<MemoryTaskRun>('memory_task_runs',id);captureMemoryTask(r.request);validateMemoryTaskOutput(r.output,r.request);safeProvider(r.provider);safeUsage(r.usage);return r;}
  exportProfile(profileId:string,examplePreferenceIds:readonly string[]=[]):ProfileExport{
    this.ready();memoryIds(examplePreferenceIds,200);const profile=this.profile(profileId),active=this.preferences(profileId).filter(p=>p.status==='active');
    if(examplePreferenceIds.some(id=>!active.some(p=>p.preferenceId===id&&p.example)))throw new WriterError('INVALID_INPUT','Export example must refer to an active rule with an example.');
    const value:ProfileExport={format:1,name:profile.name,preferences:active.map(p=>({rule:p.rule,language:p.language,tasks:p.tasks,priority:p.priority,example:examplePreferenceIds.includes(p.preferenceId)?p.example:null}))};validateProfileExport(value);return value;
  }
  importProfile(value:unknown){
    this.ready();validateProfileExport(value);
    return this.transaction(()=>{if(this.profiles().length>=200)throw new WriterError('INVALID_INPUT','Too many profiles.');const p={id:newId('profile'),name:value.name,createdAt:now()};this.insert('writing_profiles',p.id,p);
      const candidates=value.preferences.map(input=>this.insertPreference(p.id,input,'candidate','imported',null,[],null,'Imported; requires explicit author confirmation.'));return {profile:p,candidates};});
  }
  /** Add-on to immutable text decisions, never changes their original reason. Called within reject transaction. */
  recordRejectionCategory(decisionId:string,category:RejectionCategory):void{this.ready();if(!REJECTION_CATEGORIES.includes(category))throw new WriterError('INVALID_INPUT','Unknown rejection reason category.');this.db.prepare('INSERT INTO decision_reasons(decision_id,category) VALUES(?,?)').run(decisionId,category);}
}
