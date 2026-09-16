// SPDX-License-Identifier: Apache-2.0
export type ProviderErrorCode =
  | 'PROVIDER_CONFIG' | 'PROVIDER_AUTH' | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_HTTP' | 'PROVIDER_NETWORK' | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_CANCELLED' | 'PROVIDER_REDIRECT' | 'PROVIDER_TOO_LARGE'
  | 'PROVIDER_BAD_RESPONSE' | 'PROVIDER_REFUSAL' | 'PROVIDER_TRUNCATED'
  | 'PROVIDER_INVALID_WORKFLOW' | 'PROVIDER_INVALID_MEMORY' | 'PROVIDER_INVALID_PROPOSAL' | 'PROVIDER_INVALID_ANALYSIS';
/** Only fixed, non-sensitive messages. Never attach a raw response, request, key or network cause. */
export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode, message: string, readonly httpStatus?: number) {
    super(message); this.name = 'ProviderError';
  }
}
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ProviderError('PROVIDER_CANCELLED', 'Model request cancelled; manuscript unchanged.');
}
