// SPDX-License-Identifier: Apache-2.0
// Protocol/lifecycle/HTTP framing are owned by the pinned official MCP SDK.
// The host retains the byte/authority boundary and a strict stdio I/O transport.
import type { Client } from '@modelcontextprotocol/client';
import type { Transport, JSONRPCMessage, TransportSendOptions } from '@modelcontextprotocol/client';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { isRecord, hashBytes, validateMcpConnection, inspectToolSchema, validateToolArguments, toolHeaders, extText, boundedExtension } from '@writer-agent/core';
import type { McpConnection, McpCatalog, McpTool, McpResource, ApprovedMcpCall } from '@writer-agent/core';
import { parseAnalysisJson } from '@writer-agent/models';
const MAX_MESSAGE = 2000000;
export const MCP_SDK_VERSION = '2.0.0';
export class McpError extends Error {
    constructor(readonly code: string, message: string) { super(message); this.name = 'McpError'; }
}
function err(code: string, message: string): never { throw new McpError(code, message); }
export interface McpTextResult {
    text: string;
    raw: unknown;
    interpretation: 'external-service-unverified';
}
export type McpCredential = (endpoint: string) => Promise<string | undefined>;
function safeJson(text: string): Record<string, unknown> {
    try {
        const v = parseAnalysisJson(text);
        if (!isRecord(v))
            throw Error();
        return v;
    }
    catch {
        return err('MCP_INVALID_RESPONSE', 'Malformed, duplicate-key, oversized or non-object MCP JSON.');
    }
}
function noCallback(message: JSONRPCMessage): void {
    const r = 'result' in message && isRecord(message.result) ? message.result : null;
    if (r?.resultType === 'input_required')
        err('MCP_INTERACTION_UNSUPPORTED', 'Additional client input is not authorized.');
    if (Array.isArray(r?.content) && r.content.some(c => isRecord(c) && c.type !== 'text'))
        err('MCP_CONTENT_UNSUPPORTED', 'Only text results are supported.');
    if ('method' in message && 'id' in message)
        err('MCP_INTERACTION_UNSUPPORTED', 'Server callback is not authorized; no callback was executed.');
}
/** A transport boundary, not another protocol stack. The SDK creates/dispatches messages. */
class BoundedStdio implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    private child: ChildProcessWithoutNullStreams | null = null;
    private stopped = false;
    private bytes = Buffer.alloc(0);
    private stderrBytes = 0;
    constructor(private config: Extract<McpConnection, {
        transport: 'stdio';
    }>) { }
    async start(): Promise<void> {
        if (this.child || this.stopped)
            err('MCP_CLOSED', 'Cannot restart a stopped transport.');
        const env: Record<string, string> = {};
        for (const n of new Set(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', ...this.config.env]))
            if (process.env[n] !== undefined)
                env[n] = process.env[n]!;
        const child = spawn(this.config.command, this.config.args, { cwd: this.config.cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        this.child = child;
        const fail = (e: unknown) => { this.onerror?.(e instanceof McpError ? e : new McpError('MCP_NETWORK', 'MCP pipe failed; remote details omitted.')); void this.close(); };
        child.on('error', fail);
        child.stdin.on('error', fail);
        child.stdout.on('error', fail);
        child.on('exit', () => { if (!this.stopped) {
            this.onerror?.(new McpError('MCP_NETWORK', 'MCP child exited. No restart/retry.'));
            this.onclose?.();
        } });
        child.stderr.on('data', (b: Buffer) => { this.stderrBytes += b.length; if (this.stderrBytes > 256000)
            fail(new McpError('MCP_LIMIT', 'MCP stderr budget exceeded.')); });
        child.stdout.on('data', (b: Buffer) => {
            if (this.stopped)
                return;
            try {
                this.bytes = Buffer.concat([this.bytes, b]);
                if (this.bytes.length > MAX_MESSAGE)
                    err('MCP_LIMIT', 'MCP frame too large.');
                let nl: number;
                while ((nl = this.bytes.indexOf(10)) >= 0) {
                    const line = this.bytes.subarray(0, nl);
                    this.bytes = this.bytes.subarray(nl + 1);
                    if (!line.length)
                        continue;
                    const value = safeJson(new TextDecoder('utf-8', { fatal: true }).decode(line));
                    this.onmessage?.(value as unknown as JSONRPCMessage);
                }
            }
            catch (e) {
                fail(e);
            }
        });
        await new Promise<void>((res, rej) => { child.once('spawn', res); child.once('error', () => rej(new McpError('MCP_NETWORK', 'Cannot launch approved MCP executable.'))); });
    }
    async send(message: JSONRPCMessage): Promise<void> { if (this.stopped || !this.child)
        err('MCP_CLOSED', 'MCP pipe closed.'); const text = JSON.stringify(message) + '\n'; if (Buffer.byteLength(text) > 128000)
        err('MCP_LIMIT', 'MCP request too large.'); await new Promise<void>((res, rej) => this.child!.stdin.write(text, e => e ? rej(new McpError('MCP_NETWORK', 'MCP write failed.')) : res())); }
    async close(): Promise<void> {
        if (this.stopped)
            return;
        this.stopped = true;
        const c = this.child;
        if (c) {
            const exited = () => c.exitCode !== null || c.signalCode !== null;
            const wait = (ms: number) => new Promise<void>(r => { if (exited())
                return r(); const done = () => { clearTimeout(t); c.removeListener('exit', done); r(); }; const t = setTimeout(done, ms); c.once('exit', done); });
            c.stdin.end();
            await wait(400);
            if (!exited()) {
                c.kill('SIGTERM');
                await wait(400);
            }
            if (!exited()) {
                c.kill('SIGKILL');
                await wait(400);
            }
            c.stdin.destroy();
            c.stdout.destroy();
            c.stderr.destroy();
            this.child = null;
        }
        this.onclose?.();
    }
}
/** Restricts SDK traffic, including any internal re-send or protocol auto-continuation. */
class GuardTransport implements Transport {
    onclose?: () => void;
    onerror?: (e: Error) => void;
    onmessage?: (m: JSONRPCMessage) => void;
    private received = 0;
    private sent = 0;
    private roundTrips = new Set<string>();
    constructor(readonly inner: Transport, private fatal: (e: Error) => void) { }
    get sessionId() { return this.inner.sessionId; }
    reset(): void { this.received = 0; this.sent = 0; this.roundTrips.clear(); }
    async start() {
        this.inner.onclose = () => this.onclose?.();
        this.inner.onerror = e => { this.fatal(e); this.onerror?.(e); };
        this.inner.onmessage = m => {
            try {
                if (++this.received > 120 || Buffer.byteLength(JSON.stringify(m)) > MAX_MESSAGE)
                    err('MCP_LIMIT', 'MCP message budget exceeded.');
                noCallback(m);
                this.onmessage?.(m);
            }
            catch (e) {
                this.fatal(e as Error);
                void this.close();
            }
        };
        await this.inner.start();
    }
    async send(m: JSONRPCMessage, o?: TransportSendOptions) {
        if (++this.sent > 32 || Buffer.byteLength(JSON.stringify(m)) > 128000)
            err('MCP_LIMIT', 'MCP request budget exceeded.');
        if ('method' in m) {
            const method = m.method;
            if (!['initialize', 'server/discover', 'tools/list', 'resources/list', 'tools/call', 'resources/read', 'notifications/initialized', 'notifications/cancelled'].includes(method))
                err('MCP_INTERACTION_UNSUPPORTED', 'SDK attempted an unapproved method.');
            if ('id' in m) {
                const key = JSON.stringify({ method, params: m.params });
                if (this.roundTrips.has(key))
                    err('MCP_CHANGED', 'Implicit SDK retry blocked. Reinspect and authorize explicitly.');
                this.roundTrips.add(key);
            }
        }
        else
            err('MCP_INTERACTION_UNSUPPORTED', 'Server-request replies are not authorized.');
        await this.inner.send(m, o);
    }
    async close() { await this.inner.close(); }
}
/** No process is launched during registration/preflight. Hashes detect changes, not hostile behavior. */
export async function mcpLaunchHash(config: McpConnection): Promise<string> {
    validateMcpConnection(config);
    const items: {
        path: string;
        hash: string;
    }[] = [];
    if (config.transport === 'stdio') {
        const stat = lstatSync(config.cwd);
        if (!stat.isDirectory() || stat.isSymbolicLink())
            err('MCP_CONFIG', 'Working directory must be an ordinary directory.');
        const paths = [...new Set([config.command, ...config.args.filter(a => a && !a.startsWith('-')).map(a => isAbsolute(a) ? a : resolve(config.cwd, a)).filter(a => { try {
                    return lstatSync(a).isFile();
                }
                catch {
                    return false;
                } })])];
        for (const p of paths) {
            const st = lstatSync(p);
            if (!st.isFile() || st.isSymbolicLink() || st.size > 300000000)
                err('MCP_CONFIG', 'Executable/script must be an existing ordinary bounded file.');
            const h = createHash('sha256');
            for await (const b of createReadStream(p))
                h.update(b);
            items.push({ path: realpathSync(p), hash: h.digest('hex') });
        }
    }
    return hashBytes(JSON.stringify({ adapter: 'official-sdk-2.0.0', config, items }));
}
function catalogHash(tools: McpTool[], resources: McpResource[]): string { return hashBytes(JSON.stringify({ tools: tools.map(t => t.hash), resources: resources.map(r => r.hash) })); }
function decodeTool(value: unknown): McpTool {
    if (!isRecord(value))
        err('MCP_INVALID_RESPONSE', 'Invalid tool descriptor.');
    extText(value.name, 200);
    extText(value.description ?? '', 10000, true);
    if (!isRecord(value.inputSchema) || value.inputSchema.type !== 'object')
        err('MCP_SCHEMA_UNSUPPORTED', 'Tool input schema must be an object.');
    inspectToolSchema(value.inputSchema);
    toolHeaders(value.inputSchema, {});
    if (value.outputSchema !== undefined) {
        if (!isRecord(value.outputSchema))
            err('MCP_SCHEMA_UNSUPPORTED', 'Invalid output schema.');
        inspectToolSchema(value.outputSchema);
    }
    if (value.annotations !== undefined && !isRecord(value.annotations))
        err('MCP_INVALID_RESPONSE', 'Invalid tool annotations.');
    const descriptor = { name: value.name, description: String(value.description ?? ''), inputSchema: value.inputSchema, outputSchema: value.outputSchema as Record<string, unknown> ?? null, annotations: value.annotations as Record<string, unknown> ?? {} };
    boundedExtension(descriptor, 64000);
    return { ...descriptor, hash: hashBytes(JSON.stringify(descriptor)) };
}
function decodeResource(value: unknown): McpResource {
    if (!isRecord(value))
        err('MCP_INVALID_RESPONSE', 'Invalid resource descriptor.');
    extText(value.uri, 2048);
    extText(value.name, 200);
    extText(value.description ?? '', 10000, true);
    if (value.mimeType !== undefined)
        extText(value.mimeType, 200);
    const d = { uri: value.uri, name: value.name, description: String(value.description ?? ''), mimeType: value.mimeType as string ?? null };
    return { ...d, hash: hashBytes(JSON.stringify(d)) };
}
/** SDK-backed client. No OAuth, callbacks, version fallback or business-call retries. */
export class McpClient {
    readonly config: McpConnection;
    private sdk: Client | null = null;
    private transport: GuardTransport | null = null;
    private initialized = false;
    private closed = false;
    private fatal: Error | null = null;
    private capabilities: Record<string, unknown> = {};
    private activeSchema: Record<string, unknown> | undefined;
    private httpRequests = new Set<string>();
    constructor(config: McpConnection, private readonly expectedLaunchHash: string, private readonly credential?: McpCredential) { validateMcpConnection(config); this.config = structuredClone(config); }
    private stopped(e: unknown): Error {
        if (e instanceof McpError)
            return e;
        const code = (e as {
            code?: unknown;
        })?.code;
        return new McpError(typeof code === 'number' ? 'MCP_REMOTE_ERROR' : String(code).includes('TIMEOUT') ? 'MCP_TIMEOUT' : String(code).includes('UNSUPPORTED_RESULT') ? 'MCP_INTERACTION_UNSUPPORTED' : 'MCP_INVALID_RESPONSE', 'MCP SDK rejected the connection/message. Remote details omitted; no fallback.');
    }
    private async guardedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
        if (this.config.transport !== 'http')
            err('MCP_CONFIG', 'HTTP transport mismatch.');
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (new URL(url).href !== new URL(this.config.url).href)
            err('MCP_CHANGED', 'SDK attempted a different endpoint.');
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        if (method === 'GET')
            return new Response(null, { status: 405 }); // Unsolicited streams disabled without network I/O.
        if (!['POST', 'DELETE'].includes(method))
            err('MCP_INTERACTION_UNSUPPORTED', 'Unsupported SDK HTTP operation.');
        const body = typeof init?.body === 'string' ? init.body : '';
        const headers = new Headers(init?.headers);
        if (method === 'POST') {
            if (Buffer.byteLength(body) > 128000)
                err('MCP_LIMIT', 'MCP request too large.');
            const message = safeJson(body);
            const key = body;
            if (this.httpRequests.has(key))
                err('MCP_CHANGED', 'Implicit transport retry blocked.');
            this.httpRequests.add(key);
            if (message.method === 'tools/call' && this.activeSchema && isRecord(message.params) && isRecord(message.params.arguments))
                for (const [k, v] of Object.entries(toolHeaders(this.activeSchema, message.params.arguments)))
                    headers.set(k, v);
        }
        const token = this.credential ? await this.credential(this.config.url) : this.config.tokenEnv ? process.env[this.config.tokenEnv] : undefined;
        if ((this.config.tokenEnv && !this.credential && !token) || (token !== undefined && (!token || token.length > 8192 || !/^[\x21-\x7e]+$/.test(token))))
            err('MCP_AUTH', 'Missing or invalid credential.');
        if (token)
            headers.set('Authorization', `Bearer ${token}`);
        const r = await fetch(url, { ...init, method, headers, redirect: 'error', signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(this.config.timeoutMs)]) });
        if (!r.ok) {
            await r.body?.cancel();
            err(r.status === 401 || r.status === 403 ? 'MCP_AUTH' : r.status === 429 ? 'MCP_RATE_LIMIT' : 'MCP_HTTP_ERROR', `MCP HTTP ${r.status}; response omitted.`);
        }
        if (method === 'DELETE' || r.status === 202 || r.status === 204) {
            await r.body?.cancel();
            return new Response(null, { status: r.status, headers: r.headers });
        }
        const mime = r.headers.get('content-type')?.split(';')[0]?.trim();
        if (!['application/json', 'text/event-stream'].includes(mime ?? '')) {
            await r.body?.cancel();
            err('MCP_INVALID_RESPONSE', 'Expected JSON or SSE response.');
        }
        if (!r.body)
            err('MCP_INVALID_RESPONSE', 'Empty response.');
        const reader = r.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0, buffer = '', notifications = 0;
        const outHeaders = new Headers(r.headers);
        outHeaders.delete('content-length');
        outHeaders.delete('content-encoding');
        outHeaders.set('content-type', 'application/json');
        try {
            while (true) {
                const p = await reader.read();
                if (p.done)
                    break;
                bytes += p.value.length;
                if (bytes > MAX_MESSAGE)
                    err('MCP_LIMIT', 'MCP response byte limit.');
                buffer += decoder.decode(p.value, { stream: true });
                if (mime === 'text/event-stream') {
                    buffer = buffer.replace(/\r\n/g, '\n');
                    let boundary;
                    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                        const frame = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 2);
                        const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
                        if (!data)
                            continue;
                        const v = safeJson(data);
                        if (typeof v.method === 'string') {
                            if (Object.hasOwn(v, 'id'))
                                err('MCP_INTERACTION_UNSUPPORTED', 'Server callback is not supported.');
                            if (++notifications > 100)
                                err('MCP_LIMIT', 'Too many notifications.');
                            continue;
                        }
                        return new Response(JSON.stringify(v), { status: r.status, headers: outHeaders });
                    }
                }
            }
            buffer += decoder.decode();
            if (mime !== 'application/json')
                err('MCP_NETWORK', 'SSE ended before result.');
            return new Response(JSON.stringify(safeJson(buffer)), { status: r.status, headers: outHeaders });
        }
        finally {
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
        }
    }
    async connect(signal?: AbortSignal): Promise<void> {
        if (this.closed)
            err('MCP_CLOSED', 'MCP connection closed.');
        if (signal?.aborted)
            err('MCP_CANCELLED', 'Cancelled before connection.');
        if (this.initialized)
            return;
        if (await mcpLaunchHash(this.config) !== this.expectedLaunchHash)
            err('MCP_CHANGED', 'Connection changed; inspect and explicitly renew trust.');
        if (signal?.aborted)
            err('MCP_CANCELLED', 'Cancelled before launch.');
        let SDK: typeof import('@modelcontextprotocol/client');
        try {
            SDK = await import('@modelcontextprotocol/client');
        }
        catch {
            err('MCP_SDK_UNAVAILABLE', 'Official MCP SDK is not installed/loadable. No native fallback was used.');
        }
        const { Client, StreamableHTTPClientTransport } = SDK;
        const raw: Transport = this.config.transport === 'stdio' ? new BoundedStdio(this.config) : new StreamableHTTPClientTransport(new URL(this.config.url), {
            fetch: (i, o) => this.guardedFetch(i, o), requestInit: { redirect: 'error' }, protocolVersion: this.config.protocol,
            reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 100, maxReconnectionDelay: 100, reconnectionDelayGrowFactor: 1 }, onInsufficientScope: 'throw', maxStepUpRetries: 0,
        });
        this.transport = new GuardTransport(raw, e => { this.fatal = this.stopped(e); });
        this.sdk = new Client({ name: 'Siglum', version: '0.0.8' }, { capabilities: {}, supportedProtocolVersions: [this.config.protocol],
            versionNegotiation: { mode: this.config.protocol === '2026-07-28' ? { pin: this.config.protocol } : 'legacy', probe: { maxRetries: 0, timeoutMs: this.config.timeoutMs } },
            inputRequired: { autoFulfill: false, maxRounds: 0 }, listMaxPages: 10, defaultCacheTtlMs: 0,
            jsonSchemaValidator: { getValidator: <T>(schema: Record<string, unknown>) => { inspectToolSchema(schema); return (value: unknown) => { try {
                    validateToolArguments(schema, value);
                    return { valid: true, data: value as T, errorMessage: undefined };
                }
                catch {
                    return { valid: false, data: undefined, errorMessage: 'Output does not match the approved schema.' };
                } }; } }
        });
        this.sdk.onerror = e => { this.fatal = this.stopped(e); };
        try {
            await this.sdk.connect(this.transport, { ...(signal ? { signal } : {}), timeout: this.config.timeoutMs, maxTotalTimeout: this.config.timeoutMs });
            if (this.fatal)
                throw this.fatal;
            if (this.sdk.getNegotiatedProtocolVersion() !== this.config.protocol)
                err('MCP_PROTOCOL_UNSUPPORTED', 'SDK did not retain the explicitly selected protocol.');
            this.capabilities = this.sdk.getServerCapabilities() as Record<string, unknown> ?? {};
            this.initialized = true;
        }
        catch (e) {
            await this.close();
            if (signal?.aborted)
                err('MCP_CANCELLED', 'MCP cancelled.');
            throw this.fatal ?? this.stopped(e);
        }
    }
    private async rpc(method: 'tools/list' | 'resources/list' | 'tools/call' | 'resources/read', params: Record<string, unknown>, signal?: AbortSignal, schema?: Record<string, unknown>): Promise<Record<string, unknown>> {
        if (this.closed || !this.sdk)
            err('MCP_CLOSED', 'Not connected.');
        if (signal?.aborted)
            err('MCP_CANCELLED', 'Cancelled.');
        if (this.fatal)
            throw this.fatal;
        this.transport!.reset();
        this.httpRequests.clear();
        this.activeSchema = schema;
        try {
            const result = await this.sdk.request({ method, params }, { ...(signal ? { signal } : {}), timeout: this.config.timeoutMs, maxTotalTimeout: this.config.timeoutMs });
            if (this.fatal)
                throw this.fatal;
            if (!isRecord(result))
                err('MCP_INVALID_RESPONSE', 'Expected complete object result.');
            if (result.resultType !== undefined && result.resultType !== 'complete')
                err('MCP_INTERACTION_UNSUPPORTED', 'Additional interaction is not authorized.');
            return result;
        }
        catch (e) {
            if (signal?.aborted)
                err('MCP_CANCELLED', 'Cancelled; remote result may be unknown.');
            throw this.fatal ?? this.stopped(e);
        }
        finally {
            this.activeSchema = undefined;
        }
    }
    private async list(method: 'tools/list' | 'resources/list', field: 'tools' | 'resources', signal?: AbortSignal): Promise<unknown[]> {
        const values: unknown[] = [], seen = new Set<string>();
        let cursor: string | undefined;
        for (let page = 0; page < 10; page++) {
            const r = await this.rpc(method, cursor ? { cursor } : {}, signal);
            if (!Array.isArray(r[field]))
                err('MCP_INVALID_RESPONSE', 'Invalid catalogue.');
            values.push(...r[field] as unknown[]);
            if (values.length > 100)
                err('MCP_LIMIT', 'Catalogue size limit.');
            if (r.nextCursor === undefined)
                return values;
            if (typeof r.nextCursor !== 'string' || !r.nextCursor || r.nextCursor.length > 2048 || seen.has(r.nextCursor))
                err('MCP_INVALID_RESPONSE', 'Invalid pagination cursor.');
            cursor = r.nextCursor;
            seen.add(cursor);
        }
        return err('MCP_LIMIT', 'Catalogue pagination limit.');
    }
    async discover(signal?: AbortSignal): Promise<McpCatalog> {
        await this.connect(signal);
        const tools: McpTool[] = [], resources: McpResource[] = [], excluded: {
            name: string;
            reason: string;
        }[] = [];
        const names = new Set<string>(), uris = new Set<string>();
        if (this.capabilities.tools)
            for (const value of await this.list('tools/list', 'tools', signal)) {
                const name = isRecord(value) && typeof value.name === 'string' ? value.name : '(invalid name)';
                if (names.has(name))
                    err('MCP_INVALID_RESPONSE', 'Duplicate tool names in catalogue.');
                names.add(name);
                try {
                    tools.push(decodeTool(value));
                }
                catch {
                    excluded.push({ name: name.slice(0, 200), reason: 'Unsupported or invalid tool schema/descriptor; excluded, not allowed.' });
                }
            }
        if (this.capabilities.resources)
            for (const value of await this.list('resources/list', 'resources', signal)) {
                const r = decodeResource(value);
                if (uris.has(r.uri))
                    err('MCP_INVALID_RESPONSE', 'Duplicate resource URIs.');
                uris.add(r.uri);
                resources.push(r);
            }
        tools.sort((a, b) => a.name < b.name ? -1 : 1);
        resources.sort((a, b) => a.uri < b.uri ? -1 : 1);
        return { version: 'mcp-catalog-v1', tools, resources, excluded, hash: catalogHash(tools, resources) };
    }
    async execute(call: ApprovedMcpCall, signal?: AbortSignal, observeCatalog?: (catalog: McpCatalog) => void): Promise<McpTextResult> {
        call = structuredClone(call);
        if (hashBytes(JSON.stringify(call.config)) !== hashBytes(JSON.stringify(this.config)) || call.serverHash !== this.expectedLaunchHash)
            err('MCP_CHANGED', 'Call destination differs from captured approval.');
        const catalog = await this.discover(signal);
        observeCatalog?.(catalog);
        const descriptor = call.kind === 'tool' ? catalog.tools.find(t => t.name === call.name) : catalog.resources.find(r => r.uri === call.name);
        if (!descriptor || descriptor.hash !== call.descriptor.hash)
            err('MCP_CHANGED', 'Tool/resource descriptor changed. Inspect and reauthorize; no tool was called.');
        let result: Record<string, unknown>;
        if (call.kind === 'tool') {
            const tool = descriptor as McpTool;
            validateToolArguments(tool.inputSchema, call.arguments);
            result = await this.rpc('tools/call', { name: call.name, arguments: call.arguments }, signal, tool.inputSchema);
            if (result.isError === true)
                err('MCP_TOOL_ERROR', 'MCP tool reported an error; output not imported as evidence.');
            if (result.isError !== undefined && typeof result.isError !== 'boolean')
                err('MCP_INVALID_RESPONSE', 'Invalid tool error flag.');
            if (tool.outputSchema) {
                if (!isRecord(result.structuredContent))
                    err('MCP_INVALID_RESPONSE', 'Tool omitted schema-declared structured output.');
                validateToolArguments(tool.outputSchema, result.structuredContent);
            }
            if (!Array.isArray(result.content) || result.content.length > 32)
                err('MCP_INVALID_RESPONSE', 'Invalid tool content.');
            const texts = (result.content as unknown[]).map(c => { if (!isRecord(c) || c.type !== 'text' || typeof c.text !== 'string')
                return err('MCP_CONTENT_UNSUPPORTED', 'Only text tool content is supported; binary/link results were not followed.'); return c.text; });
            const text = texts.length ? texts.join('\n\n') : isRecord(result.structuredContent) ? JSON.stringify(result.structuredContent) : '';
            extText(text, 200000);
            boundedExtension(result, 256000);
            return { text, raw: result, interpretation: 'external-service-unverified' };
        }
        result = await this.rpc('resources/read', { uri: call.name }, signal);
        if (!Array.isArray(result.contents) || !result.contents.length || result.contents.length > 16)
            err('MCP_INVALID_RESPONSE', 'Invalid resource contents.');
        const texts = (result.contents as unknown[]).map(c => { if (!isRecord(c) || typeof c.text !== 'string' || c.uri !== call.name || Object.hasOwn(c, 'blob'))
            return err('MCP_CONTENT_UNSUPPORTED', 'Only explicit text resources are supported.'); return c.text; });
        const text = texts.join('\n\n');
        extText(text, 200000);
        boundedExtension(result, 256000);
        return { text, raw: result, interpretation: 'external-service-unverified' };
    }
    async close(): Promise<void> { if (this.closed)
        return; this.closed = true; try {
        await this.sdk?.close();
    }
    finally {
        await this.transport?.close();
        this.sdk = null;
        this.transport = null;
    } }
}
