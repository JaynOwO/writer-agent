// SPDX-License-Identifier: Apache-2.0
import { writeFileSync } from 'node:fs';
import { WriterError, validateMcpConnection, validateWorkflowExtensions } from '@writer-agent/core';
import type { McpConnection } from '@writer-agent/core';
import { Workspace } from '@writer-agent/storage';
import type { StoredServer, StoredCatalog } from '@writer-agent/storage';
import { readWorkflowJson } from './workflow-command.js';
import { readSkillDirectory } from './skill-import.js';
import { McpClient, mcpLaunchHash, McpError } from './mcp-client.js';

export const extensionsHelp = `Siglum extension/research preview — explicit trust, no automatic script installation

  siglum extensions guide <workspace> [--lang zh-CN|en]
  siglum skill import <workspace> <directory> [--apply]
  siglum skill list|show <workspace> [skillId]
  siglum skill enable|disable <workspace> <skillId>
  siglum skill read <workspace> <skillId> <relative-path> <start-line> <end-line>
  siglum mcp register <workspace> <connection.json> [--apply]
  siglum mcp list|show <workspace> [serverId]
  siglum mcp trust <workspace> <serverId> <launch-hash>
  siglum mcp revoke <workspace> <serverId>
  siglum mcp discover <workspace> <serverId> [--connect]
  siglum mcp catalog <workspace> <serverId>
  siglum research query <workspace> <snapshotId> <question>
  siglum citations show <workspace> <artifactId-or-documentId>
  siglum citations export <workspace> <artifactId-or-documentId> <new-file.json>

Imports/register preview until --apply; registration does NOT start a process/connect.
Trust authorizes connecting/launching an installed server, NOT tools or an OS sandbox.
Discover contacts the trusted server only with --connect. Tools run only through a
workflow stage with exact approved descriptor + parameters; no generic shell/call command.
Skills use a restricted text-only SKILL.md frontmatter subset, not arbitrary scripts.
MCP supports explicitly chosen 2026-07-28 or 2025-11-25 tools/text resources, not OAuth,
sampling, elicitation, binary content, arbitrary JSON Schema or full MCP conformance.
`;
export async function registerMcp(w: Workspace, config: McpConnection): Promise<StoredServer> {
  validateMcpConnection(config); return w.extensions.registerServer(config, await mcpLaunchHash(config));
}
export async function discoverMcp(w: Workspace, id: string, signal?: AbortSignal): Promise<StoredCatalog> {
  const server = w.extensions.server(id), trustId = w.extensions.trust(id);
  if (!trustId) throw new WriterError('EXTENSION_PERMISSION', 'Explicit server trust is required before discovery.');
  const client = new McpClient(server.config, server.launchHash);
  try {
    const catalog = await client.discover(signal);
    if (w.extensions.trust(id) !== trustId) throw new WriterError('EXTENSION_PERMISSION', 'Trust changed during discovery. No catalogue was saved.');
    return w.extensions.saveCatalog(id, catalog);
  } finally { await client.close(); }
}
function count(a: string[], n: number, m = n) { if (a.length < n || a.length > m) throw new WriterError('INVALID_INPUT', 'Wrong extension arguments; see siglum extensions help.'); }
function flag(v: string | undefined, expected: string) { if (v !== undefined && v !== expected) throw new WriterError('INVALID_INPUT', `Expected ${expected}, not an unknown flag.`); return v === expected; }
const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));
export async function extensionsCommand(family: string, args: string[]) {
  const [action = 'help', ...a] = args;
  if (action === 'help') { count(a, 0); console.log(extensionsHelp); return; }
  if (family === 'extensions' && action === 'guide') { const { extensionsGuideCommand } = await import('./extensions-guide.js'); await extensionsGuideCommand(a); return; }
  if (!a[0]) throw new WriterError('INVALID_INPUT', 'Workspace path is required.');
  const w = Workspace.open(a[0]);
  const controller = new AbortController(), cancel = () => controller.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    if (family === 'skill') {
      if (action === 'import') { count(a, 2, 3); const apply = flag(a[2], '--apply'), pkg = readSkillDirectory(a[1]!); print(apply ? w.extensions.importSkill(pkg) : { preview: true, name: pkg.metadata.name, description: pkg.metadata.description, hash: pkg.hash, files: pkg.files.map(f => ({ path: f.path, bytes: Buffer.byteLength(f.text) })), warnings: pkg.warnings, requiresEnable: true }); }
      else if (action === 'list') { count(a, 1); print(w.extensions.skills().map(s => ({ id: s.id, name: s.package.metadata.name, description: s.package.metadata.description, hash: s.package.hash, enabled: s.enabled }))); }
      else if (action === 'show') { count(a, 2); print(w.extensions.skill(a[1]!)); }
      else if (action === 'enable' || action === 'disable') { count(a, 2); w.extensions.setSkill(a[1]!, action === 'enable'); print({ id: a[1], enabled: action === 'enable' }); }
      else if (action === 'read') { count(a, 5); print(w.extensions.loadSkills([{ id: a[1]!, references: [{ path: a[2]!, startLine: Number(a[3]), endLine: Number(a[4]) }] }])); }
      else throw new WriterError('INVALID_INPUT', 'Unknown skill command.');
    } else if (family === 'mcp') {
      if (action === 'register') { count(a, 2, 3); const apply = flag(a[2], '--apply'), config = readWorkflowJson(a[1]!); validateMcpConnection(config); const launchHash = await mcpLaunchHash(config); print(apply ? w.extensions.registerServer(config, launchHash) : { preview: true, config, launchHash, warning: 'A stdio connection executes a third-party program with user permissions. No OS sandbox. Trust separately.' }); }
      else if (action === 'list') { count(a, 1); print(w.extensions.servers()); }
      else if (action === 'show') { count(a, 2); print(w.extensions.server(a[1]!)); }
      else if (action === 'trust') { count(a, 3); const server = w.extensions.server(a[1]!); if (server.launchHash !== a[2] || await mcpLaunchHash(server.config) !== a[2]) throw new McpError('MCP_CHANGED', 'Trust fingerprint differs; inspect/re-register the actual connection.'); w.extensions.setTrust(server.id, true); print({ serverId: server.id, trusted: true, toolsApproved: false }); }
      else if (action === 'revoke') { count(a, 2); w.extensions.setTrust(a[1]!, false); print({ serverId: a[1], trusted: false }); }
      else if (action === 'catalog') { count(a, 2); print(w.extensions.latestCatalog(a[1]!)); }
      else if (action === 'discover') { count(a, 2, 3); print(flag(a[2], '--connect') ? await discoverMcp(w, a[1]!, controller.signal) : { preview: true, server: w.extensions.server(a[1]!), trusted: !!w.extensions.trust(a[1]!), networkOrProcessStarted: false }); }
      else throw new WriterError('INVALID_INPUT', 'Unknown MCP command.');
    } else if (family === 'research' && action === 'query') { count(a, 3); print(w.extensions.evidence(a[1]!, a[2]!)); }
    else if (family === 'citations' && ['show', 'export'].includes(action)) {
      count(a, action === 'export' ? 3 : 2); const records = w.extensions.citations(a[1]!);
      if (action === 'show') print(records); else { writeFileSync(a[2]!, JSON.stringify(records, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 }); print({ exported: true, count: records.length, includesPrivateSources: true }); }
    } else throw new WriterError('INVALID_INPUT', 'Unknown extension command.');
  } finally { w.close(); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
/** Validate selected actions without connecting. Shared by guide and workflow configuration. */
export function validateExtensionSelection(value: unknown) { validateWorkflowExtensions(value); return value; }
