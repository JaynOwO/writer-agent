// SPDX-License-Identifier: Apache-2.0
import type { Snapshot, ProposedEdit, SourceContextItem, MemoryPacket } from '@writer-agent/core';
export interface ModelRequest {
  readonly documentId: string;
  readonly baseRevisionId: string;
  readonly snapshot: Snapshot;
  /** Explicit immutable source selections, all untrusted evidence text. */
  readonly sources?: readonly SourceContextItem[];
  readonly guidance?: MemoryPacket;
  readonly instruction: string;
}
/** Wire fields plus a provider ID supplied by trusted local configuration, NOT by the model. */
export interface ModelResponse {
  readonly protocolVersion: 1;
  readonly providerId: string;
  readonly documentId: string;
  readonly baseRevisionId: string;
  readonly edits: readonly ProposedEdit[];
  /** Untrusted opinions. Not verified evidence or persistent writing preferences. */
  readonly notes: readonly string[];
}
export interface ModelProvider {
  readonly id: string;
  propose(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}
export interface ProviderOptions {
  /** Host-only freshness guard, called before and after inference; never serialized. */
  readonly assertCurrent?:()=>void;
  /** Trusted host resolver; not serialized, returned by describe(), or supplied to the model. */
  readonly credential?: (endpoint:string)=>Promise<string|undefined>;
  /** Optional environment-variable NAME. Never put an API key in this object. */
  readonly apiKeyEnv?: string;
  readonly model: string;
  /** API base, not the full chat endpoint. Must not contain credentials/query/fragment. */
  readonly baseURL?: string;
  /** Required for any non-loopback endpoint, including remote Ollama. HTTPS required. */
  readonly allowRemote?: boolean;
  readonly timeoutMs?: number;
  readonly maxOutputTokens?: number;
  /** Overrides only reduce the hard 8 MiB HTTP response limit. */
  readonly maxResponseBytes?: number;
}
export interface OpenAICompatibleOptions extends ProviderOptions {
  /** Default json-schema. No automatic fallback/retry to a different mode. */
  readonly responseFormat?: 'json-schema' | 'json' | 'prompt';
  /** Explicit compatibility switch for older Chat Completions implementations. */
  readonly tokenParameter?: 'max_completion_tokens' | 'max_tokens';
}
