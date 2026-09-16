// SPDX-License-Identifier: Apache-2.0
import { ProviderError, checkCancelled } from './errors.js';
import { MAX_WIRE_BYTES } from './protocol.js';

export interface HttpSettings {
  readonly credential?: (endpoint:string)=>Promise<string|undefined>;
  readonly endpoint: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly apiKeyEnv: string | undefined;
}
/** Never returns or stores URLs with userinfo, query strings, fragments or cleartext remote hosts. */
export function resolveEndpoint(base: string, suffix: string, allowRemote = false): { endpoint: string; remote: boolean } {
  try {
    if (typeof base !== 'string' || base.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(base)) throw new Error('url');
    const url = new URL(base);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.port === '0') throw new Error('url');
    // Pin localhost to a literal loopback address instead of trusting DNS configuration.
    if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    const local = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (!local && (!allowRemote || url.protocol !== 'https:')) throw new Error('remote');
    const path = url.pathname.replace(/\/+$/,'');
    if (path.endsWith(suffix)) throw new Error('endpoint rather than base');
    url.pathname = path + suffix;
    return { endpoint: url.href, remote: !local };
  } catch { throw new ProviderError('PROVIDER_CONFIG','Invalid API base URL. Use a loopback URL, or HTTPS with explicit remote permission; no credentials, query or fragment. Supply the API base, not the full chat endpoint.'); }
}
function apiKey(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const value = process.env[name];
  if (!value || value.length > 8192 || !/^[\x21-\x7e]+$/.test(value)) {
    throw new ProviderError('PROVIDER_AUTH','API key is missing or invalid in the configured environment variable. Do not paste keys into commands, files or chat.');
  }
  return value;
}
function httpError(status: number): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('PROVIDER_AUTH','Provider rejected authentication or access. Check credentials and model permissions.',status);
  if (status === 429) return new ProviderError('PROVIDER_RATE_LIMIT','Provider rate or quota limit reached. No automatic retry was made.',status);
  return new ProviderError('PROVIDER_HTTP','Provider returned an HTTP error. Check endpoint, model and selected response/token compatibility options. No automatic fallback was made.',status);
}
/** Single non-streaming JSON exchange. The deadline covers headers AND body consumption. */
export async function postJson(settings: HttpSettings, body: unknown, signal?: AbortSignal): Promise<unknown> {
  checkCancelled(signal);
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized,'utf8') > MAX_WIRE_BYTES) throw new ProviderError('PROVIDER_TOO_LARGE','Encoded model request exceeds 8 MiB. Use a smaller document.');
  const key = settings.credential ? await settings.credential(settings.endpoint) : apiKey(settings.apiKeyEnv);
  if(key!==undefined&&(!key||key.length>8192||!/[\x21-\x7e]/.test(key)||/[^\x21-\x7e]/.test(key)))throw new ProviderError('PROVIDER_AUTH','Invalid host credential.');
  checkCancelled(signal);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  const timer = setTimeout(() => { timedOut = true; controller.abort(); },settings.timeoutMs);
  let response: Response | undefined;
  try {
    checkCancelled(signal);
    const headers: Record<string,string> = { 'Content-Type':'application/json', Accept:'application/json' };
    if (key !== undefined) headers.Authorization = `Bearer ${key}`;
    response = await fetch(settings.endpoint, { method:'POST', headers, body:serialized,
      redirect:'manual', signal:controller.signal });
    if (response.status >= 300 && response.status < 400) throw new ProviderError('PROVIDER_REDIRECT','Provider redirect refused. Configure the intended final API base explicitly.');
    if (!response.ok) throw httpError(response.status);
    const mime = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (mime !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(mime ?? '')) throw new ProviderError('PROVIDER_BAD_RESPONSE','Provider did not return application/json.');
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > settings.maxResponseBytes) throw new ProviderError('PROVIDER_TOO_LARGE','Provider response exceeds the configured byte limit.');
    if (!response.body) throw new ProviderError('PROVIDER_BAD_RESPONSE','Provider returned an empty body.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > settings.maxResponseBytes) throw new ProviderError('PROVIDER_TOO_LARGE','Provider response exceeds the configured byte limit.');
        chunks.push(part.value);
      }
    } finally {
      // Aborting/cancelling closes an incomplete body; never keep a stuck stream alive.
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    checkCancelled(signal);
    if (timedOut) throw new ProviderError('PROVIDER_TIMEOUT','Model request timed out; no proposal was saved.');
    try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size))) as unknown; }
    catch { throw new ProviderError('PROVIDER_BAD_RESPONSE','Provider response is not valid UTF-8 JSON.'); }
  } catch (error) {
    if (signal?.aborted) throw new ProviderError('PROVIDER_CANCELLED','Model request cancelled; no proposal was saved.');
    if (timedOut) throw new ProviderError('PROVIDER_TIMEOUT','Model request timed out; no proposal was saved.');
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('PROVIDER_NETWORK','Provider connection failed or ended early. Check the service and network.');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort',abort);
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined);
    controller.abort();
  }
}
