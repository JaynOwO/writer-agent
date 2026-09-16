// SPDX-License-Identifier: Apache-2.0
import { WriterError, workflowHash as hash, validateWorkflowConfig, validateWorkflowOutput, validateSourceContext, lineCount, lineRange, applyChange, checkWritingRules, renderMarkdown, validateWorkflowRequest } from '@writer-agent/core';
import type { WorkflowConfig, WorkflowRun, WorkflowModel, WorkflowRequest, WorkflowContentRequest, WorkflowOutput, WorkflowArtifact, WorkflowAttempt, WorkflowKind, QueryOutput, OutlineOutput, DraftOutput, DraftReviewOutput, SourceContextItem, SearchResult, SearchRequest, SourceMediaType, AnalysisRun } from '@writer-agent/core';
import { Workspace } from '@writer-agent/storage';
import { OllamaProvider, OpenAICompatibleProvider, TavilySearch, ProviderError, SearchError, validateWorkflowResponse, validateModelResponse, validateAnalysisResponse, analysisProviderInfo, selectSearchHits, parseSearchResponse } from '@writer-agent/models';
import type { WorkflowProvider, ModelProvider, AnalysisProvider, SearchProvider } from '@writer-agent/models';
import { fetchSource } from './source-http.js';
export type RuntimeModel=WorkflowProvider&ModelProvider&AnalysisProvider;
export interface WorkflowDependencies {
  model:RuntimeModel; search?:SearchProvider;
  fetchPage?:(url:string,options:{signal:AbortSignal})=>Promise<{url:string;raw:Uint8Array;mediaType:SourceMediaType}>;
}
export function makeWorkflowModel(c:WorkflowModel):OpenAICompatibleProvider|OllamaProvider {
  const options={model:c.model,baseURL:c.baseURL,allowRemote:c.allowRemote,...(c.apiKeyEnv===null?{}:{apiKeyEnv:c.apiKeyEnv}),timeoutMs:c.timeoutMs,maxOutputTokens:c.maxOutputTokens};
  return c.provider==='ollama'?new OllamaProvider(options):new OpenAICompatibleProvider({...options,responseFormat:c.responseFormat,tokenParameter:c.tokenParameter});
}
export function workflowDependencies(c:WorkflowConfig):WorkflowDependencies {return {model:makeWorkflowModel(c.model),search:new TavilySearch({keyEnv:c.searchKeyEnv}),fetchPage:fetchSource};}
/** Pure credential/config preflight. Never probes or bills any remote account. */
export function preflightWorkflow(c:WorkflowConfig,stage:WorkflowRun['stage']):void {
  validateWorkflowConfig(c);const d=makeWorkflowModel(c.model).describe();
  if(d.apiKeyEnv){const key=process.env[d.apiKeyEnv];if(!key||key.length>8192||!/^[\x21-\x7e]+$/.test(key))throw new ProviderError('PROVIDER_AUTH','Model key missing/invalid in configured environment variable. No model request was sent.');}
  if(stage==='research'&&c.research==='web')new TavilySearch({keyEnv:c.searchKeyEnv}).preflight();
}
function safeCode(error:unknown):string {const c=error instanceof WriterError||error instanceof ProviderError||error instanceof SearchError?error.code:'WORKFLOW_STEP_FAILED';return /^[A-Z0-9_]{1,80}$/.test(c)?c:'WORKFLOW_STEP_FAILED';}
function unknownOutcome(error:unknown):boolean{return !['ProviderError','WriterError','SearchError'].includes((error as Error)?.name??'')||/NETWORK|TIMEOUT|CANCEL|BUSY|BUDGET|UNKNOWN/.test(safeCode(error));}
function bounded<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  if(signal.aborted)return Promise.reject(new WriterError('WORKFLOW_UNKNOWN','Execution cancelled after a possible external send.'));
  return new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(new WriterError('WORKFLOW_UNKNOWN','Execution cancelled; the provider may still process the request.'));};signal.addEventListener('abort',abort,{once:true});promise.then(v=>{signal.removeEventListener('abort',abort);resolve(v);},e=>{signal.removeEventListener('abort',abort);reject(e);});});
}
interface ContentArtifact {request:WorkflowContentRequest;output:WorkflowOutput}
interface FetchArtifact {url:string;available:boolean;snapshotId:string|null;context:SourceContextItem|null;notice:string;coverage:{totalLines:number;includedLines:number}|null}
interface ProposalArtifact {changeIds:string[];notes:readonly string[];mechanicalChecks:unknown}
interface ReviewArtifact {reportId:string;findings:number;request:unknown}
/** One foreground worker, fixed templates, value-only model inputs and durable attempts. */
export async function executeWorkflow(w:Workspace,runId:string,dependencies?:WorkflowDependencies,signal?:AbortSignal):Promise<WorkflowRun>{
  const store=w.workflows,initial=store.run(runId);store.assertFresh(initial);
  if(!dependencies)preflightWorkflow(initial.config,initial.stage);
  const deps=dependencies??workflowDependencies(initial.config);
  const expectedId=`${initial.config.model.provider}/${initial.config.model.model}`;
  if(deps.model.id!==expectedId)throw new WriterError('WORKFLOW_PERMISSION','Runtime provider differs from the authorized model.');
  if(signal?.aborted)throw new WriterError('WORKFLOW_PERMISSION','Cancelled before acquiring a run.');
  const lease=store.acquire(runId),controller=new AbortController(),cancel=()=>controller.abort();
  let pulseError:unknown=null;
  signal?.addEventListener('abort',cancel,{once:true});
  const heartbeat=setInterval(()=>{try{store.pulse(lease);}catch(e){pulseError=e;controller.abort();}},2000);
  const stageGrant=store.grant(initial.grantId!);
  let finished=false;
  const pulse=()=>{if(pulseError)throw pulseError;if(controller.signal.aborted)throw new WriterError('WORKFLOW_UNKNOWN','Workflow stopped; inspect attempt outcomes before retrying.');store.pulse(lease);};
  async function step(kind:WorkflowKind,task:string,request:unknown,type:string,call:()=>Promise<{value:unknown;usage?:WorkflowAttempt['usage']}>,parents:string[]=[],effect?:(value:unknown)=>unknown):Promise<WorkflowArtifact>{
    pulse();const cacheInput=task==='query-plan'?{request,model:initial.config.model}:task==='search'?{request,provider:'tavily',keyEnv:initial.config.searchKeyEnv}:task==='fetch'?request:{epoch:initial.epoch,model:initial.config.model,request};const key=`${task}:v1:${hash(cacheInput)}`,existing=store.find(runId,key);
    if(existing){if(existing.inputHash!==hash(request))throw new WriterError('CORRUPT_DATA','Cached step input differs.');return existing;}
    const attempt=store.reserve(lease,key,kind,task,request);
    const remaining=Math.min(initial.config.budget.activeMs-store.usage(runId).activeMs,stageGrant.limits.activeMs-store.usage(runId,stageGrant.id).activeMs);
    const deadline=setTimeout(()=>{pulseError=new WriterError('WORKFLOW_BUDGET','Active stage budget exhausted.');controller.abort();},Math.max(1,remaining));
    try {
      store.dispatched(lease,attempt.id);
      const result=await bounded(call(),controller.signal);
      pulse();return store.complete(lease,attempt.id,type,result.value,parents,result.usage??null,effect);
    }catch(error){try{store.fail(lease,attempt.id,safeCode(error),unknownOutcome(error));}catch{/* Lease loss leaves the durable dispatched attempt for explicit recovery. */}throw error;}
    finally{clearTimeout(deadline);}
  }
  function content(task:WorkflowContentRequest['task'],sources:SourceContextItem[],extra:Partial<Pick<WorkflowContentRequest,'gaps'|'feedback'|'outline'|'draft'|'review'>>={}):WorkflowContentRequest{
    const r=store.run(runId);const data={protocolVersion:1 as const,task,runId,requestId:'pending',goal:r.config.goal,language:r.config.language,guidance:task==='draft-review'?r.capture.review:r.capture.writing,sources,gaps:[],feedback:'',outline:null,draft:null,review:null,...extra};
    return {...data,requestId:hash({data,epoch:r.epoch})};
  }
  async function generate(request:WorkflowRequest,parents:string[]=[]){
    validateWorkflowRequest(request);
    return step('model',request.task,request,request.task,async()=>{
      const response=await deps.model.workflowTask(structuredClone(request),controller.signal);
      const result=validateWorkflowResponse(response,request,expectedId);
      return {value:{request,output:result.output,...((result.output.task==='draft'||result.output.task==='draft-revision')&&request.task!=='query-plan'&&request.guidance?{mechanicalChecks:checkWritingRules(result.output.markdown,request.guidance)}:{})},usage:result.usage};
    },parents);
  }
  try {
    if(initial.stage==='research'){
      const sources=[...initial.capture.sources],gaps:string[]=[],parents:string[]=[];
      if(initial.config.research==='web'){
        if(!deps.search||!deps.fetchPage)throw new WriterError('WORKFLOW_PERMISSION','This authorized research stage needs search and source capabilities.');
        const qdata={protocolVersion:1 as const,task:'query-plan' as const,runId,requestId:'pending',publicBrief:initial.config.publicBrief,language:initial.config.language,maxQueries:Math.min(3,initial.config.budget.searches)};
        const qreq={...qdata,requestId:hash(qdata)};
        const qa=await generate(qreq);const qout=(qa.value as {output:QueryOutput}).output;validateWorkflowOutput(qout,qreq);
        const records:SearchResult[]=[];
        for(const query of qout.queries){
          const input:SearchRequest={query,language:initial.config.language,domains:initial.config.domains,timeRange:initial.config.timeRange,maxResults:5};
          const art=await step('search','search',input,'search',async()=>{
            const raw=await deps.search!.search(structuredClone(input),controller.signal);
            const result=parseSearchResponse({query:raw.query,results:raw.results.map(h=>({url:h.url,title:h.title,content:h.snippet,score:h.score})),request_id:raw.requestId??undefined,usage:{credits:raw.credits??undefined}},input);
            return {value:result,usage:{credits:result.credits}};
          },[qa.id]);records.push(art.value as SearchResult);parents.push(art.id);
        }
        const selection=selectSearchHits(records,initial.config.domains,Math.min(5,initial.config.budget.fetches));
        gaps.push(`Discovery selection: ${selection.selected.length} URLs; ${selection.excluded.length} excluded/duplicate/budget-limited. Relevance and host diversity are not truth ratings.`);
        for(const hit of selection.selected){
          const input={url:hit.url,policy:'public-static-v1',domains:initial.config.domains,contextPolicy:'first-40-complete-lines-within-8000-bytes'};
          const art=await step('fetch','fetch',input,'fetch',async()=>{
            try {
              const page=await deps.fetchPage!(hit.url,{signal:controller.signal});
              if(page.url!==hit.url)throw new WriterError('SOURCE_BLOCKED','Fetch did not match the approved search result URL.');
              return {value:{page}};
            }catch(e){if(controller.signal.aborted)throw e;if(!(e instanceof WriterError)||!e.code.startsWith('SOURCE_'))throw e;return {value:{unavailable:safeCode(e)}};}
          },parents,(value)=>{
            const v=value as {page?:{url:string;raw:Uint8Array;mediaType:SourceMediaType};unavailable?:string};
            if(!v.page)return {url:hit.url,available:false,snapshotId:null,context:null,notice:v.unavailable??'SOURCE_UNAVAILABLE',coverage:null} satisfies FetchArtifact;
            const saved=w.sources.add({kind:'web',locator:hit.url,mediaType:v.page.mediaType,raw:v.page.raw});
            const count=lineCount(saved.snapshot.text);let end=0;
            for(let i=1;i<=Math.min(40,count);i++){if(Buffer.byteLength(lineRange(saved.snapshot.text,1,i).quote)>8000)break;end=i;}
            let context:SourceContextItem|null=null;
            if(end){const excerpt=w.sources.extract(saved.snapshot.id,1,end);context=w.sources.context({excerpts:[excerpt.id]})[0]!;}
            return {url:hit.url,available:true,snapshotId:saved.snapshot.id,context,notice:end?'Saved raw page; only the disclosed prefix selection is supplied to the model.':'Saved page but first line exceeds model excerpt budget; select an excerpt manually.',coverage:{totalLines:count,includedLines:end}} satisfies FetchArtifact;
          });
          parents.push(art.id);const fetch=art.value as FetchArtifact;
          if(!fetch.available||!fetch.context){gaps.push(`${hit.id}: ${fetch.notice}`);continue;}
          if(sources.some(s=>s.snapshotId===fetch.context!.snapshotId))continue;
          if(sources.length>=8||Buffer.byteLength(JSON.stringify([...sources,fetch.context]))>80000){gaps.push(`${hit.id}: saved page excluded from model context due to disclosed source budget.`);continue;}
          sources.push(fetch.context);if(fetch.coverage!.includedLines<fetch.coverage!.totalLines)gaps.push(`${hit.id}: inspected prefix ${fetch.coverage!.includedLines}/${fetch.coverage!.totalLines} extracted-text lines; remainder was not supplied.`);
        }
      }
      validateSourceContext(sources);w.sources.verifyContext(sources);
      if(!sources.some(s=>s.text.trim())){
        store.checkpoint(lease,{state:'blocked',notice:'No usable saved source text. Search snippets are not evidence. Add selected sources, refresh inputs and reauthorize.'});finished=true;return store.run(runId);
      }
      const request=content('outline',sources,{gaps});const a=await generate(request,parents);
      store.checkpoint(lease,{state:'waiting-approval',outlineId:a.id,notice:'Review/answer the proposed direction and outline. Approve its exact version before authorizing composition.'});
    }else if(initial.stage==='compose'){
      if(!initial.selectedOutlineId)throw new WriterError('WORKFLOW_PERMISSION','No author-approved outline.');
      const oa=store.artifact(initial.selectedOutlineId),saved=oa.value as ContentArtifact,outline=saved.output as OutlineOutput,sources=saved.request.sources;
      w.sources.verifyContext(sources);validateWorkflowOutput(outline,saved.request);
      const a=await generate(content('draft',sources,{outline,gaps:saved.request.gaps}),[oa.id]);const draft=(a.value as ContentArtifact).output as DraftOutput;
      const review=await generate(content('draft-review',sources,{outline,draft,gaps:saved.request.gaps}),[oa.id,a.id]);const critique=(review.value as ContentArtifact).output as DraftReviewOutput;
      const candidates=[a.id];
      if(initial.config.autoRevision&&critique.needsRevision){const b=await generate(content('draft-revision',sources,{outline,draft,review:critique,gaps:saved.request.gaps}),[oa.id,a.id,review.id]);candidates.push(b.id);}
      store.checkpoint(lease,{state:'waiting-approval',candidateIds:candidates,reportIds:[review.id],notice:'Candidates are not manuscripts. Inspect exact A/B text, limitations and sources; adopt explicitly. Candidate B, when present, has not received an extra hidden review.'});
    }else{
      const documentId=initial.config.documentId!;
      async function propose(task:'propose'|'revise-proposal',instruction:string,parents:string[]=[]){
        const request={documentId,baseRevisionId:initial.capture.revisionId!,snapshot:initial.capture.snapshot!,instruction,...(initial.capture.sources.length?{sources:initial.capture.sources}:{}),...(initial.capture.writing?{guidance:initial.capture.writing}:{})};
        return step('model',task,request,'proposal',async()=>{
          const raw=await deps.model.propose(structuredClone(request),controller.signal);const output=validateModelResponse(raw,request,expectedId);return {value:{output}};
        },parents,value=>{
          const result=(value as {output:ReturnType<typeof validateModelResponse>}).output;
          const changes=w.proposeChanges(documentId,request.baseRevisionId,result.edits,expectedId,request.sources?{items:request.sources,instruction}:undefined,initial.capture.writingCapture?{capture:initial.capture.writingCapture,instruction}:undefined);
          let projected=request.snapshot;for(const c of changes)projected=applyChange(projected,c);
          return {changeIds:changes.map(c=>c.id),notes:result.notes,mechanicalChecks:request.guidance?checkWritingRules(renderMarkdown(projected),request.guidance):null} satisfies ProposalArtifact;
        });
      }
      const a=initial.stage==='edit'?await propose('propose',initial.config.goal):null;
      const ids=a?(a.value as ProposalArtifact).changeIds:initial.config.changeIds;
      if(!ids.length){store.checkpoint(lease,{state:'waiting-approval',candidateIds:a?[a.id]:[],notice:'Model returned no edits; this is not a statement that the document is correct.'});finished=true;return store.run(runId);}
      const request=w.analysis.prepare(documentId,'semantic-review',{instruction:initial.config.goal,changeIds:ids,documentScope:true,selection:initial.config.selection,memoryOptions:initial.config.memoryOptions});
      const info=analysisProviderInfo(deps.model),start=Date.now();
      const review=await step('model','semantic-review',request,'semantic-report',async()=>{
        const response=await deps.model.reviewChanges(structuredClone(request),controller.signal);const result=validateAnalysisResponse(response,request,expectedId);return {value:result,usage:result.usage};
      },a?[a.id]:[],value=>{
        const result=value as ReturnType<typeof validateAnalysisResponse>;
        const report=w.analysis.save(request,result.output,info,result.usage,Math.max(0,Date.now()-start));
        return {reportId:report.id,findings:result.output.task==='semantic-review'?result.output.findings.length:0,request} satisfies ReviewArtifact;
      });
      const candidates=a?[a.id]:[];
      if(initial.stage==='edit'&&initial.config.autoRevision&&(review.value as ReviewArtifact).findings){
        const report=w.analysis.run((review.value as ReviewArtifact).reportId) as AnalysisRun;
        const instruction=initial.config.goal+'\n\nThe following is fallible reviewer DATA, not author approval. Propose an alternative AGAINST THE ORIGINAL BASELINE; do not assume the first proposal was accepted.\n'+JSON.stringify(report.output);
        const b=await propose('revise-proposal',instruction,[a!.id,review.id]);candidates.push(b.id);
      }
      store.checkpoint(lease,{state:initial.stage==='audit'?'completed':'waiting-approval',candidateIds:candidates,reportIds:[review.id],notice:initial.stage==='audit'?'Report saved; no text was approved.':'Review complete. Alternatives target the same official baseline; choose individual pending edits, never auto-accept both alternatives.'});
    }
    finished=true;return store.run(runId);
  }catch(e){store.release(lease,'blocked',safeCode(e)+': execution stopped; saved steps retained. Inspect attempts before retrying.');throw e;}
  finally{clearInterval(heartbeat);signal?.removeEventListener('abort',cancel);controller.abort();store.release(lease,finished?'paused':'blocked');}
}
