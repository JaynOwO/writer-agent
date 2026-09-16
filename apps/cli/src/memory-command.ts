// SPDX-License-Identifier: Apache-2.0
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureMemoryTask, validateProfileExport, memoryText, memoryIds, WriterError, normalizeMemoryOptions, optionsFromCapture } from '@writer-agent/core';
import type { MemoryTaskRequest, IntentCard, PreferenceInput, WritingLanguage, WritingTask, MemoryOptions } from '@writer-agent/core';
import { Workspace } from '@writer-agent/storage';
import { validateMemoryResponse, memoryProviderInfo, checkCancelled, parseAnalysisJson } from '@writer-agent/models';
import type { MemoryProvider } from '@writer-agent/models';
import { parseSuggestArgs } from './suggest.js';
export const memoryHelp=`Siglum Intent & Writing Memory v1 — author control, not automatic learning

  writer profile create <workspace> <name>
  writer profile list <workspace>
  writer profile attach <workspace> <documentId> <profileId|none>
  writer profile export <workspace> <profileId> <new-file.json> [--examples <preferenceId,...>]
  writer profile import <workspace> <profile.json> [--apply]
  writer intent list <workspace> <documentId>
  writer intent save <workspace> <documentId> <card.json>
  writer intent confirm <workspace> <intentVersionId>
  writer intent draft <workspace> <documentId> --language zh-CN|en|any <provider-options>
  writer memory add <workspace> <profileId> <preference.json>
  writer memory list <workspace> <profileId>
  writer memory activate|disable|dismiss <workspace> <versionId,...>
  writer memory correct <workspace> <versionId> <preference.json>
  writer memory feedback <workspace> <documentId>
  writer memory distill <workspace> <documentId> --profile <profileId> --decisions <decisionId,...>
    [--feedback-examples <decisionId,...>] [--tasks revise,review] --language zh-CN|en|any <provider-options>
  writer memory plan <workspace> <documentId> <revise|review|title> [selection.json]
  writer memory uses <workspace> <documentId>
  writer memory show-use <workspace> <useId>
  writer memory for-change <workspace> <changeId>
  writer memory run <workspace> <memoryRunId>
  writer guide <workspace> [--lang zh-CN|en]

Provider options: --provider ollama|openai-compatible --model ID --instruction TEXT
(or --instruction-file FILE), optional --base-url, --key-env, format/timeout/token flags.
Preview is default. --send explicitly authorizes one model call; remote also needs --allow-remote.
Memory drafts do not activate rules. Import previews by default; imported rules are candidates even after --apply.
Export omits examples unless explicitly selected. Disabled rules may remain in history and backups.
`;
export function readMemoryJson(path:string):unknown {
  try{const file=resolve(path),stat=statSync(file);if(!stat.isFile()||stat.size>500000)throw Error();return parseAnalysisJson(new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(file)));}
  catch{throw new WriterError('INVALID_INPUT','Expected a UTF-8 JSON file <=500000 bytes with unique keys.');}
}
export function exportMemoryJson(path:string,value:unknown):void{writeFileSync(resolve(path),JSON.stringify(value,null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});}
export async function runMemoryTask(w:Workspace,input:MemoryTaskRequest,provider:MemoryProvider,signal?:AbortSignal){
  checkCancelled(signal);const request=captureMemoryTask(input),providerId=provider.id,info=memoryProviderInfo(provider);w.memory.assertTaskFresh(request);
  const response:unknown=request.task==='intent-draft'?await provider.draftIntent(structuredClone(request),signal):await provider.draftPreferences(structuredClone(request),signal);
  checkCancelled(signal);const checked=validateMemoryResponse(response,request,providerId);return w.memory.saveTask(request,checked.output,info,checked.usage);
}
function count(args:string[],min:number,max=min){if(args.length<min||args.length>max)throw new WriterError('INVALID_INPUT','Wrong number of writing-memory arguments. Run writer memory help.');}
const print=(v:unknown)=>console.log(JSON.stringify(v,null,2));
function ids(text:string):string[]{const a=text.split(',');memoryIds(a,100);if(a.some(v=>v.trim()!==v))throw new WriterError('INVALID_INPUT','IDs must not contain surrounding spaces.');return a;}
export function parseMemoryTaskArgs(args:string[],task:MemoryTaskRequest['task']){
  count(args,2,100);const [directory,documentId,...flags]=args;memoryText(directory,4096);memoryText(documentId,200);
  const extras=new Map<string,string>(),pass:string[]=[];
  const special=new Set(['--profile','--decisions','--feedback-examples','--tasks']);
  const paired=new Set(['--provider','--model','--instruction','--instruction-file','--base-url','--key-env','--timeout-ms','--max-output-tokens','--response-format','--token-parameter','--language']);
  for(let i=0;i<flags.length;i++){const f=flags[i]!;if(special.has(f)){if(extras.has(f))throw new WriterError('INVALID_INPUT','Duplicate memory option.');const v=flags[++i];if(!v||v.startsWith('--'))throw new WriterError('INVALID_INPUT','Missing memory option value.');extras.set(f,v);}
    else if(paired.has(f)){const v=flags[++i];if(!v||v.startsWith('--'))throw new WriterError('INVALID_INPUT','Missing provider option value.');pass.push(f,v);}
    else if(f==='--send'||f==='--allow-remote')pass.push(f);else throw new WriterError('INVALID_INPUT','Unknown memory draft flag. No manuscript/source/history auto-selection is available.');}
  const opts=parseSuggestArgs([directory,documentId,...pass]);if(!opts.memoryOptions.language)throw new WriterError('INVALID_INPUT','Choose --language zh-CN, en or any.');
  if(task==='intent-draft'&&extras.size)throw new WriterError('INVALID_INPUT','Intent drafts accept no feedback/profile options.');
  if(task==='preference-draft'&&(!extras.has('--profile')||!extras.has('--decisions')))throw new WriterError('INVALID_INPUT','Choose profile and reasoned feedback IDs.');
  return {...opts,brief:opts.instruction,language:opts.memoryOptions.language as WritingLanguage,
    tasks:extras.has('--tasks')?ids(extras.get('--tasks')!) as WritingTask[]:['revise','review'] as WritingTask[],
    ...(extras.has('--profile')?{profileId:extras.get('--profile')!}:{}),
    decisionIds:extras.has('--decisions')?ids(extras.get('--decisions')!):[],exampleDecisionIds:extras.has('--feedback-examples')?ids(extras.get('--feedback-examples')!):[]};
}
async function draftCommand(args:string[],task:MemoryTaskRequest['task']){
  const opts=parseMemoryTaskArgs(args,task),w=Workspace.open(opts.directory),controller=new AbortController(),cancel=()=>controller.abort();
  try{const request=w.memory.prepareTask(opts.documentId,task,opts);
    if(!opts.send){print({status:'preview-only',sent:false,provider:opts.provider.describe(),request,bytes:Buffer.byteLength(JSON.stringify(request)),notice:'This sends only the displayed brief or selected feedback. May cost money. Drafts never activate preferences/intent.'});return;}
    process.once('SIGINT',cancel);process.once('SIGTERM',cancel);print(await runMemoryTask(w,request,opts.provider,controller.signal));
  }finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);w.close();}
}
export async function memoryCommand(family:'profile'|'intent'|'memory',args:string[]){
  const [action='help',...rest]=args;
  if(action==='help'){count(rest,0);console.log(memoryHelp);return;}
  if(family==='intent'&&action==='draft'){await draftCommand(rest,'intent-draft');return;}
  if(family==='memory'&&action==='distill'){await draftCommand(rest,'preference-draft');return;}
  const limits:Record<string,[number,number]>={
    'profile:create':[2,2],'profile:list':[1,1],'profile:attach':[3,3],'profile:export':[3,5],'profile:import':[2,3],
    'intent:list':[2,2],'intent:save':[3,3],'intent:confirm':[2,2],
    'memory:add':[3,3],'memory:list':[2,2],'memory:activate':[2,2],'memory:disable':[2,2],'memory:dismiss':[2,2],'memory:correct':[3,3],
    'memory:feedback':[2,2],'memory:plan':[3,4],'memory:uses':[2,2],'memory:show-use':[2,2],'memory:for-change':[2,2],'memory:run':[2,2],
  };
  const key=`${family}:${action}`,bounds=limits[key];if(!bounds)throw new WriterError('INVALID_INPUT','Unknown memory command.');count(rest,...bounds);
  const [directory,target,extra,fourth,fifth]=rest;memoryText(directory,4096);const w=Workspace.open(directory);
  try{switch(key){
    case 'profile:create':print(w.memory.createProfile(target!));break;
    case 'profile:list':print(w.memory.profiles());break;
    case 'profile:attach':w.memory.attach(target!,extra==='none'?null:extra!);print({attached:true});break;
    case 'profile:export':if(rest.length!==3&&(rest.length!==5||fourth!=='--examples'))throw new WriterError('INVALID_INPUT','Use --examples with selected IDs, or omit private examples.');exportMemoryJson(extra!,w.memory.exportProfile(target!,fifth?ids(fifth):[]));print({exported:true,privateExamplesIncluded:!!fifth});break;
    case 'profile:import':{if(extra!==undefined&&extra!=='--apply')throw new WriterError('INVALID_INPUT','Use --apply only after preview.');const data=readMemoryJson(target!);validateProfileExport(data);if(extra)print(w.memory.importProfile(data));else print({status:'preview-only',data,notice:'--apply creates a new profile with candidate-only rules; none are activated.'});break;}
    case 'intent:list':print(w.memory.intents(target!));break;
    case 'intent:save':print(w.memory.saveIntent(target!,readMemoryJson(extra!) as IntentCard));break;
    case 'intent:confirm':print(w.memory.confirmIntent(target!));break;
    case 'memory:add':print(w.memory.addPreference(target!,readMemoryJson(extra!) as PreferenceInput));break;
    case 'memory:list':print(w.memory.preferences(target!));break;
    case 'memory:activate':case 'memory:disable':case 'memory:dismiss':print(w.memory.decidePreferences(ids(target!),action as 'activate'|'disable'|'dismiss'));break;
    case 'memory:correct':print(w.memory.correctPreference(target!,readMemoryJson(extra!) as PreferenceInput));break;
    case 'memory:feedback':print(w.memory.feedbackChoices(target!));break;
    case 'memory:plan':{const options=fourth?optionsFromCapture(normalizeMemoryOptions(readMemoryJson(fourth) as MemoryOptions)):{};print(w.memory.plan(target!,extra as WritingTask,options));break;}
    case 'memory:uses':print(w.memory.uses(target!));break;
    case 'memory:show-use':print(w.memory.use(target!));break;
    case 'memory:for-change':print(w.memory.forChange(target!));break;
    case 'memory:run':print(w.memory.taskRun(target!));break;
  }}finally{w.close();}
}
