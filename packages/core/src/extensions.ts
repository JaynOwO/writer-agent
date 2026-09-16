// SPDX-License-Identifier: Apache-2.0
import { isAbsolute } from 'node:path';
import { WriterError, isRecord } from './errors.js';
import { validateText } from './document.js';
import { hashBytes } from './sources.js';
import { exactObject } from './analysis.js';

export const EXTENSION_MAX_BYTES = 256000;
export function extensionError(message: string): never { throw new WriterError('EXTENSION_INVALID', message); }
export function boundedExtension(value: unknown, max = EXTENSION_MAX_BYTES): void {
  let text: string; try { text = JSON.stringify(value); } catch { extensionError('Extension data must be JSON.'); }
  if (text! === undefined || Buffer.byteLength(text!) > max) extensionError('Extension data exceeds its byte limit.');
}
export function extText(v: unknown, max = 2000, empty = false): asserts v is string {
  validateText(v); if (typeof v !== 'string' || v.length > max || (!empty && !v.trim())) extensionError('Invalid extension text.');
}
export interface SkillFile { path: string; text: string; hash: string }
export interface SkillMetadata { name: string; description: string; license: string | null; compatibility: string | null; metadata: Record<string, string>; allowedTools: string[] }
export interface SkillPackage { version: 'skill-package-v1'; hash: string; metadata: SkillMetadata; body: string; files: SkillFile[]; warnings: string[] }
export interface SkillSelection { id: string; references: { path: string; startLine: number; endLine: number }[] }
export interface LoadedSkill { id: string; activationId: string; hash: string; name: string; body: string; compatibility: string|null; support: 'instruction-text-only'; allowedTools: string[]; references: { path: string; startLine: number; endLine: number; text: string; hash: string }[] }
export function safeSkillPath(path: string): void {
  if (!/^[A-Za-z0-9_.\-/]+$/.test(path) || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..') || path.includes('\\') || path.includes(':')) extensionError('Invalid skill relative path.');
  if (path.split('/').some(p => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) || path.split('/').some(p => p.endsWith('.'))) extensionError('Reserved/ambiguous Windows path.');
}
/** Safe format subset: scalar frontmatter and a scalar metadata map; no tags, aliases or executable YAML. */
export function parseSkillFrontmatter(input: string): { metadata: SkillMetadata; body: string } {
  extText(input, 64000); const text = input.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');
  if (!text.startsWith('---\n')) extensionError('SKILL.md needs YAML frontmatter.');
  const end = text.indexOf('\n---\n', 4); if (end < 0 || end > 16000) extensionError('Missing or oversized skill frontmatter.');
  const lines = text.slice(4, end).split('\n'); const values: Record<string, unknown> = Object.create(null); let i = 0;
  const scalar = (s: string): string => {
    s = s.trim();
    if (s.startsWith('"')) { try { const v: unknown = JSON.parse(s); if (typeof v !== 'string') throw Error(); return v; } catch { extensionError('Invalid quoted YAML scalar.'); } }
    if (s.startsWith("'")) { if (!s.endsWith("'")) extensionError('Invalid single-quoted YAML scalar.'); return s.slice(1, -1).replace(/''/g, "'"); }
    if (/^[!&*\[{]|:\s/.test(s) || /\t/.test(s)) extensionError('Unsupported YAML feature. Use plain/quoted strings or block scalars.');
    return s.replace(/\s+#.*$/, '').trim();
  };
  while (i < lines.length) {
    const line = lines[i++]!; if (!line.trim() || /^\s*#/.test(line)) continue;
    const m = /^([a-z][a-z-]*):(?:\s+(.*))?$/.exec(line); if (!m) extensionError('Unsupported YAML frontmatter structure.');
    const key = m[1]!; if (Object.hasOwn(values, key)) extensionError('Duplicate skill metadata key.');
    if (!['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'].includes(key)) extensionError('Unknown skill frontmatter field.');
    if (key === 'metadata') {
      if ((m[2] ?? '').trim() && (m[2] ?? '').trim() !== '{}') extensionError('metadata must be an indented string map.');
      const metadata: Record<string, string> = Object.create(null);
      while (i < lines.length && /^\s/.test(lines[i]!)) {
        const v = /^ {2}([A-Za-z0-9_.\/-]+):\s*(.*)$/.exec(lines[i++]!); if (!v || ['__proto__', 'constructor', 'prototype'].includes(v[1]!)) extensionError('Invalid metadata entry.');
        if (Object.hasOwn(metadata, v[1]!)) extensionError('Duplicate metadata entry.'); metadata[v[1]!] = scalar(v[2]!);
      }
      values.metadata = metadata;
    } else if (['|', '>', '|-', '>-'].includes(m[2] ?? '')) {
      const body: string[] = []; while (i < lines.length && (/^ {2}/.test(lines[i]!) || !lines[i]!.trim())) body.push(lines[i++]!.replace(/^ {2}/, ''));
      values[key] = body.join(m[2]!.startsWith('>') ? ' ' : '\n').trimEnd();
    } else values[key] = scalar(m[2] ?? '');
  }
  extText(values.name, 64); if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.name)) extensionError('Skill name must use lower-case ASCII letters, numbers and single hyphens.');
  extText(values.description, 1024); const metadata = (values.metadata ?? {}) as Record<string, string>;
  if (Object.keys(metadata).length > 32) extensionError('Too many metadata entries.');
  if (values.compatibility !== undefined) extText(values.compatibility, 500);
  if (values.license !== undefined) extText(values.license, 500);
  const allowed = values['allowed-tools'] === undefined ? [] : String(values['allowed-tools']).split(/\s+/).filter(Boolean);
  if (allowed.length > 32 || allowed.some(t => t.length > 200)) extensionError('Too many/long allowed-tools identifiers.');
  const body = text.slice(end + 5); extText(body, 64000);
  return { metadata: { name: values.name, description: values.description, metadata, license: values.license as string ?? null, compatibility: values.compatibility as string ?? null, allowedTools: allowed }, body };
}
export function makeSkillPackage(directoryName: string, files: SkillFile[]): SkillPackage {
  if (!Array.isArray(files) || !files.length || files.length > 64) extensionError('Skill file count must be 1..64.');
  const paths = new Set<string>();
  for (const f of files) {
    exactObject(f, ['path', 'text', 'hash']); safeSkillPath(f.path); extText(f.text, 200000, true);
    if (paths.has(f.path.toLowerCase())) extensionError('Duplicate/case-colliding skill path.'); paths.add(f.path.toLowerCase());
    if (/^(scripts|node_modules|\.git)(\/|$)/i.test(f.path) || !/\.(md|txt|json|ya?ml)$/i.test(f.path)) extensionError('This release imports text-only skills without scripts or binary assets.');
    if (f.hash !== hashBytes(f.text)) extensionError('Skill file hash mismatch.');
  }
  const skill = files.find(f => f.path === 'SKILL.md'); if (!skill) extensionError('Missing SKILL.md.');
  const parsed = parseSkillFrontmatter(skill.text); if (parsed.metadata.name !== directoryName) extensionError('Skill name must match the selected directory name.');
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : 1); boundedExtension(sorted);
  const warnings = ['Instruction-only skill. No scripts, external downloads or implicit tool permissions.'];
  if (parsed.metadata.compatibility) warnings.push('Review declared compatibility requirements before enabling; host does not auto-install them.');
  if (parsed.metadata.allowedTools.length) warnings.push('allowed-tools can only narrow host permissions; it never grants them.');
  return { version: 'skill-package-v1', ...parsed, files: sorted, hash: hashBytes(JSON.stringify(sorted)), warnings };
}
export function validateLoadedSkills(value: unknown): asserts value is LoadedSkill[] {
  if (!Array.isArray(value) || value.length > 3) extensionError('At most three selected skills.');
  for (const s of value) {
    exactObject(s, ['id', 'activationId', 'hash', 'name', 'body', 'compatibility', 'support', 'allowedTools', 'references']); extText(s.id, 200); extText(s.activationId,200); extText(s.hash, 64); extText(s.name, 64); extText(s.body, 64000); if(s.compatibility!==null)extText(s.compatibility,500);if(s.support!=='instruction-text-only')extensionError('Unsupported skill execution capability.');
    if (!Array.isArray(s.allowedTools) || s.allowedTools.length > 32 || s.allowedTools.some(t => typeof t !== 'string' || t.length > 200)) extensionError('Invalid skill tool restrictions.');
    if (!Array.isArray(s.references) || s.references.length > 8) extensionError('Too many skill references.');
    for (const r of s.references) { exactObject(r, ['path', 'startLine', 'endLine', 'text', 'hash']); extText(r.path, 200); safeSkillPath(r.path); extText(r.text, 32000); if (r.hash !== hashBytes(r.text) || !Number.isSafeInteger(r.startLine) || !Number.isSafeInteger(r.endLine) || (r.startLine as number) < 1 || (r.endLine as number) < (r.startLine as number)) extensionError('Invalid loaded reference.'); }
  }
  boundedExtension(value, 48000);
}

export type McpProtocol = '2026-07-28' | '2025-11-25';
export type McpConnection = {
  name: string; protocol: McpProtocol; transport: 'stdio'; command: string; args: string[]; cwd: string; env: string[]; timeoutMs: number;
} | {
  name: string; protocol: McpProtocol; transport: 'http'; url: string; tokenEnv: string | null; allowRemote: boolean; timeoutMs: number;
};
export function validateMcpConnection(v: unknown): asserts v is McpConnection {
  if (!isRecord(v)) extensionError('Invalid MCP connection.');
  extText(v.name, 100); if (!['2026-07-28', '2025-11-25'].includes(v.protocol as string)) extensionError('Choose explicitly supported MCP protocol 2026-07-28 or 2025-11-25; no automatic fallback.');
  if (!Number.isSafeInteger(v.timeoutMs) || (v.timeoutMs as number) < 50 || (v.timeoutMs as number) > 60000) extensionError('MCP timeout must be 50..60000 ms.');
  if (v.transport === 'stdio') {
    exactObject(v, ['name', 'protocol', 'transport', 'command', 'args', 'cwd', 'env', 'timeoutMs']); extText(v.command, 4096); extText(v.cwd, 4096);
    const absolute = (p: string) => isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p);
    if (!absolute(v.command) || !absolute(v.cwd) || /[\x00-\x1f]/.test(v.command + v.cwd)) extensionError('Use explicit installed executable and working-directory paths.');
    const base = v.command.split(/[\\/]/).pop()!.toLowerCase();
    if (/\.(cmd|bat|ps1|sh)$/i.test(base) || /^(?:cmd|powershell|pwsh|bash|sh|zsh|npx|npm|pnpm|yarn|uvx)(?:\.exe)?$/.test(base)) extensionError('Shell and auto-install launchers are not supported. Use a trusted installed executable directly.');
    if (!Array.isArray(v.args) || v.args.length > 32) extensionError('Invalid process arguments.'); for (const a of v.args) { extText(a, 4000, true); if (/[\x00-\x1f]/.test(a) || /^--?(eval|e|print|p|command|c)$/i.test(a)) extensionError('No inline executable code/control characters in arguments.'); }
    if (!Array.isArray(v.env) || v.env.length > 20 || new Set(v.env).size !== v.env.length || v.env.some(n => typeof n !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(n) || /^(NODE_OPTIONS|LD_|DYLD_|PYTHONPATH)/i.test(n))) extensionError('Use an explicit safe environment-name allowlist.');
  } else if (v.transport === 'http') {
    exactObject(v, ['name', 'protocol', 'transport', 'url', 'tokenEnv', 'allowRemote', 'timeoutMs']); extText(v.url, 2048);
    let url: URL; try { url = new URL(v.url); } catch { extensionError('Invalid MCP endpoint.'); }
    if (/[\s\\]/.test(v.url) || url!.username || url!.password || url!.search || url!.hash || !['http:', 'https:'].includes(url!.protocol)) extensionError('MCP endpoint cannot include URL credentials, query or fragment.');
    if (typeof v.allowRemote !== 'boolean') extensionError('Explicit remote setting required.');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url!.hostname) && (url!.protocol !== 'https:' || !v.allowRemote)) extensionError('Remote MCP requires explicitly authorized HTTPS.');
    if (v.tokenEnv !== null && (typeof v.tokenEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(v.tokenEnv))) extensionError('Use a token environment-variable NAME only.');
  } else extensionError('Only stdio and Streamable HTTP are supported.');
  boundedExtension(v, 24000);
}
export interface McpTool { name: string; description: string; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> | null; annotations: Record<string, unknown>; hash: string }
export interface McpResource { uri: string; name: string; description: string; mimeType: string | null; hash: string }
export interface McpCatalog { version: 'mcp-catalog-v1'; tools: McpTool[]; resources: McpResource[]; excluded: { name: string; reason: string }[]; hash: string }
export interface McpSelection { serverId: string; catalogId: string; kind: 'tool' | 'resource'; name: string; arguments: Record<string, unknown>; permission: 'read' | 'compute'; }
export interface ApprovedMcpCall extends McpSelection { config: McpConnection; serverHash: string; trustId: string; descriptor: McpTool | McpResource; }
export interface WorkflowExtensions { skills: SkillSelection[]; calls: McpSelection[]; chapterDrafting: boolean; }
export interface CapturedExtensions { skills: LoadedSkill[]; calls: ApprovedMcpCall[]; chapterDrafting: boolean; version: 'extensions-v1' }
export function validateWorkflowExtensions(v: unknown): asserts v is WorkflowExtensions {
  exactObject(v, ['skills', 'calls', 'chapterDrafting']); if (typeof v.chapterDrafting !== 'boolean' || !Array.isArray(v.skills) || v.skills.length > 3 || !Array.isArray(v.calls) || v.calls.length > 5) extensionError('Too many skill/tool selections.');
  if(new Set(v.skills.map(s=>isRecord(s)?s.id:undefined)).size!==v.skills.length)extensionError('Duplicate skill selections.');
  for (const s of v.skills) { exactObject(s, ['id', 'references']); extText(s.id, 200); if (!Array.isArray(s.references) || s.references.length > 8) extensionError('Too many references.'); for (const r of s.references) { exactObject(r, ['path', 'startLine', 'endLine']); extText(r.path, 200); safeSkillPath(r.path); if (!Number.isSafeInteger(r.startLine) || !Number.isSafeInteger(r.endLine) || (r.startLine as number) < 1 || (r.endLine as number) < (r.startLine as number)) extensionError('Invalid skill reference lines.'); } }
  for (const c of v.calls) { exactObject(c, ['serverId', 'catalogId', 'kind', 'name', 'arguments', 'permission']); extText(c.serverId, 200); extText(c.catalogId, 200); extText(c.name, 2048); if (!['tool', 'resource'].includes(c.kind as string) || !['read', 'compute'].includes(c.permission as string) || !isRecord(c.arguments)) extensionError('Only explicitly approved read/compute calls.'); if (c.kind === 'resource' && Object.keys(c.arguments).length) extensionError('Resource reads use the exact approved URI, no extra arguments.'); boundedExtension(c.arguments, 16000); }
  boundedExtension(v, 100000);
}
