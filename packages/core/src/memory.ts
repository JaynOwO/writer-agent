// SPDX-License-Identifier: Apache-2.0
import { isRecord, WriterError } from './errors.js';
import { validateText } from './document.js';
import { hashBytes } from './sources.js';
import { MEMORY_LANGUAGES, WRITING_TASKS, RULE_KEYS, REJECTION_CATEGORIES } from './memory-types.js';
import type { WritingLanguage, WritingTask, WritingRule, IntentCard, PreferenceInput, PreferenceVersion,
  MemoryOptions, NormalizedMemoryOptions, MemoryPacket, MemoryCapture, MemoryPlan, GuidanceEntry,
  MemoryTaskRequest, MemoryTaskOutput, WritingExample, IntentVersion, WritingProfile } from './memory-types.js';
export const MEMORY_MAX_BYTES = 24000;
export const MEMORY_MAX_RULES = 20;
export const MEMORY_MAX_EXAMPLES = 3;
export const MEMORY_TASK_MAX_BYTES = 160000;
export function memoryError(message: string): never { throw new WriterError('INVALID_INPUT', message); }
export function memoryObject(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) memoryError('Unexpected memory fields.');
}
export function memoryText(value: unknown, max = 2000, empty = false): asserts value is string {
  validateText(value, 'writing guidance');
  if (value.length > max || (!empty && !value.trim())) memoryError('Writing guidance is empty or exceeds its text limit.');
}
export function memoryArray(value: unknown, max = 20): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > max) memoryError('Writing guidance list exceeds its limit.');
}
export function memoryIds(value: unknown, max = 20): asserts value is string[] {
  memoryArray(value, max); const ids = new Set<string>();
  for (const id of value) { memoryText(id, 200); if (ids.has(id)) memoryError('Duplicate memory ID.'); ids.add(id); }
}
export function validateWritingLanguage(value: unknown): asserts value is WritingLanguage {
  if (!MEMORY_LANGUAGES.includes(value as WritingLanguage)) memoryError('Choose zh-CN, en or explicitly cross-language any.');
}
export function validateWritingTask(value: unknown): asserts value is WritingTask {
  if (!WRITING_TASKS.includes(value as WritingTask)) memoryError('Unknown writing task.');
}
export function validateWritingRule(value: unknown): asserts value is WritingRule {
  memoryObject(value, ['key', 'value', 'strength']); memoryText(value.value, 1500);
  if (!RULE_KEYS.includes(value.key as WritingRule['key']) || !['preferred', 'required'].includes(value.strength as string)) memoryError('Unknown writing-rule type.');
  if (value.key === 'max-characters' && (!/^[1-9][0-9]{0,6}$/.test(value.value) || Number(value.value) > 2000000)) memoryError('Character limit must be a positive decimal integer <= 2000000.');
  if (value.key === 'avoid-phrase' && value.value.length > 200) memoryError('A fixed avoided phrase must not exceed 200 UTF-16 code units.');
}
export function validateIntentCard(value: unknown): asserts value is IntentCard {
  memoryObject(value, ['language', 'audience', 'purpose', 'thesis', 'rules', 'importantOccurrenceIds']);
  validateWritingLanguage(value.language);
  for (const k of ['audience', 'purpose', 'thesis']) memoryText(value[k], 2000, true);
  memoryArray(value.rules); value.rules.forEach(validateWritingRule); memoryIds(value.importantOccurrenceIds, 20);
}
export function validateWritingExample(value: unknown): asserts value is WritingExample {
  memoryObject(value, ['before', 'after', 'reason']);
  memoryText(value.before, 2000, true); memoryText(value.after, 2000, true); memoryText(value.reason, 2000);
  if (value.before === value.after) memoryError('A contrast example needs different texts.');
}
export function validatePreferenceInput(value: unknown): asserts value is PreferenceInput {
  memoryObject(value, ['rule', 'language', 'tasks', 'priority', 'example']);
  validateWritingRule(value.rule); validateWritingLanguage(value.language); memoryIds(value.tasks, 3);
  if (!value.tasks.length) memoryError('Select at least one writing task.'); value.tasks.forEach(validateWritingTask);
  if (!Number.isInteger(value.priority) || (value.priority as number) < 0 || (value.priority as number) > 5) memoryError('Priority must be 0–5.');
  if (value.example !== null) validateWritingExample(value.example);
}
export function normalizeMemoryOptions(value: MemoryOptions = {}): NormalizedMemoryOptions {
  if (!isRecord(value) || Object.keys(value).some(k => !['language', 'selectedPreferenceIds', 'examplePreferenceIds', 'exceptions', 'waiveRequiredRefs'].includes(k))) memoryError('Unknown memory selection option.');
  if (value.language !== undefined) validateWritingLanguage(value.language);
  const selectedPreferenceIds = value.selectedPreferenceIds ?? [], examplePreferenceIds = value.examplePreferenceIds ?? [], exceptions = value.exceptions ?? [], waiveRequiredRefs = value.waiveRequiredRefs ?? [];
  memoryIds(selectedPreferenceIds, MEMORY_MAX_RULES); memoryIds(examplePreferenceIds, MEMORY_MAX_EXAMPLES);
  memoryArray(exceptions, 20); exceptions.forEach(validateWritingRule); memoryIds(waiveRequiredRefs, 40);
  return structuredClone({ language: value.language ?? null, selectedPreferenceIds, examplePreferenceIds, exceptions: exceptions as WritingRule[], waiveRequiredRefs });
}
export function optionsFromCapture(options: NormalizedMemoryOptions): MemoryOptions {
  memoryObject(options, ['language', 'selectedPreferenceIds', 'examplePreferenceIds', 'exceptions', 'waiveRequiredRefs']);
  return { ...(options.language === null ? {} : {language: options.language}), selectedPreferenceIds: options.selectedPreferenceIds,
    examplePreferenceIds: options.examplePreferenceIds, exceptions: options.exceptions, waiveRequiredRefs: options.waiveRequiredRefs };
}
const singleton = new Set<string>(['tone', 'sentence-style', 'max-characters']);
const rank = (entry: GuidanceEntry) => ({profile: 0, document: 1, request: 2}[entry.layer]);
/** Scope/priority selection is deterministic. Free-text contradictions are NOT inferred. */
export function buildMemoryPlan(input: {
  documentId: string; task: WritingTask; options?: MemoryOptions; intent: IntentVersion | null; profile: WritingProfile | null;
  preferences: readonly PreferenceVersion[]; bindingId: string | null; activeIntentEvent: string | null;
  importantClaims: MemoryPacket['importantClaims'];
}): MemoryPlan {
  validateWritingTask(input.task); memoryText(input.documentId, 200);
  const options = normalizeMemoryOptions(input.options), intent = input.intent;
  if (intent) validateIntentCard(intent.card);
  const language = options.language ?? intent?.card.language ?? 'any';
  if (intent && intent.card.language !== 'any' && language !== intent.card.language) memoryError('This intent card has a different language. Edit/confirm the card instead of silently overriding it.');
  const matching = input.preferences.filter(p => p.status === 'active' && p.profileId === input.profile?.id && (p.language === 'any' || p.language === language) && p.tasks.includes(input.task));
  matching.forEach(validatePreferenceRecord);
  matching.sort((a,b) => (a.rule.strength === b.rule.strength ? 0 : a.rule.strength === 'required' ? -1 : 1) || b.priority - a.priority || (a.preferenceId < b.preferenceId ? -1 : a.preferenceId > b.preferenceId ? 1 : 0));
  for (const id of [...options.selectedPreferenceIds, ...options.examplePreferenceIds]) {
    if (!matching.some(p => p.preferenceId === id)) memoryError('An explicitly selected preference/example is inactive, outside this profile, language or task.');
  }
  const excluded: {ref:string;reason:string}[] = [], conflicts: {refs: string[];key:string;reason:string}[] = [];
  const all: GuidanceEntry[] = matching.filter(p => !options.selectedPreferenceIds.length || options.selectedPreferenceIds.includes(p.preferenceId) || p.rule.strength === 'required').map(p => ({ref: p.id, layer:'profile', rule:p.rule}));
  for (const p of matching) if (!all.some(e=>e.ref===p.id)) excluded.push({ref:p.id,reason:'not-selected'});
  intent?.card.rules.forEach((rule,i) => all.push({ref:`${intent.id}:rule:${i}`,layer:'document',rule}));
  options.exceptions.forEach((rule,i) => all.push({ref:`request:${i}`,layer:'request',rule}));
  for (const ref of options.waiveRequiredRefs) if (!all.some(e=>e.ref===ref && e.rule.strength==='required' && e.layer!=='request' && singleton.has(e.rule.key) && all.some(h=>h.rule.key===e.rule.key && rank(h)>rank(e) && h.rule.value!==e.rule.value))) memoryError('A required-rule exception must name an exact required entry with a conflicting higher-layer structured value.');
  const filtered: GuidanceEntry[] = [];
  for (const entry of all) {
    const peers = singleton.has(entry.rule.key) ? all.filter(e=>e.rule.key===entry.rule.key) : [entry];
    const maxRank = Math.max(...peers.map(rank)), higher = peers.filter(e=>rank(e)===maxRank);
    if (rank(entry) < maxRank) {
      if (entry.rule.strength==='required' && higher.some(e=>e.rule.value!==entry.rule.value) && !options.waiveRequiredRefs.includes(entry.ref)) {
        conflicts.push({refs:[entry.ref,...higher.map(e=>e.ref)],key:entry.rule.key,reason:'explicit-required-override-needed'});
      }
      excluded.push({ref:entry.ref,reason:'overridden-by-more-specific-guidance'}); continue;
    }
    if (new Set(higher.map(e=>e.rule.value)).size>1) conflicts.push({refs:higher.map(e=>e.ref),key:entry.rule.key,reason:'same-layer-conflict'});
    const inheritedRequired=peers.some(e=>rank(e)<rank(entry) && e.rule.strength==='required' && e.rule.value===entry.rule.value && !options.waiveRequiredRefs.includes(e.ref));
    filtered.push(inheritedRequired?{...entry,rule:{...entry.rule,strength:'required'}}:entry);
  }
  const packet: { -readonly [K in keyof MemoryPacket]: MemoryPacket[K] } = {
    version:1,task:input.task,language,intent: intent ? {versionId:intent.id,audience:intent.card.audience,purpose:intent.card.purpose,thesis:intent.card.thesis} : null,
    profile:input.profile ? {id:input.profile.id,name:input.profile.name} : null, entries:[],examples:[],importantClaims:input.importantClaims,
    exceptions:options.exceptions,waivedRequiredRefs:options.waiveRequiredRefs,authority:'author-guidance-not-facts-or-permissions',
  };
  const bytes = () => Buffer.byteLength(JSON.stringify(packet),'utf8');
  const included: {ref:string;reason:string}[] = [];
  // Required/document/request constraints first; optional profile rules consume the remainder.
  const explicit = (e:GuidanceEntry) => options.selectedPreferenceIds.some(id=>matching.some(p=>p.preferenceId===id&&p.id===e.ref)) || options.examplePreferenceIds.some(id=>matching.some(p=>p.preferenceId===id&&p.id===e.ref));
  const mandatory = filtered.filter(e=>e.layer!=='profile'||e.rule.strength==='required'||explicit(e));
  packet.entries=[...mandatory];
  for(const id of options.examplePreferenceIds){
    const p=matching.find(p=>p.preferenceId===id)!;
    if(!p.example || !packet.entries.some(e=>e.ref===p.id))memoryError('An explicitly authorized example requires an included preference with an example.');
    packet.examples=[...packet.examples,{preferenceVersionId:p.id,example:structuredClone(p.example)}];
  }
  const mandatoryProfileCount=mandatory.filter(e=>e.layer==='profile').length;
  if (mandatoryProfileCount>MEMORY_MAX_RULES || bytes()>MEMORY_MAX_BYTES) memoryError('Required or explicit guidance exceeds the memory budget. Reduce it explicitly; nothing was truncated.');
  for(const e of mandatory)included.push({ref:e.ref,reason:e.layer==='request'?'explicit-one-request-exception':e.layer==='document'?'confirmed-article-intent':explicit(e)?'explicit-selection':'required-profile-rule'});
  let profileCount=mandatoryProfileCount;
  for(const entry of filtered.filter(e=>!mandatory.includes(e))) {
    if(profileCount>=MEMORY_MAX_RULES){excluded.push({ref:entry.ref,reason:'rule-count-budget'});continue;}
    packet.entries=[...packet.entries,entry];
    if(bytes()>MEMORY_MAX_BYTES){packet.entries=packet.entries.slice(0,-1);excluded.push({ref:entry.ref,reason:'byte-budget'});continue;}
    profileCount++;included.push({ref:entry.ref,reason:'active-profile-language-task-match'});
  }
  if(bytes()>MEMORY_MAX_BYTES)memoryError('Selected private examples exceed the budget. Choose fewer examples; no implicit truncation.');
  validateMemoryPacket(packet);
  // Include relevant active revisions even if budget-excluded; never unrelated profiles/languages/candidates.
  const stamp=hashBytes(JSON.stringify({binding:input.bindingId,activeIntentEvent:input.activeIntentEvent,intentId:intent?.id??null,
    activeRules:matching.map(p=>({id:p.id,status:p.status})),importantClaims:input.importantClaims,packet,options}));
  return {capture:{version:1,documentId:input.documentId,task:input.task,options,stamp,packet},bytes:bytes(),included,excluded,conflicts:[...new Map(conflicts.map(c=>[JSON.stringify(c),c])).values()]};
}
export function validatePreferenceRecord(p: PreferenceVersion): void {
  validatePreferenceInput({rule:p.rule,language:p.language,tasks:p.tasks,priority:p.priority,example:p.example});
  for(const id of [p.id,p.preferenceId,p.profileId])memoryText(id,200);
  if(!['candidate','active','disabled','dismissed','superseded'].includes(p.status))memoryError('Invalid preference status.');
}
export function validateMemoryPacket(value: unknown): asserts value is MemoryPacket {
  memoryObject(value,['version','task','language','intent','profile','entries','examples','importantClaims','exceptions','waivedRequiredRefs','authority']);
  if(value.version!==1||value.authority!=='author-guidance-not-facts-or-permissions')memoryError('Unknown guidance packet.');
  validateWritingTask(value.task);validateWritingLanguage(value.language);
  if(value.intent!==null){memoryObject(value.intent,['versionId','audience','purpose','thesis']);memoryText(value.intent.versionId,200);for(const key of ['audience','purpose','thesis'])memoryText(value.intent[key],2000,true);}
  if(value.profile!==null){memoryObject(value.profile,['id','name']);memoryText(value.profile.id,200);memoryText(value.profile.name,120);}
  memoryArray(value.entries,60);const refs=new Set<string>();for(const e of value.entries){memoryObject(e,['ref','layer','rule']);memoryText(e.ref,240);if(refs.has(e.ref)||!['profile','document','request'].includes(e.layer as string))memoryError('Invalid guidance entry.');refs.add(e.ref);validateWritingRule(e.rule);}
  memoryArray(value.examples,MEMORY_MAX_EXAMPLES);const examples=new Set<string>();for(const e of value.examples){memoryObject(e,['preferenceVersionId','example']);memoryText(e.preferenceVersionId,200);if(!refs.has(e.preferenceVersionId)||examples.has(e.preferenceVersionId))memoryError('Example is not associated with a unique selected rule.');examples.add(e.preferenceVersionId);validateWritingExample(e.example);}
  memoryArray(value.importantClaims,20);const occurrences=new Set<string>();for(const c of value.importantClaims){memoryObject(c,['occurrenceId','claimId','statement']);memoryText(c.occurrenceId,200);memoryText(c.claimId,200);memoryText(c.statement);if(occurrences.has(c.occurrenceId))memoryError('Duplicate important occurrence.');occurrences.add(c.occurrenceId);}
  memoryArray(value.exceptions,20);value.exceptions.forEach(validateWritingRule);memoryIds(value.waivedRequiredRefs,40);
  if(Buffer.byteLength(JSON.stringify(value),'utf8')>MEMORY_MAX_BYTES)memoryError('Guidance exceeds byte budget.');
}
export function validateMemoryCapture(value: unknown): asserts value is MemoryCapture {
  memoryObject(value,['version','documentId','task','options','stamp','packet']);
  if(value.version!==1)memoryError('Unknown capture version.');memoryText(value.documentId,200);validateWritingTask(value.task);
  if(typeof value.stamp!=='string'||!/^[a-f0-9]{64}$/.test(value.stamp))memoryError('Invalid guidance stamp.');
  const options=value.options as NormalizedMemoryOptions;normalizeMemoryOptions(optionsFromCapture(options));validateMemoryPacket(value.packet);
  if(value.task!==value.packet.task)memoryError('Guidance task mismatch.');
}
/** Literal matching; no regex code or arbitrary executable rules. Counts Unicode code points, including whitespace. */
export function checkWritingRules(text: string, packet: MemoryPacket) {
  validateText(text);validateMemoryPacket(packet);
  const findings:{ref:string;key:string;message:string;measured:number;limit:number|null}[]=[];
  const characters=[...text].length;
  for(const {ref,rule} of packet.entries){
    if(rule.key==='max-characters'&&characters>Number(rule.value))findings.push({ref,key:rule.key,message:'Unicode code-point count (including whitespace) exceeds the selected limit.',measured:characters,limit:Number(rule.value)});
    if(rule.key==='avoid-phrase'&&text.includes(rule.value))findings.push({ref,key:rule.key,message:'Case-sensitive literal phrase is present. This is not a meaning/intent verdict.',measured:1,limit:0});
  }
  return {detector:'writing-mechanical-v1',characters,countUnit:'unicode-code-points-including-whitespace',findings,semanticChecks:'not-performed'};
}
function briefQuote(text:string,value:Record<string,unknown>):void {
  const {start,end,quote}=value; memoryText(quote,2000);
  const boundary=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=text.length&&!(text.charCodeAt(n-1)>=0xd800&&text.charCodeAt(n-1)<=0xdbff&&text.charCodeAt(n)>=0xdc00&&text.charCodeAt(n)<=0xdfff);
  if(!boundary(start)||!boundary(end)||end<=start||text.slice(start,end)!==quote)memoryError('An intent explanation must quote the exact supplied brief.');
}
export function captureMemoryTask(value: MemoryTaskRequest): MemoryTaskRequest {
  memoryObject(value,['protocolVersion','requestId','task','documentId','baseRevisionId','baseIntentId','profileId','language','tasks','brief','evidence']);
  if(value.protocolVersion!==1||!['intent-draft','preference-draft'].includes(value.task))memoryError('Unknown memory task.');
  for(const id of [value.requestId,value.documentId,value.baseRevisionId])memoryText(id,200);
  for(const id of [value.baseIntentId,value.profileId])if(id!==null)memoryText(id,200);
  validateWritingLanguage(value.language);memoryIds(value.tasks,3);value.tasks.forEach(validateWritingTask);if(!value.tasks.length)memoryError('Choose a task.');
  memoryText(value.brief,10000,value.task==='preference-draft');memoryArray(value.evidence,20);
  if(value.task==='intent-draft'&&(value.evidence.length||value.profileId!==null))memoryError('An intent draft receives only its explicitly supplied brief, not feedback history.');
  if(value.task==='preference-draft'&&(!value.evidence.length||!value.profileId))memoryError('Preference drafts require a chosen profile and reasoned feedback.');
  const ids=new Set<string>();for(const e of value.evidence){memoryObject(e,['decisionId','documentId','changeId','action','category','reason','example']);for(const key of ['decisionId','documentId','changeId'])memoryText(e[key],200);
    if(ids.has(e.decisionId as string)||e.documentId!==value.documentId||!['rejected','reverted'].includes(e.action as string))memoryError('Feedback must be unique and belong to this document.');ids.add(e.decisionId as string);
    if(e.category!==null&&!REJECTION_CATEGORIES.includes(e.category as never))memoryError('Unknown rejection category.');memoryText(e.reason,4000,e.category!==null);if(e.example!==null)validateWritingExample(e.example);
  }
  if(Buffer.byteLength(JSON.stringify(value))>MEMORY_TASK_MAX_BYTES)memoryError('Memory task exceeds its byte limit; choose fewer items.');
  return structuredClone(value);
}
export function validateMemoryTaskOutput(value:unknown,request:MemoryTaskRequest):MemoryTaskOutput {
  captureMemoryTask(request);
  if(request.task==='intent-draft'){
    memoryObject(value,['protocolVersion','requestId','task','card','basis','suggestedFields','questions']);memoryObject(value.card,['audience','purpose','thesis','rules']);
    for(const key of ['audience','purpose','thesis'])memoryText(value.card[key],2000,true);memoryArray(value.card.rules);value.card.rules.forEach(validateWritingRule);
    const fields=[...['audience','purpose','thesis'].filter(k=>(value.card as Record<string,unknown>)[k]!==''),...value.card.rules.map((_,i)=>`rule:${i}`)];
    memoryIds(value.suggestedFields,23);if(value.suggestedFields.some(k=>!fields.includes(k)))memoryError('Suggestion references an absent field.');
    memoryArray(value.basis,40);const covered=new Set<string>();for(const q of value.basis){memoryObject(q,['field','start','end','quote']);memoryText(q.field,80);if(!fields.includes(q.field))memoryError('Unknown intent field reference.');briefQuote(request.brief,q);covered.add(q.field);}
    if(fields.some(k=>!covered.has(k)&&!(value.suggestedFields as string[]).includes(k)))memoryError('Every populated intent field needs a brief quotation or explicit suggestion label.');
    memoryArray(value.questions,10);value.questions.forEach(q=>memoryText(q,1000));
  }else{
    memoryObject(value,['protocolVersion','requestId','task','candidates','notes']);memoryArray(value.candidates,20);
    for(const c of value.candidates){memoryObject(c,['rule','evidenceIds','explanation']);validateWritingRule(c.rule);memoryIds(c.evidenceIds,20);if(!c.evidenceIds.length||c.evidenceIds.some(id=>!request.evidence.some(e=>e.decisionId===id)))memoryError('Candidate preference cites missing or unselected feedback.');memoryText(c.explanation,2000);}
    memoryArray(value.notes,10);value.notes.forEach(n=>memoryText(n,1000));
  }
  if(value.protocolVersion!==1||value.requestId!==request.requestId||value.task!==request.task)memoryError('Memory response identity mismatch.');
  if(Buffer.byteLength(JSON.stringify(value))>MEMORY_TASK_MAX_BYTES)memoryError('Memory response exceeds byte limit.');
  return structuredClone(value) as unknown as MemoryTaskOutput;
}
export interface ProfileExport {readonly format:1; readonly name:string; readonly preferences:readonly PreferenceInput[]}
export function validateProfileExport(value:unknown):asserts value is ProfileExport {
  memoryObject(value,['format','name','preferences']);if(value.format!==1)memoryError('Unknown profile export format.');memoryText(value.name,120);memoryArray(value.preferences,200);value.preferences.forEach(validatePreferenceInput);
  if(Buffer.byteLength(JSON.stringify(value))>500000)memoryError('Profile export exceeds 500000 bytes.');
}
