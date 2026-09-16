// SPDX-License-Identifier: Apache-2.0
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { isRecord, hashBytes, validateMcpConnection, inspectToolSchema, validateToolArguments, toolHeaders, headerValue, extText, boundedExtension } from '@writer-agent/core';
import type { McpConnection, McpCatalog, McpTool, McpResource, ApprovedMcpCall } from '@writer-agent/core';
import { parseAnalysisJson } from '@writer-agent/models';

const MAX_MESSAGE = 2_000_000;
export class McpError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'McpError'; }
}
function err(code: string, message: string): never { throw new McpError(code, message); }
const CLIENT = { name: 'Siglum', version: '0.0.7' };
export interface McpTextResult { text: string; raw: unknown; interpretation: 'external-service-unverified' }
/** No process is launched during registration/preflight. Hashes detect changes, not hostile behavior. */
export async function mcpLaunchHash(config: McpConnection): Promise<string> {
  validateMcpConnection(config);
  const items: { path: string; hash: string }[] = [];
  if (config.transport === 'stdio') {
    const stat = lstatSync(config.cwd); if (!stat.isDirectory() || stat.isSymbolicLink()) err('MCP_CONFIG', 'Working directory must be an ordinary directory.');
    const paths = [...new Set([config.command, ...config.args.filter(a=>a&&!a.startsWith('-')).map(a=>isAbsolute(a)?a:resolve(config.cwd,a)).filter(a => { try { return lstatSync(a).isFile(); } catch { return false; } })])];
    for (const p of paths) {
      const st = lstatSync(p); if (!st.isFile() || st.isSymbolicLink() || st.size > 300_000_000) err('MCP_CONFIG', 'Executable/script must be an existing ordinary bounded file.');
      const h = createHash('sha256'); for await (const b of createReadStream(p)) h.update(b);
      items.push({ path: realpathSync(p), hash: h.digest('hex') });
    }
  }
  return hashBytes(JSON.stringify({ config, items }));
}
function safeJson(text: string): Record<string, unknown> {
  try { const v = parseAnalysisJson(text); if (!isRecord(v)) throw Error(); return v; }
  catch { return err('MCP_INVALID_RESPONSE', 'Malformed, duplicate-key, oversized or non-object MCP JSON.'); }
}
function responseResult(message: Record<string, unknown>, id: number, modern: boolean): Record<string, unknown> | null {
  if (message.jsonrpc !== '2.0') err('MCP_INVALID_RESPONSE', 'Wrong JSON-RPC version.');
  if (typeof message.method === 'string') {
    if (Object.hasOwn(message, 'id')) err('MCP_INTERACTION_UNSUPPORTED', 'Server-initiated requests are not supported; no callback was executed.');
    // Notifications are data, not instructions; no hidden roots/sampling/elicitation.
    return null;
  }
  if (Object.hasOwn(message, 'error')) {
    if (Object.hasOwn(message, 'result') || (message.id !== id && message.id !== null && message.id !== undefined) || !isRecord(message.error) || !Number.isInteger(message.error.code)) err('MCP_INVALID_RESPONSE', 'Invalid JSON-RPC error envelope.');
    const code = message.error.code;
    return err(code === -32022 ? 'MCP_PROTOCOL_UNSUPPORTED' : code === -32021 ? 'MCP_INTERACTION_UNSUPPORTED' : 'MCP_REMOTE_ERROR', `MCP error code ${code}; remote body omitted. No automatic retry.`);
  }
  if (message.id !== id || !isRecord(message.result)) err('MCP_INVALID_RESPONSE', 'MCP response identity/result mismatch.');
  const result = message.result;
  if (modern && result.resultType !== 'complete') err(result.resultType === 'input_required' ? 'MCP_INTERACTION_UNSUPPORTED' : 'MCP_PROTOCOL_UNSUPPORTED', 'Unsupported MCP result type; no additional interaction was executed.');
  if (!modern && result.resultType !== undefined && result.resultType !== 'complete') err('MCP_INTERACTION_UNSUPPORTED', 'MCP result requires an unsupported interaction.');
  return result;
}
function implementation(value: unknown) { if (!isRecord(value) || typeof value.name !== 'string' || typeof value.version !== 'string') err('MCP_INVALID_RESPONSE', 'Missing server implementation metadata.'); }
function catalogHash(tools: McpTool[], resources: McpResource[]): string { return hashBytes(JSON.stringify({ tools: tools.map(t => t.hash), resources: resources.map(r => r.hash) })); }
function decodeTool(value: unknown): McpTool {
  if (!isRecord(value)) err('MCP_INVALID_RESPONSE', 'Invalid tool descriptor.');
  extText(value.name, 200); extText(value.description ?? '', 10000, true);
  if (!isRecord(value.inputSchema) || value.inputSchema.type !== 'object') err('MCP_SCHEMA_UNSUPPORTED', 'Tool input schema must be an object.');
  inspectToolSchema(value.inputSchema); toolHeaders(value.inputSchema, {});
  if (value.outputSchema !== undefined) { if (!isRecord(value.outputSchema)) err('MCP_SCHEMA_UNSUPPORTED', 'Invalid output schema.'); inspectToolSchema(value.outputSchema); }
  if (value.annotations !== undefined && !isRecord(value.annotations)) err('MCP_INVALID_RESPONSE', 'Invalid tool annotations.');
  const descriptor = { name: value.name, description: String(value.description ?? ''), inputSchema: value.inputSchema, outputSchema: value.outputSchema as Record<string, unknown> ?? null, annotations: value.annotations as Record<string, unknown> ?? {} };
  boundedExtension(descriptor, 64000);
  return { ...descriptor, hash: hashBytes(JSON.stringify(descriptor)) };
}
function decodeResource(value: unknown): McpResource {
  if (!isRecord(value)) err('MCP_INVALID_RESPONSE', 'Invalid resource descriptor.');
  extText(value.uri, 2048); extText(value.name, 200); extText(value.description ?? '', 10000, true);
  if (value.mimeType !== undefined) extText(value.mimeType, 200);
  const d = { uri: value.uri, name: value.name, description: String(value.description ?? ''), mimeType: value.mimeType as string ?? null };
  return { ...d, hash: hashBytes(JSON.stringify(d)) };
}

/** Bounded tools/resources MCP client. No automatic version fallback, OAuth, sampling or subscriptions. */
export class McpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1; private initialized = false; private closed = false; private session: string | null = null;
  private pending: { id: number; resolve: (value: Record<string, unknown>) => void; reject: (e: Error) => void; bytes: number; notifications: number } | null = null;
  private stdout = Buffer.alloc(0); private stderrBytes = 0; private transportError: Error | null = null;
  private capabilities: Record<string, unknown> = {};
  private idleNotifications=0;
  readonly config:McpConnection;
  constructor(config: McpConnection, private readonly expectedLaunchHash: string) { validateMcpConnection(config);this.config=structuredClone(config); }
  private modern() { return this.config.protocol === '2026-07-28'; }
  private failure(e: Error) { this.transportError = e; const p = this.pending; this.pending = null; p?.reject(e); }
  async connect(signal?: AbortSignal): Promise<void> {
    if (this.closed) err('MCP_CLOSED', 'MCP connection already closed.');
    if (signal?.aborted) err('MCP_CANCELLED', 'MCP connection cancelled before launch.');
    if (this.initialized) return;
    if (await mcpLaunchHash(this.config) !== this.expectedLaunchHash) err('MCP_CHANGED', 'Connection/executable changed since author trust approval.');
    if(signal?.aborted)err('MCP_CANCELLED','Connection cancelled before process launch.');
    if (this.config.transport === 'stdio') this.launch(this.config);
    try {
      const result = this.modern() ? await this.rpc('server/discover', {}, signal) : await this.rpc('initialize', { protocolVersion: this.config.protocol, clientInfo: CLIENT, capabilities: {} }, signal);
      if (this.modern()) { if (!Array.isArray(result.supportedVersions) || !result.supportedVersions.includes(this.config.protocol)) err('MCP_PROTOCOL_UNSUPPORTED', 'Server does not advertise the configured protocol.'); }
      else if (result.protocolVersion !== this.config.protocol) err('MCP_PROTOCOL_UNSUPPORTED', 'Negotiated protocol differs from the explicit configuration.');
      if (this.modern()) {
        if (!Number.isSafeInteger(result.ttlMs) || Number(result.ttlMs) < 0 || !['public','private'].includes(String(result.cacheScope))) err('MCP_INVALID_RESPONSE', 'Invalid discovery cache hints.');
        const info = isRecord(result._meta) ? result._meta['io.modelcontextprotocol/serverInfo'] : undefined;
        if (info !== undefined) implementation(info);
      } else implementation(result.serverInfo);
      if (!isRecord(result.capabilities)) err('MCP_INVALID_RESPONSE', 'Missing server capabilities.'); this.capabilities = result.capabilities;
      if (!this.modern()) await this.notify('notifications/initialized', {});
      this.initialized = true;
    } catch (e) { await this.close(); throw e; }
  }
  private launch(config: Extract<McpConnection, { transport: 'stdio' }>): void {
    const env: Record<string, string> = {};
    // Only portable runtime necessities and explicitly approved environment NAMES are inherited.
    const names = new Set(['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','ComSpec','TEMP','TMP','HOME','USERPROFILE','LANG',...config.env]);
    for (const n of names) if (process.env[n] !== undefined) env[n] = process.env[n]!;
    this.child = spawn(config.command, config.args, { cwd: config.cwd, env, shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    this.child.stdin.on('error', () => this.failure(new McpError('MCP_NETWORK', 'MCP input pipe closed.')));
    this.child.on('error', () => this.failure(new McpError('MCP_NETWORK', 'Failed to start configured MCP process.')));
    this.child.on('exit', () => { if (!this.closed) this.failure(new McpError('MCP_NETWORK', 'MCP process exited; no automatic restart/retry.')); });
    this.child.stderr.on('data', (chunk: Buffer) => { this.stderrBytes += chunk.length; if (this.stderrBytes > 256000) { this.failure(new McpError('MCP_LIMIT', 'MCP stderr limit reached; logs were not displayed.')); this.child?.kill(); } });
    this.child.stdout.on('data', (chunk: Buffer) => {
      if (this.closed || this.transportError) return;
      try {
        if (this.pending) { this.pending.bytes += chunk.length; if (this.pending.bytes > MAX_MESSAGE) err('MCP_LIMIT', 'MCP output exceeds byte limit.'); }
        this.stdout = Buffer.concat([this.stdout, chunk]); if (this.stdout.length > MAX_MESSAGE) err('MCP_LIMIT', 'Unterminated MCP frame exceeds limit.');
        let nl: number;
        while ((nl = this.stdout.indexOf(10)) >= 0) {
          const line = this.stdout.subarray(0, nl); this.stdout = this.stdout.subarray(nl + 1);
          if (!line.length) continue;
          const message = safeJson(new TextDecoder('utf-8', { fatal: true }).decode(line));
          if (!this.pending) { if(++this.idleNotifications>100)err('MCP_LIMIT','Too many unsolicited notifications.'); if (message.jsonrpc !== '2.0' || Object.hasOwn(message, 'id') || typeof message.method !== 'string') err('MCP_INVALID_RESPONSE', 'Unexpected response without an outstanding request.'); continue; }
          const result = responseResult(message, this.pending.id, this.modern());
          if (!result) { if (++this.pending.notifications > 100) err('MCP_LIMIT', 'Too many request notifications.'); continue; }
          const p = this.pending; this.pending = null; p.resolve(result);
        }
      } catch (e) { this.failure(e instanceof McpError ? e : new McpError('MCP_INVALID_RESPONSE', 'Invalid MCP stream.')); }
    });
  }
  private packet(method: string, params: Record<string, unknown>, id?: number) {
    const meta = this.modern() ? { _meta: { 'io.modelcontextprotocol/protocolVersion': this.config.protocol, 'io.modelcontextprotocol/clientInfo': CLIENT, 'io.modelcontextprotocol/clientCapabilities': {} } } : {};
    return { jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params: { ...params, ...meta } };
  }
  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    const body = JSON.stringify(this.packet(method, params));
    if (this.config.transport === 'stdio') { this.child?.stdin.write(body + '\n'); return; }
    const c = this.config; const response = await fetch(c.url, { method: 'POST', body, headers: this.headers(method, params), redirect: 'error', signal: AbortSignal.timeout(c.timeoutMs) });
    if (response.status !== 202) { await response.body?.cancel(); err('MCP_INVALID_RESPONSE', 'Server did not acknowledge MCP notification.'); }
    await response.body?.cancel();
  }
  private headers(method: string, params: Record<string, unknown>, schema?: Record<string, unknown>): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': this.config.protocol };
    if (this.modern()) { h['Mcp-Method'] = method; const n = params.name ?? params.uri; if (typeof n === 'string') h['Mcp-Name'] = headerValue(n); if (schema && isRecord(params.arguments)) Object.assign(h, toolHeaders(schema, params.arguments)); }
    else if (this.session) h['Mcp-Session-Id'] = this.session;
    if (this.config.transport === 'http' && this.config.tokenEnv) { const token = process.env[this.config.tokenEnv]; if (!token || token.length > 8192 || !/^[\x21-\x7e]+$/.test(token)) err('MCP_AUTH', 'Missing/invalid token in configured environment variable.'); h.Authorization = `Bearer ${token}`; }
    return h;
  }
  private async rpc(method: string, params: Record<string, unknown>, signal?: AbortSignal, schema?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.closed || this.transportError) throw this.transportError ?? new McpError('MCP_CLOSED', 'Connection closed.');
    if (signal?.aborted) err('MCP_CANCELLED', 'MCP request cancelled.');
    const id = this.nextId++; const body = JSON.stringify(this.packet(method, params, id)); if (Buffer.byteLength(body) > 128000) err('MCP_LIMIT', 'MCP request exceeds byte bound.');
    const ctrl = new AbortController(); const abort = () => ctrl.abort(); signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.config.timeoutMs);
    try {
      if (this.config.transport === 'stdio') {
        if (this.pending) err('MCP_BUSY', 'One in-flight request per connection.');
        return await new Promise<Record<string, unknown>>((resolve, reject) => {
          const cancel = () => { const active = this.pending; this.pending = null; if (active) { this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } }) + '\n'); reject(new McpError(signal?.aborted ? 'MCP_CANCELLED' : 'MCP_TIMEOUT', 'MCP outcome may be unknown; no automatic retry.')); } };
          ctrl.signal.addEventListener('abort', cancel, { once: true });
          this.pending = { id, bytes: 0, notifications: 0, resolve: v => { ctrl.signal.removeEventListener('abort', cancel); resolve(v); }, reject: e => { ctrl.signal.removeEventListener('abort', cancel); reject(e); } };
          this.child!.stdin.write(body + '\n');
        });
      }
      const response = await fetch(this.config.url, { method: 'POST', body, headers: this.headers(method, params, schema), signal: ctrl.signal, redirect: 'error' });
      if (response.status === 401 || response.status === 403) { await response.body?.cancel(); err('MCP_AUTH', 'Server authentication/authorization failed. OAuth is not implemented; no browser flow started.'); }
      if (!response.ok) { await response.body?.cancel(); err(response.status === 429 ? 'MCP_RATE_LIMIT' : 'MCP_HTTP_ERROR', `MCP HTTP ${response.status}; remote body omitted.`); }
      if (!this.modern() && method === 'initialize') { const session = response.headers.get('mcp-session-id'); if (session && (!/^[\x21-\x7e]{1,512}$/.test(session))) err('MCP_INVALID_RESPONSE', 'Invalid session header.'); this.session = session; }
      const mime = response.headers.get('content-type')?.split(';')[0]?.trim();
      if (!['application/json','text/event-stream'].includes(mime ?? '')) { await response.body?.cancel(); err('MCP_INVALID_RESPONSE', 'Expected JSON or SSE MCP response.'); }
      if (!response.body) err('MCP_INVALID_RESPONSE', 'Empty MCP response.');
      const reader = response.body!.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }); let total = 0, buffer = '', notifications = 0;
      try {
        while (true) {
          const read = await reader.read(); if (read.done) break; total += read.value.length; if (total > MAX_MESSAGE) err('MCP_LIMIT', 'MCP response exceeds byte limit.'); buffer += decoder.decode(read.value, { stream: true });
          if (mime === 'text/event-stream') {
            // Normalize complete CRLF sequences without splitting a CRLF arriving in two chunks.
            buffer = buffer.replace(/\r\n/g, '\n'); let boundary: number;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
              if (!data) continue; const result = responseResult(safeJson(data), id, this.modern()); if (result) return result; if (++notifications > 100) err('MCP_LIMIT', 'Too many notifications.');
            }
          }
        }
        buffer += decoder.decode();
        if (mime !== 'application/json') err('MCP_NETWORK', 'SSE ended without a final response.');
        const result = responseResult(safeJson(buffer), id, this.modern()); if (!result) err('MCP_INVALID_RESPONSE', 'Expected final MCP result.'); return result!;
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    } catch (e) {
      if (e instanceof McpError) throw e;
      if (ctrl.signal.aborted) err(signal?.aborted ? 'MCP_CANCELLED' : 'MCP_TIMEOUT', 'MCP request stopped; remote outcome may be unknown.');
      return err('MCP_NETWORK', 'MCP transport failed; remote outcome may be unknown. Details omitted to protect credentials.');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  private async list(method: 'tools/list' | 'resources/list', field: 'tools' | 'resources', signal?: AbortSignal): Promise<unknown[]> {
    const values: unknown[] = [], seen = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await this.rpc(method, cursor ? { cursor } : {}, signal); if (!Array.isArray(result[field])) err('MCP_INVALID_RESPONSE', 'Invalid MCP list response.');
      values.push(...result[field] as unknown[]); if (values.length > 100) err('MCP_LIMIT', 'MCP catalogue has more than 100 entries.');
      if (result.nextCursor === undefined) return values;
      if (typeof result.nextCursor !== 'string' || !result.nextCursor || result.nextCursor.length > 2048 || seen.has(result.nextCursor)) err('MCP_INVALID_RESPONSE', 'Invalid or repeating pagination cursor.');
      cursor = result.nextCursor; seen.add(cursor);
    }
    return err('MCP_LIMIT', 'MCP catalogue page limit reached; not treated as complete.');
  }
  async discover(signal?: AbortSignal): Promise<McpCatalog> {
    await this.connect(signal); const tools: McpTool[] = [], resources: McpResource[] = [], excluded: { name: string; reason: string }[] = [];
    const names = new Set<string>(), uris = new Set<string>();
    if (this.capabilities.tools) for (const value of await this.list('tools/list', 'tools', signal)) {
      const name = isRecord(value) && typeof value.name === 'string' ? value.name : '(invalid name)'; if (names.has(name)) err('MCP_INVALID_RESPONSE', 'Duplicate tool names in catalogue.'); names.add(name);
      try { tools.push(decodeTool(value)); } catch { excluded.push({ name: name.slice(0, 200), reason: 'Unsupported or invalid tool schema/descriptor; excluded, not allowed.' }); }
    }
    if (this.capabilities.resources) for (const value of await this.list('resources/list', 'resources', signal)) { const r = decodeResource(value); if (uris.has(r.uri)) err('MCP_INVALID_RESPONSE', 'Duplicate resource URIs.'); uris.add(r.uri); resources.push(r); }
    tools.sort((a,b)=>a.name<b.name?-1:1); resources.sort((a,b)=>a.uri<b.uri?-1:1);
    return { version: 'mcp-catalog-v1', tools, resources, excluded, hash: catalogHash(tools, resources) };
  }
  async execute(call: ApprovedMcpCall, signal?: AbortSignal, observeCatalog?: (catalog:McpCatalog)=>void): Promise<McpTextResult> {
    call=structuredClone(call);
    if (hashBytes(JSON.stringify(call.config)) !== hashBytes(JSON.stringify(this.config)) || call.serverHash !== this.expectedLaunchHash) err('MCP_CHANGED', 'Call destination differs from captured approval.');
    const catalog = await this.discover(signal); observeCatalog?.(catalog); const descriptor = call.kind === 'tool' ? catalog.tools.find(t=>t.name===call.name) : catalog.resources.find(r=>r.uri===call.name);
    if (!descriptor || descriptor.hash !== call.descriptor.hash) err('MCP_CHANGED', 'Tool/resource descriptor changed. Inspect and reauthorize; no tool was called.');
    let result: Record<string, unknown>;
    if (call.kind === 'tool') {
      const tool = descriptor as McpTool; validateToolArguments(tool.inputSchema, call.arguments);
      result = await this.rpc('tools/call', { name: call.name, arguments: call.arguments }, signal, tool.inputSchema);
      if (result.isError === true) err('MCP_TOOL_ERROR', 'MCP tool reported an error; output not imported as evidence.');
      if (result.isError !== undefined && typeof result.isError !== 'boolean') err('MCP_INVALID_RESPONSE', 'Invalid tool error flag.');
      if (tool.outputSchema) { if (!isRecord(result.structuredContent)) err('MCP_INVALID_RESPONSE', 'Tool omitted schema-declared structured output.'); validateToolArguments(tool.outputSchema, result.structuredContent); }
      if (!Array.isArray(result.content) || result.content.length > 32) err('MCP_INVALID_RESPONSE', 'Invalid tool content.');
      const texts = (result.content as unknown[]).map(c => { if (!isRecord(c) || c.type !== 'text' || typeof c.text !== 'string') return err('MCP_CONTENT_UNSUPPORTED', 'Only text tool content is supported; binary/link results were not followed.'); return c.text; });
      const text = texts.length ? texts.join('\n\n') : isRecord(result.structuredContent) ? JSON.stringify(result.structuredContent) : '';
      extText(text, 200000); boundedExtension(result, 256000); return { text, raw: result, interpretation: 'external-service-unverified' };
    }
    result = await this.rpc('resources/read', { uri: call.name }, signal);
    if (!Array.isArray(result.contents) || !result.contents.length || result.contents.length > 16) err('MCP_INVALID_RESPONSE', 'Invalid resource contents.');
    const texts = (result.contents as unknown[]).map(c => { if (!isRecord(c) || typeof c.text !== 'string' || c.uri !== call.name || Object.hasOwn(c, 'blob')) return err('MCP_CONTENT_UNSUPPORTED', 'Only explicit text resources are supported.'); return c.text; });
    const text = texts.join('\n\n'); extText(text, 200000); boundedExtension(result, 256000); return { text, raw: result, interpretation: 'external-service-unverified' };
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true;
    this.pending?.reject(new McpError('MCP_CLOSED', 'MCP connection closed.')); this.pending = null;
    if (this.child) {
      const child = this.child; const exited = () => child.exitCode !== null || child.signalCode !== null;
      const wait = async (ms: number) => { if(exited())return; await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);child.removeListener('exit',done);resolve();};const timer=setTimeout(done,ms);child.once('exit',done);}); };
      child.stdin.end(); await wait(500); if (!exited()) { child.kill('SIGTERM'); await wait(500); } if (!exited()) { child.kill('SIGKILL'); await wait(500); }
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); this.child = null;
    }
    if (!this.modern() && this.config.transport === 'http' && this.session) { try { const r = await fetch(this.config.url, { method: 'DELETE', headers: this.headers('session/close', {}), redirect: 'error', signal: AbortSignal.timeout(1000) }); await r.body?.cancel(); } catch { /* Session cleanup failure is not a successful tool result. */ } }
  }
}
