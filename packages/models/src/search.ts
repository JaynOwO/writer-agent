// SPDX-License-Identifier: Apache-2.0
import { exactObject, workflowHash, publicResultUrl, validateText, isRecord, wfInteger } from '@writer-agent/core';
import type { SearchRequest, SearchResult, SearchHit } from '@writer-agent/core';
import { postJson } from './http.js';
import { ProviderError } from './errors.js';
export class SearchError extends Error {constructor(readonly code:string,message:string,readonly status:number|null=null){super(message);this.name='SearchError';}}
export interface SearchProvider {search(input:SearchRequest,signal?:AbortSignal):Promise<SearchResult>}
/** No SDK, no automatic parameters or answer generation. Test endpoint override is loopback only. */
export class TavilySearch implements SearchProvider {
  private readonly endpoint:string;private readonly keyEnv:string;
  constructor(options:{keyEnv?:string;testEndpoint?:string}={}){
    this.keyEnv=options.keyEnv??'TAVILY_API_KEY';if(!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(this.keyEnv))throw new SearchError('SEARCH_CONFIG','Expected a key environment-variable name.');
    this.endpoint=options.testEndpoint??'https://api.tavily.com/search';
    if(options.testEndpoint){const u=new URL(this.endpoint);if(!['127.0.0.1','[::1]'].includes(u.hostname)||!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw new SearchError('SEARCH_CONFIG','Only literal loopback is permitted for test endpoint injection.');}
  }
  preflight(){const key=process.env[this.keyEnv];if(!key||key.length>8192||!/^[\x21-\x7e]+$/.test(key))throw new SearchError('SEARCH_AUTH','Search key missing/invalid in the configured environment variable. No search was sent.');}
  async search(input:SearchRequest,signal?:AbortSignal):Promise<SearchResult>{
    validateSearchRequest(input);this.preflight();
    const body={query:input.query,search_depth:'basic',auto_parameters:false,include_answer:false,include_raw_content:false,include_images:false,include_usage:true,max_results:input.maxResults,topic:'general',language:input.language.toLowerCase(),filter_by_language:false,...(input.domains.length?{include_domains:input.domains}:{}),...(input.timeRange?{time_range:input.timeRange}:{})};
    let response:unknown;
    try{response=await postJson({endpoint:this.endpoint,apiKeyEnv:this.keyEnv,timeoutMs:20000,maxResponseBytes:500000},body,signal);}
    catch(e){if(e instanceof ProviderError){const status=e.httpStatus??null;const code=status===432||status===433?'SEARCH_QUOTA':e.code.replace('PROVIDER_','SEARCH_');throw new SearchError(code,'Search failed; no automatic retry, depth escalation or billing change was made.',status);}throw e;}
    return parseSearchResponse(response,input);
  }
}
export function validateSearchRequest(v:unknown):asserts v is SearchRequest {
  exactObject(v,['query','language','domains','timeRange','maxResults']);if(!['zh-CN','en'].includes(v.language as string))throw new SearchError('SEARCH_INVALID','Unknown search language.');validateText(v.query);if(typeof v.query!=='string'||!v.query.trim()||v.query.length>400)throw new SearchError('SEARCH_INVALID','Query must contain 1–400 characters.');
  if(!Array.isArray(v.domains)||v.domains.length>20||v.domains.some(d=>typeof d!=='string'||!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(d)))throw new SearchError('SEARCH_INVALID','Invalid domain filters.');
  if(v.timeRange!==null&&!['day','week','month','year'].includes(v.timeRange as string))throw new SearchError('SEARCH_INVALID','Invalid time filter.');wfInteger(v.maxResults,1,5);
}
export function parseSearchResponse(v:unknown,input:SearchRequest):SearchResult {
  if(!isRecord(v)||!Array.isArray(v.results)||v.results.length>input.maxResults||typeof v.query!=='string'||v.query!==input.query)throw new SearchError('SEARCH_BAD_RESPONSE','Invalid search result envelope or query identity.');
  const results:SearchHit[]=[];const seen=new Set<string>();
  for(const r of v.results){if(!isRecord(r)||typeof r.url!=='string'||typeof r.title!=='string'||typeof r.content!=='string'||r.title.length>2000||r.content.length>40000)throw new SearchError('SEARCH_BAD_RESPONSE','Search result is missing bounded URL/title/content fields.');
    validateText(r.title);validateText(r.content);
    // Discovery may contain blocked URLs; retain bounded HTTP(S) URLs but filter before any fetch.
    let url:string;try{const u=new URL(r.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||r.url.length>4096||/[\x00-\x20\\]/.test(r.url))throw Error();u.hash='';url=u.href;}catch{throw new SearchError('SEARCH_BAD_RESPONSE','Search returned a malformed or credential-bearing URL.');}
    if(seen.has(url))continue;seen.add(url);const score=r.score===undefined||r.score===null?null:r.score;if(score!==null&&(typeof score!=='number'||!Number.isFinite(score)))throw new SearchError('SEARCH_BAD_RESPONSE','Invalid relevance score.');results.push({id:'hit_'+workflowHash([input.query,url]).slice(0,24),url,title:r.title,snippet:r.content,score:score as number|null});
  }
  let credits:number|null=null;if(v.usage!==undefined&&v.usage!==null){if(!isRecord(v.usage)||(v.usage.credits!==undefined&&(typeof v.usage.credits!=='number'||!Number.isFinite(v.usage.credits)||v.usage.credits<0)))throw new SearchError('SEARCH_BAD_RESPONSE','Invalid reported credit usage.');credits=typeof v.usage.credits==='number'?v.usage.credits:null;}
  if(v.request_id!==undefined&&(typeof v.request_id!=='string'||v.request_id.length>200))throw new SearchError('SEARCH_BAD_RESPONSE','Invalid request identifier.');
  return {query:input.query,results,credits,requestId:typeof v.request_id==='string'?v.request_id:null,provider:'tavily',discoveredAt:new Date().toISOString()};
}
/** Deterministic discovery selection: one result per host first, then remaining rank order. */
export function selectSearchHits(records:readonly SearchResult[],domains:readonly string[],limit:number){
  wfInteger(limit,0,30);const eligible:SearchHit[]=[],excluded:{id:string;reason:string}[]=[],seen=new Set<string>();
  for(const record of records)for(const hit of record.results){try{publicResultUrl(hit.url,domains);}catch{excluded.push({id:hit.id,reason:'blocked-url-or-domain'});continue;}if(seen.has(hit.url)){excluded.push({id:hit.id,reason:'duplicate-url'});continue;}seen.add(hit.url);eligible.push(hit);}
  const first:SearchHit[]=[],rest:SearchHit[]=[],hosts=new Set<string>();for(const h of eligible){const host=new URL(h.url).hostname;if(hosts.has(host))rest.push(h);else{hosts.add(host);first.push(h);}}
  const selected=[...first,...rest].slice(0,limit);for(const h of eligible)if(!selected.includes(h))excluded.push({id:h.id,reason:'page-attempt-budget'});
  return {selected,excluded,policy:'first-per-host-then-result-order; relevance-is-not-reliability'};
}
