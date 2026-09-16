// SPDX-License-Identifier: Apache-2.0
import { readFileSync, statSync } from 'node:fs';
import { requireString, WriterError, normalizeMemoryOptions, optionsFromCapture, checkWritingRules, applyChange, renderMarkdown } from '@writer-agent/core';
import type { SourceSelection, MemoryOptions, WritingLanguage, WritingRule, MemoryCapture } from '@writer-agent/core';
import { Workspace } from '@writer-agent/storage';
import { OpenAICompatibleProvider, OllamaProvider, captureRequest, validateModelResponse, checkCancelled, parseAnalysisJson } from '@writer-agent/models';
import type { ModelProvider, ModelRequest, ProviderOptions, OpenAICompatibleOptions } from '@writer-agent/models';

export interface SuggestionCapture {readonly request:ModelRequest;readonly memory:MemoryCapture|null}
export function prepareSuggestion(workspace:Workspace,documentId:string,instruction:string,selection:SourceSelection={},memoryOptions:MemoryOptions={}):SuggestionCapture {
  const revision=workspace.currentRevision(documentId),sources=workspace.sources.context(selection);
  const plan=workspace.info().schemaVersion>=4?workspace.memory.plan(documentId,'revise',memoryOptions):null;
  if(workspace.info().schemaVersion<4 && Object.values(memoryOptions).some(v=>Array.isArray(v)?v.length: v!==undefined))throw new WriterError('MIGRATION_REQUIRED','Explicit writing guidance needs schema v4.');
  if(plan?.conflicts.length)throw new WriterError('GUIDANCE_CONFLICT','Resolve author-guidance conflicts before sending.');
  const request=captureRequest({documentId,baseRevisionId:revision.id,snapshot:revision.snapshot,instruction,...(sources.length?{sources}:{}),...(plan?{guidance:plan.capture.packet}:{})});
  return {request,memory:plan?.capture??null};
}
export async function submitSuggestion(workspace:Workspace,capture:SuggestionCapture,provider:ModelProvider,signal?:AbortSignal) {
  checkCancelled(signal);const request=captureRequest(capture.request),memory=capture.memory?structuredClone(capture.memory):null,providerId=provider.id;
  if(workspace.currentRevision(request.documentId).id!==request.baseRevisionId)throw new WriterError('STALE_REVISION','Document changed since the request preview.');
  workspace.sources.verifyContext(request.sources??[]);
  if(memory){workspace.memory.assertFresh(memory);if(JSON.stringify(request.guidance)!==JSON.stringify(memory.packet))throw new WriterError('INVALID_INPUT','Writing guidance differs from its capture.');}
  else if(request.guidance)throw new WriterError('INVALID_INPUT','Writing guidance requires a host capture.');
  const response:unknown=await provider.propose(structuredClone(request),signal);
  checkCancelled(signal);const checked=validateModelResponse(response,request,providerId);
  const changes=workspace.proposeChanges(request.documentId,request.baseRevisionId,checked.edits,providerId,
    request.sources?.length?{items:request.sources,instruction:request.instruction}:undefined,memory?{capture:memory,instruction:request.instruction}:undefined);
  let projected=request.snapshot;for(const c of changes)projected=applyChange(projected,c);
  return {changes,notes:checked.notes,mechanicalChecks:memory?checkWritingRules(renderMarkdown(projected),memory.packet):null};
}
/** No transaction stays open across the network. A stale result is rejected again by storage. */
export async function suggestChanges(workspace:Workspace,documentId:string,instruction:string,provider:ModelProvider,signal?:AbortSignal,selection:SourceSelection={},memoryOptions:MemoryOptions={}) {
  return submitSuggestion(workspace,prepareSuggestion(workspace,documentId,instruction,selection,memoryOptions),provider,signal);
}
const valueFlags = new Set(['--provider','--model','--base-url','--key-env','--instruction','--instruction-file',
  '--timeout-ms','--max-output-tokens','--response-format','--token-parameter','--sources','--excerpts','--language','--preferences','--examples','--exceptions-file','--waive-required']);
const boolFlags = new Set(['--send','--allow-remote']);
export function parseSuggestArgs(args: string[]) {
  const [directory,documentId,...flags] = args;
  requireString(directory,'workspace'); requireString(documentId,'documentId');
  if (directory.startsWith('--') || documentId.startsWith('--')) throw new WriterError('INVALID_INPUT','Usage: writer suggest <workspace> <documentId> --provider ... --model ... --instruction ...');
  const values = new Map<string,string>(); const booleans = new Set<string>();
  for (let i=0; i<flags.length; i++) {
    const flag=flags[i];
    if (!flag || values.has(flag) || booleans.has(flag)) throw new WriterError('INVALID_INPUT','Duplicate or missing option.');
    if (boolFlags.has(flag)) {booleans.add(flag);continue;}
    if (!valueFlags.has(flag)) throw new WriterError('INVALID_INPUT','Unknown suggest option. Run writer help. Never pass a literal API key.');
    const value=flags[++i];
    if (value === undefined || value.startsWith('--')) throw new WriterError('INVALID_INPUT','Option requires a value.');
    values.set(flag,value);
  }
  const provider=values.get('--provider');
  if (provider !== 'ollama' && provider !== 'openai-compatible') throw new WriterError('INVALID_INPUT','Choose --provider ollama or openai-compatible.');
  const model=values.get('--model'); requireString(model,'model',128);
  const instructionFlag=values.get('--instruction'); const instructionFile=values.get('--instruction-file');
  if ((instructionFlag === undefined) === (instructionFile === undefined)) throw new WriterError('INVALID_INPUT','Supply exactly one of --instruction or --instruction-file.');
  let instruction=instructionFlag;
  if (instructionFile !== undefined) {
    try {
      const stat=statSync(instructionFile);
      if (!stat.isFile() || stat.size > 40000) throw new Error('size');
      instruction=new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(instructionFile));
    } catch {throw new WriterError('INVALID_INPUT','Instruction file must be a readable UTF-8 file no larger than 40000 bytes.');}
  }
  requireString(instruction,'instruction',10000);
  const options: { -readonly [K in keyof ProviderOptions]: ProviderOptions[K] } = {model,allowRemote:booleans.has('--allow-remote')};
  const base=values.get('--base-url');if(base !== undefined) options.baseURL=base;
  const key=values.get('--key-env');if(key !== undefined) options.apiKeyEnv=key;
  for (const [flag,key] of [['--timeout-ms','timeoutMs'],['--max-output-tokens','maxOutputTokens']] as const) {
    const value=values.get(flag);
    if (value !== undefined) {
      if (!/^\d+$/.test(value)) throw new WriterError('INVALID_INPUT','Numeric options must be positive decimal integers.');
      options[key]=Number(value);
    }
  }
  let selected: OpenAICompatibleProvider | OllamaProvider;
  if(provider === 'ollama') {
    if(values.has('--response-format') || values.has('--token-parameter')) throw new WriterError('INVALID_INPUT','Response-format and token-parameter switches apply only to openai-compatible.');
    selected=new OllamaProvider(options);
  } else {
    const extra: { -readonly [K in keyof OpenAICompatibleOptions]: OpenAICompatibleOptions[K] } = {...options};
    const format=values.get('--response-format');
    if(format !== undefined) {
      if(format !== 'json-schema' && format !== 'json' && format !== 'prompt') throw new WriterError('INVALID_INPUT','Unknown response format.');
      extra.responseFormat=format;
    }
    const token=values.get('--token-parameter');
    if(token !== undefined) {
      if(token !== 'max_completion_tokens' && token !== 'max_tokens') throw new WriterError('INVALID_INPUT','Unknown token parameter.');
      extra.tokenParameter=token;
    }
    selected=new OpenAICompatibleProvider(extra);
  }
  const ids = (flag:string):string[] => {
    const v=values.get(flag); if(v===undefined)return [];
    const parts=v.split(','); if(parts.some(p=>!p||p!==p.trim())||new Set(parts).size!==parts.length)throw new WriterError('INVALID_INPUT','Source selections need unique comma-separated IDs, without spaces.');
    return parts;
  };
  const selection:SourceSelection={snapshots:ids('--sources'),excerpts:ids('--excerpts')};
  const memoryOptions:MemoryOptions={
    ...(values.has('--language')?{language:values.get('--language') as WritingLanguage}:{}),
    selectedPreferenceIds:ids('--preferences'),examplePreferenceIds:ids('--examples'),waiveRequiredRefs:ids('--waive-required'),
    ...(values.has('--exceptions-file')?{exceptions:readExceptionFile(values.get('--exceptions-file')!)}:{}),
  };
  normalizeMemoryOptions(memoryOptions);
  return {directory,documentId,instruction,provider:selected,send:booleans.has('--send'),selection,memoryOptions};
}
function readExceptionFile(path:string):readonly WritingRule[] {
  const stat=statSync(path);if(!stat.isFile()||stat.size>50000)throw new WriterError('INVALID_INPUT','Exception file must be an ordinary JSON file <=50000 bytes.');
  const v=parseAnalysisJson(new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(path)));
  return optionsFromCapture(normalizeMemoryOptions({exceptions:v as WritingRule[]})).exceptions!;
}
export async function suggestCommand(args: string[]): Promise<void> {
  const options=parseSuggestArgs(args);
  const workspace=Workspace.open(options.directory);
  const controller=new AbortController();
  const cancel=() => controller.abort();
  try {
    const revision=workspace.currentRevision(options.documentId);
    const sourceContext=workspace.sources.context(options.selection);
    const memory=workspace.info().schemaVersion>=4?workspace.memory.plan(options.documentId,'revise',options.memoryOptions):null;
    const documentBytes=Buffer.byteLength(workspace.markdown(options.documentId),'utf8');
    if (!options.send) {
      console.log(JSON.stringify({status:'preview-only',sent:false,provider:options.provider.describe(),documentId:options.documentId,
        baseRevisionId:revision.id,documentBytes,blocks:revision.snapshot.blocks.length,
        writingMemory:memory,sourceContext:{items:sourceContext.map(({text,...item})=>({...item,bytes:Buffer.byteLength(text,'utf8')})),serializedBytes:Buffer.byteLength(JSON.stringify(sourceContext),'utf8'),verification:'unverified'},
        notice:'No request sent. Add --send to transmit the entire selected document, instruction and explicitly selected source text to this endpoint. Remote inference may cost money. Loopback describes the connection, not the server\'s own privacy policy.'},null,2));
      return;
    }
    process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
    const result=await suggestChanges(workspace,options.documentId,options.instruction,options.provider,controller.signal,options.selection,options.memoryOptions);
    console.log(JSON.stringify({status:'pending-review',manuscriptChanged:false,changes:result.changes,mechanicalChecks:result.mechanicalChecks,
      sourceProvenance:{verification:'supplied-not-verified',selectedItems:sourceContext.length,queryCommand:'writer provenance <workspace> <changeId>'},
      modelNotes:{verified:false,persisted:false,notes:result.notes}},null,2));
  } finally {
    process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
    workspace.close();
  }
}
