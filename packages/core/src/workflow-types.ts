// SPDX-License-Identifier: Apache-2.0
import type { SourceContextItem, SourceSelection, Snapshot, MemoryOptions, MemoryCapture, MemoryPacket, IntentCard, AnalysisUsage, SourceQuote } from './index.js';
export type WorkflowTemplate = 'new-article' | 'revise-article' | 'review-changes';
export type WorkflowStage = 'research' | 'compose' | 'edit' | 'audit';
export type WorkflowState = 'ready' | 'running' | 'waiting-approval' | 'paused' | 'blocked' | 'failed' | 'completed' | 'cancelled';
export type WorkflowKind = 'model' | 'search' | 'fetch' | 'tool';
export interface WorkflowBudget { models:number; searches:number; fetches:number; activeMs:number }
export interface WorkflowModel {
  provider:'ollama'|'openai-compatible'; model:string; baseURL:string; apiKeyEnv:string|null;
  allowRemote:boolean; responseFormat:'json-schema'|'json'|'prompt'; tokenParameter:'max_completion_tokens'|'max_tokens';
  timeoutMs:number; maxOutputTokens:number;
}
export interface WorkflowConfig {
  template:WorkflowTemplate; title:string; goal:string; publicBrief:string; language:'zh-CN'|'en';
  research:'web'|'selected'; documentId:string|null; changeIds:string[];
  selection:SourceSelection; profileId:string|null; intent:IntentCard|null; memoryOptions:MemoryOptions;
  model:WorkflowModel; searchKeyEnv:string; domains:string[]; timeRange:'day'|'week'|'month'|'year'|null;
  autoRevision:boolean; budget:WorkflowBudget;
  /** Presence opts into extension/research v1; absent keeps historical v0.0.6 behavior. */
  extensions?: import('./extensions.js').WorkflowExtensions;
}
export interface WorkflowCapture {
  documentId:string|null; revisionId:string|null; snapshot:Snapshot|null;
  changes:{id:string;hash:string}[]; sources:SourceContextItem[];
  writing:MemoryPacket|null; review:MemoryPacket|null;
  writingCapture:MemoryCapture|null; reviewCapture:MemoryCapture|null;
  guidanceStamp:string; analysisStamp:string|null;
  extensions?: import('./extensions.js').CapturedExtensions;
}
export interface WorkflowRun {
  id:string; config:WorkflowConfig; capture:WorkflowCapture; fingerprint:string; epoch:number;
  state:WorkflowState; stage:WorkflowStage; outlineId:string|null; selectedOutlineId:string|null;
  candidateIds:string[]; reportIds:string[]; grantId:string|null; adoptedDocumentId:string|null;
  notice:string; createdAt:string; updatedAt:string;
}
export interface WorkflowGrant {
  id:string; runId:string; stage:WorkflowStage; fingerprint:string; outlineId:string|null;
  limits:WorkflowBudget; allowedTasks:string[]; summary:unknown; createdAt:string;
}
export interface WorkflowLease { runId:string; owner:string; generation:number }
export interface WorkflowAttempt {
  id:string;runId:string;grantId:string;key:string;kind:WorkflowKind;task:string;inputHash:string;
  status:'reserved'|'dispatched'|'completed'|'failed'|'outcome-unknown'|'retry-approved';
  request:unknown;artifactId:string|null;errorCode:string|null;usage:AnalysisUsage|{credits:number|null}|null;
  startedAt:number;finishedAt:number|null;generation:number;
}
export interface WorkflowArtifact {
  id:string;runId:string;key:string;type:string;inputHash:string;parentIds:string[];
  value:unknown;createdAt:string;origin:'model'|'host'|'author';epoch:number;
}
export interface SearchHit { id:string;url:string;title:string;snippet:string;score:number|null }
export interface SearchResult { query:string;results:SearchHit[];requestId:string|null;credits:number|null; provider:'tavily'; discoveredAt:string }
export interface SearchRequest { query:string;language:'zh-CN'|'en';domains:string[];timeRange:WorkflowConfig['timeRange'];maxResults:number }
export interface WorkflowQueryRequest { protocolVersion:1;task:'query-plan';runId:string;requestId:string;publicBrief:string;language:'zh-CN'|'en';maxQueries:number }
export type ContentTask = 'outline'|'draft'|'draft-review'|'draft-revision';
export interface WorkflowContentRequest {
  skills?: import('./extensions.js').LoadedSkill[];
  section?: {index:number;total:number;heading:string;approvedOutlineHash:string};
  protocolVersion:1;task:ContentTask;runId:string;requestId:string;goal:string;language:'zh-CN'|'en';
  guidance:MemoryPacket|null;sources:SourceContextItem[];gaps:string[];feedback:string;
  outline:OutlineOutput|null;draft:DraftOutput|null;review:DraftReviewOutput|null;
}
export type WorkflowRequest=WorkflowQueryRequest|WorkflowContentRequest;
export interface QueryOutput { protocolVersion:1;task:'query-plan';runId:string;requestId:string;queries:string[] }
export interface OutlineOutput {
  protocolVersion:1;task:'outline';runId:string;requestId:string;
  direction:string;summary:string;sections:{heading:string;points:string[];sourceQuotes:SourceQuote[]}[];
  gaps:string[];questions:string[];
}
export interface DraftOutput {
  protocolVersion:1;task:'draft'|'draft-revision';runId:string;requestId:string;
  title:string;markdown:string;citations:SourceQuote[];limitations:string[];
}
export interface DraftReviewOutput {
  protocolVersion:1;task:'draft-review';runId:string;requestId:string;
  issues:{start:number;end:number;quote:string;explanation:string;sourceQuotes:SourceQuote[]}[];
  needsRevision:boolean;notes:string[];
}
export type WorkflowOutput=QueryOutput|OutlineOutput|DraftOutput|DraftReviewOutput;
