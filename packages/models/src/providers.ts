// SPDX-License-Identifier: Apache-2.0
import { isRecord, captureAnalysisRequest } from '@writer-agent/core';
import type { AnalysisRequest } from '@writer-agent/core';
import { analysisMessages, analysisSchema, parseAnalysis, completionUsage } from './analysis-protocol.js';
import type { AnalysisProvider, AnalysisResponse } from './analysis-protocol.js';
import type { ModelProvider, ModelRequest, ModelResponse, ProviderOptions, OpenAICompatibleOptions } from './types.js';
import { ProviderError, checkCancelled } from './errors.js';
import { MAX_WIRE_BYTES, captureRequest, proposalSchema, buildMessages, parseProposal } from './protocol.js';
import { postJson, resolveEndpoint } from './http.js';
import type { HttpSettings } from './http.js';

interface Settings extends HttpSettings { readonly model: string; readonly maxOutputTokens: number; readonly remote: boolean }
function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new ProviderError('PROVIDER_CONFIG','Invalid provider timeout, token or byte limit.');
  return value;
}
function configure(options: ProviderOptions, base: string, suffix: string, requireRemoteKey: boolean): Settings {
  if (!options || typeof options.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,127}$/.test(options.model)) throw new ProviderError('PROVIDER_CONFIG','A valid explicit model ID is required (1–128 ASCII model-name characters).');
  if (options.allowRemote !== undefined && typeof options.allowRemote !== 'boolean') throw new ProviderError('PROVIDER_CONFIG','allowRemote must be a boolean.');
  const endpoint = resolveEndpoint(options.baseURL ?? base,suffix,options.allowRemote);
  // A loopback Ollama proxy can still call the cloud; refuse visibly cloud-tagged models unless opted in.
  if (/(?:^|[:_-])cloud(?:$|[:_-])/i.test(options.model) && !options.allowRemote) throw new ProviderError('PROVIDER_CONFIG','Cloud-tagged models require explicit remote permission, even through a local server.');
  const env = options.apiKeyEnv ?? (endpoint.remote && requireRemoteKey ? 'WRITER_AGENT_API_KEY' : undefined);
  if (env !== undefined && (typeof env !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(env))) throw new ProviderError('PROVIDER_CONFIG','apiKeyEnv must be an environment-variable name, not a key.');
  return Object.freeze({ ...endpoint, apiKeyEnv:env, model:options.model,
    timeoutMs:integer(options.timeoutMs,120000,10,600000), maxOutputTokens:integer(options.maxOutputTokens,4096,128,32768),
    maxResponseBytes:integer(options.maxResponseBytes,MAX_WIRE_BYTES,128,MAX_WIRE_BYTES) });
}
function messageContent(message: unknown): string {
  if (!isRecord(message) || message.role !== 'assistant') throw new ProviderError('PROVIDER_BAD_RESPONSE','Missing assistant response.');
  if (message.refusal !== undefined && message.refusal !== null && message.refusal !== '') throw new ProviderError('PROVIDER_REFUSAL','Model declined the request; no proposal was saved.');
  if (message.function_call !== undefined && message.function_call !== null) throw new ProviderError('PROVIDER_BAD_RESPONSE','Function calls are not accepted by this writing provider.');
  if (message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) || message.tool_calls.length !== 0)) throw new ProviderError('PROVIDER_BAD_RESPONSE','Tool calls are not accepted or executed by this writing provider.');
  if (typeof message.content !== 'string' || !message.content.trim()) throw new ProviderError('PROVIDER_BAD_RESPONSE','Model returned no text proposal.');
  return message.content;
}
/** OpenAI Chat Completions compatibility, not the Responses API or every provider/model. */
export class OpenAICompatibleProvider implements ModelProvider, AnalysisProvider {
  readonly id: string;
  readonly #settings: Settings;
  readonly #format: 'json-schema' | 'json' | 'prompt';
  readonly #tokenParameter: 'max_completion_tokens' | 'max_tokens';
  constructor(options: OpenAICompatibleOptions) {
    this.#settings = configure(options,'https://api.openai.com/v1','/chat/completions',true);
    this.#format = options.responseFormat ?? 'json-schema';
    this.#tokenParameter = options.tokenParameter ?? 'max_completion_tokens';
    if (!['json-schema','json','prompt'].includes(this.#format) || !['max_completion_tokens','max_tokens'].includes(this.#tokenParameter)) throw new ProviderError('PROVIDER_CONFIG','Unknown response-format or token-parameter option.');
    this.id = `openai-compatible/${this.#settings.model}`;
  }
  async extractClaims(input:AnalysisRequest,signal?:AbortSignal):Promise<AnalysisResponse> { return this.analysis(input,'claim-extraction',signal); }
  async reviewChanges(input:AnalysisRequest,signal?:AbortSignal):Promise<AnalysisResponse> { return this.analysis(input,'semantic-review',signal); }
  private async analysis(input:AnalysisRequest,task:AnalysisRequest['task'],signal?:AbortSignal):Promise<AnalysisResponse> {
    checkCancelled(signal);
    const request=captureAnalysisRequest(input);
    if(request.task!==task)throw new ProviderError('PROVIDER_INVALID_ANALYSIS','Analysis task mismatch.');
    const completion=await this.complete(analysisMessages(request),analysisSchema(task),task==='claim-extraction'?'siglum_claims_v1':'siglum_review_v1',signal);
    checkCancelled(signal);return parseAnalysis(completion.text,request,this.id,completion.usage);
  }
  describe() { return { provider:'openai-compatible', ...this.#settings, responseFormat:this.#format, tokenParameter:this.#tokenParameter }; }
  async propose(input: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
    checkCancelled(signal);
    const request = captureRequest(input);
    const completion = await this.complete(buildMessages(request),proposalSchema(),'writer_proposal_v1',signal);
    return parseProposal(completion.text,request,this.id);
  }
  private async complete(messages: {role:'system'|'user';content:string}[], schema:Record<string,unknown>, schemaName:string, signal?:AbortSignal) {
    checkCancelled(signal);
    const body: Record<string,unknown> = { model:this.#settings.model, messages, stream:false,
      [this.#tokenParameter]:this.#settings.maxOutputTokens };
    if (this.#format === 'json-schema') body.response_format = { type:'json_schema', json_schema:{ name:schemaName,strict:true,schema } };
    else if (this.#format === 'json') body.response_format = { type:'json_object' };
    const envelope = await postJson(this.#settings,body,signal);
    if (!isRecord(envelope) || !Array.isArray(envelope.choices) || envelope.choices.length !== 1 || !isRecord(envelope.choices[0])) throw new ProviderError('PROVIDER_BAD_RESPONSE','Expected exactly one completed chat choice.');
    const choice = envelope.choices[0];
    if (choice.finish_reason === 'length') throw new ProviderError('PROVIDER_TRUNCATED','Model reached its output limit. No partial proposal was saved.');
    if (choice.finish_reason === 'content_filter') throw new ProviderError('PROVIDER_REFUSAL','Provider filtered the response; no proposal was saved.');
    const content = messageContent(choice.message);
    if (choice.finish_reason !== 'stop') throw new ProviderError('PROVIDER_BAD_RESPONSE','Model response did not finish normally.');
    checkCancelled(signal);
    return {text:content,usage:completionUsage(envelope)};
  }
}
/** Native /api/chat, non-streaming and schema-constrained. Server/model must be installed separately. */
export class OllamaProvider implements ModelProvider, AnalysisProvider {
  readonly id: string;
  readonly #settings: Settings;
  constructor(options: ProviderOptions) {
    this.#settings = configure(options,'http://127.0.0.1:11434','/api/chat',false);
    this.id = `ollama/${this.#settings.model}`;
  }
  async extractClaims(input:AnalysisRequest,signal?:AbortSignal):Promise<AnalysisResponse> { return this.analysis(input,'claim-extraction',signal); }
  async reviewChanges(input:AnalysisRequest,signal?:AbortSignal):Promise<AnalysisResponse> { return this.analysis(input,'semantic-review',signal); }
  private async analysis(input:AnalysisRequest,task:AnalysisRequest['task'],signal?:AbortSignal):Promise<AnalysisResponse> {
    checkCancelled(signal);
    const request=captureAnalysisRequest(input);
    if(request.task!==task)throw new ProviderError('PROVIDER_INVALID_ANALYSIS','Analysis task mismatch.');
    const completion=await this.complete(analysisMessages(request),analysisSchema(task),signal);
    checkCancelled(signal);return parseAnalysis(completion.text,request,this.id,completion.usage);
  }
  describe() { return { provider:'ollama', ...this.#settings, responseFormat:'json-schema' }; }
  async propose(input: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
    checkCancelled(signal);
    const request = captureRequest(input);
    const completion=await this.complete(buildMessages(request),proposalSchema(),signal);
    return parseProposal(completion.text,request,this.id);
  }
  private async complete(messages:{role:'system'|'user';content:string}[],schema:Record<string,unknown>,signal?:AbortSignal) {
    checkCancelled(signal);
    const envelope = await postJson(this.#settings,{ model:this.#settings.model, messages,
      stream:false, format:schema, options:{num_predict:this.#settings.maxOutputTokens} },signal);
    if (!isRecord(envelope) || envelope.done !== true) throw new ProviderError('PROVIDER_BAD_RESPONSE','Expected a completed, non-streaming Ollama response.');
    if (envelope.done_reason === 'length') throw new ProviderError('PROVIDER_TRUNCATED','Ollama reached its output limit. No partial proposal was saved.');
    if (envelope.done_reason !== undefined && envelope.done_reason !== 'stop') throw new ProviderError('PROVIDER_BAD_RESPONSE','Ollama response did not finish normally.');
    const content = messageContent(envelope.message);
    checkCancelled(signal);
    return {text:content,usage:completionUsage(envelope,true)};
  }
}
