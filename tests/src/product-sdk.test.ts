// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createServer } from 'node:http';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';
import type { McpConnection, ApprovedMcpCall, McpCatalog } from '@writer-agent/core';
import { McpClient, mcpLaunchHash } from './extensions-helpers.js';
function tool(c: McpConnection, h: string, catalog: McpCatalog): ApprovedMcpCall { return { serverId: 'sdk-fixture', catalogId: 'sdk-catalog', kind: 'tool', name: 'echo', arguments: { text: '中文 😀' }, permission: 'read', config: c, serverHash: h, trustId: 'test', descriptor: catalog.tools.find(t => t.name === 'echo')! }; }
for (const protocol of ['2026-07-28', '2025-11-25'] as const)
    test(`Official SDK server2.0.0 stdio handshake, tool, resource (${protocol})`, async () => {
        const path = fileURLToPath(new URL('../fixtures/sdk-server.mjs', import.meta.url)), c: McpConnection = { name: 'SDK fixture', transport: 'stdio', protocol, command: process.execPath, args: [path], cwd: dirname(path), env: [], timeoutMs: 6000 };
        const h = await mcpLaunchHash(c), client = new McpClient(c, h);
        try {
            const catalog = await client.discover();
            assert.equal(catalog.tools.length, 1);
            const r = await client.execute(tool(c, h, catalog));
            assert.match(r.text, /SDK fixture: 中文 😀/);
            const rr = await client.execute({ ...tool(c, h, catalog), kind: 'resource', name: 'fixture://reference', arguments: {}, descriptor: catalog.resources[0]! });
            assert.match(rr.text, /Synthetic reference/);
        }
        finally {
            await client.close();
        }
    });
for (const enableJsonResponse of [true, false])
    test(`Official SDK Node HTTP server (${enableJsonResponse ? 'JSON' : 'SSE'}) uses guarded client path`, async () => {
        const handler = createMcpHandler(() => { const service = new McpServer({ name: 'official-http-fixture', version: '1.0.0' }); service.registerTool('echo', { description: 'Synthetic', inputSchema: z.object({ text: z.string() }) }, async ({ text }) => ({ content: [{ type: 'text', text }] })); return service; }, { responseMode: enableJsonResponse ? 'json' : 'sse' });
        const serve = toNodeHandler(handler);
        const server = createServer((req, res) => { void serve(Object.assign(req, { method: req.method ?? 'POST', url: req.url ?? '/' }), res); });
        await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
        const a = server.address();
        assert.ok(a && typeof a !== 'string');
        const c: McpConnection = { name: 'SDK HTTP fixture', transport: 'http', protocol: '2026-07-28', url: `http://127.0.0.1:${a.port}/mcp`, tokenEnv: null, allowRemote: false, timeoutMs: 3000 }, h = await mcpLaunchHash(c), client = new McpClient(c, h);
        try {
            const catalog = await client.discover();
            assert.equal(catalog.tools.length, 1);
            assert.equal((await client.execute(tool(c, h, catalog))).text, '中文 😀');
        }
        finally {
            await client.close();
            await handler.close();
            server.closeAllConnections();
            await new Promise<void>(r => server.close(() => r()));
        }
    });
