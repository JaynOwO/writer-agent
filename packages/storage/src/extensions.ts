// SPDX-License-Identifier: Apache-2.0
import type { DatabaseSync } from 'node:sqlite';
import { WriterError, newId, hashBytes, workflowHash, makeSkillPackage, validateWorkflowExtensions, validateLoadedSkills,
  validateMcpConnection, validateToolArguments, inspectToolSchema, toolHeaders, lineRange, indexResearch, planEvidence, RESEARCH_INDEX_VERSION,
  mapCitations, renderCitedDraft, exactObject, extText, isRecord, boundedExtension, validateWorkflowOutput } from '@writer-agent/core';
import type { SkillPackage, SkillSelection, LoadedSkill, McpConnection, McpCatalog, McpTool,
  WorkflowExtensions, CapturedExtensions, ApprovedMcpCall, ResearchIndex, SourceContextItem, WorkflowArtifact,
  DraftOutput, WorkflowContentRequest, CitationMap } from '@writer-agent/core';
import type { Workspace } from './index.js';

type Row = Record<string, unknown>;
function unpack<T>(row: Row | undefined): T {
  if (!row) throw new WriterError('NOT_FOUND', 'Extension record not found.');
  if (typeof row.payload !== 'string' || typeof row.payload_hash !== 'string' || hashBytes(row.payload) !== row.payload_hash) throw new WriterError('CORRUPT_DATA', 'Extension record failed integrity verification.');
  try { return JSON.parse(row.payload) as T; } catch { throw new WriterError('CORRUPT_DATA', 'Invalid extension JSON.'); }
}
const now = () => new Date().toISOString();
export interface StoredSkill { id: string; package: SkillPackage; createdAt: string; }
export interface StoredServer { id: string; config: McpConnection; launchHash: string; createdAt: string; }
export interface StoredCatalog { id: string; serverId: string; catalog: McpCatalog; createdAt: string; }
export interface CitationRecord { id: string; artifactId: string; documentId: string | null; revisionId: string | null; map: CitationMap; sources: unknown[]; createdAt: string }
/** Local host state, never passed to a model or MCP server. */
export class ExtensionStore {
  constructor(private readonly db: DatabaseSync, private readonly ready: () => void, private readonly tx: <T>(fn: () => T) => T, private readonly host: Workspace) {}
  private insert(table: string, id: string, value: unknown, columns: Record<string, string | number | null> = {}) {
    boundedExtension(value, 6_000_000); const payload = JSON.stringify(value), keys = ['id', ...Object.keys(columns), 'payload', 'payload_hash'];
    this.db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(id, ...Object.values(columns), payload, hashBytes(payload));
  }
  private read<T>(table: string, id: string): T { this.ready(); extText(id, 200); return unpack<T>(this.db.prepare(`SELECT payload,payload_hash FROM ${table} WHERE id=?`).get(id)); }
  importSkill(pkg: SkillPackage): StoredSkill {
    this.ready(); const checked = makeSkillPackage(pkg.metadata.name, pkg.files); if (workflowHash(checked) !== workflowHash(pkg)) throw new WriterError('EXTENSION_INVALID', 'Package metadata/body is not derived from its saved files.');
    return this.tx(() => {
      const old = this.db.prepare('SELECT payload,payload_hash FROM skill_packages WHERE content_hash=?').get(pkg.hash); if (old) return unpack<StoredSkill>(old);
      const value = { id: newId('skill'), package: pkg, createdAt: now() }; this.insert('skill_packages', value.id, value, { name: pkg.metadata.name, content_hash: pkg.hash }); return value;
    });
  }
  skill(id: string): StoredSkill { const value = this.read<StoredSkill>('skill_packages', id); if (workflowHash(makeSkillPackage(value.package.metadata.name, value.package.files)) !== workflowHash(value.package)) throw new WriterError('CORRUPT_DATA', 'Stored skill content/metadata mismatch.'); return value; }
  skills(): (StoredSkill & { enabled: boolean })[] { this.ready(); return this.db.prepare('SELECT id FROM skill_packages ORDER BY rowid DESC LIMIT 200').all().map(r => ({ ...this.skill(String(r.id)), enabled: this.skillEnabled(String(r.id)) })); }
  private skillActivation(id:string): string|null {this.ready();const row=this.db.prepare('SELECT id,enabled,payload,payload_hash FROM skill_decisions WHERE package_id=? ORDER BY seq DESC LIMIT 1').get(id);if(!row)return null;const decision=unpack<{enabled:boolean}>(row);if(Number(decision.enabled)!==row.enabled)throw new WriterError('CORRUPT_DATA','Skill state differs from its decision record.');return decision.enabled?String(row.id):null;}
  skillEnabled(id: string): boolean { return this.skillActivation(id)!==null; }
  setSkill(id: string, enabled: boolean): void {
    this.ready(); if(typeof enabled!=='boolean')throw new WriterError('EXTENSION_INVALID','Explicit boolean required.'); this.tx(() => {
      const pkg = this.skill(id);
      // Activating a replacement does not grant old task permissions to that new version.
      if (enabled) for (const row of this.db.prepare('SELECT id FROM skill_packages WHERE name=? AND id!=?').all(pkg.package.metadata.name, id)) {
        if (this.skillEnabled(String(row.id))) this.insert('skill_decisions', newId('skilldecision'), { enabled: false, reason: 'Replaced by explicitly enabled version.', createdAt: now() }, { package_id: String(row.id), enabled: 0 });
      }
      this.insert('skill_decisions', newId('skilldecision'), { enabled, createdAt: now() }, { package_id: id, enabled: enabled ? 1 : 0 });
    });
  }
  loadSkills(selections: SkillSelection[]): LoadedSkill[] {
    this.ready(); const loaded = selections.map(s => {
      const value = this.skill(s.id); if (!this.skillEnabled(s.id)) throw new WriterError('EXTENSION_PERMISSION', 'Selected skill is disabled or was replaced; reselect and reauthorize.');
      const references = s.references.map(ref => {
        const file = value.package.files.find(f => f.path === ref.path); if (!file || ref.path === 'SKILL.md') throw new WriterError('EXTENSION_INVALID', 'Unknown reference path.');
        const r = lineRange(file.text, ref.startLine, ref.endLine); return { ...ref, text: r.quote, hash: r.quoteHash };
      });
      return { id: value.id, activationId:this.skillActivation(value.id)!, hash: value.package.hash, name: value.package.metadata.name, body: value.package.body, compatibility:value.package.metadata.compatibility,support:'instruction-text-only' as const,allowedTools: value.package.metadata.allowedTools, references };
    });
    validateLoadedSkills(loaded); return loaded;
  }
  registerServer(config: McpConnection, launchHash: string): StoredServer {
    this.ready(); validateMcpConnection(config); if (!/^[0-9a-f]{64}$/.test(launchHash)) throw new WriterError('EXTENSION_INVALID', 'Missing host launch fingerprint.');
    const s = { id: newId('mcp'), config: structuredClone(config), launchHash, createdAt: now() }; this.tx(() => this.insert('mcp_servers', s.id, s)); return s;
  }
  server(id: string): StoredServer { const value = this.read<StoredServer>('mcp_servers', id); validateMcpConnection(value.config); return value; }
  servers(): (StoredServer & { trusted: boolean })[] { this.ready(); return this.db.prepare('SELECT id FROM mcp_servers ORDER BY rowid DESC LIMIT 100').all().map(r => ({ ...this.server(String(r.id)), trusted: this.trust(String(r.id)) !== null })); }
  trust(id: string): string | null {
    this.ready(); const r = this.db.prepare('SELECT id,enabled,payload,payload_hash FROM mcp_trust WHERE server_id=? ORDER BY seq DESC LIMIT 1').get(id); if (!r) return null;
    const decision=unpack<{enabled:boolean}>(r);if(typeof decision.enabled!=='boolean'||Number(decision.enabled)!==r.enabled)throw new WriterError('CORRUPT_DATA','Trust flag differs from its author record.');return decision.enabled ? String(r.id) : null;
  }
  setTrust(id: string, enabled: boolean): void { this.ready(); if(typeof enabled!=='boolean')throw new WriterError('EXTENSION_INVALID','Explicit boolean required.'); this.server(id); this.tx(() => this.insert('mcp_trust', newId('trust'), { enabled, warning: 'Author trusts execution/connection; this is not an OS sandbox or tool approval.', createdAt: now() }, { server_id: id, enabled: enabled ? 1 : 0 })); }
  saveCatalog(serverId: string, c: McpCatalog): StoredCatalog {
    this.ready(); this.server(serverId); if (!this.trust(serverId)) throw new WriterError('EXTENSION_PERMISSION', 'Connection trust was revoked.');
    exactObject(c, ['version','tools','resources','excluded','hash']); if (c.version !== 'mcp-catalog-v1' || !Array.isArray(c.tools) || c.tools.length > 100 || !Array.isArray(c.resources) || c.resources.length > 100) throw new WriterError('EXTENSION_INVALID', 'Invalid catalogue.');
    for (const t of c.tools) { const { hash, ...body } = t; if (hashBytes(JSON.stringify(body)) !== hash) throw new WriterError('EXTENSION_INVALID', 'Tool descriptor hash mismatch.'); inspectToolSchema(t.inputSchema); toolHeaders(t.inputSchema, {}); if (t.outputSchema) inspectToolSchema(t.outputSchema); }
    for (const r of c.resources) { const { hash, ...body } = r; if (hashBytes(JSON.stringify(body)) !== hash) throw new WriterError('EXTENSION_INVALID', 'Resource descriptor hash mismatch.'); }
    if (c.hash !== hashBytes(JSON.stringify({ tools: c.tools.map(t => t.hash), resources: c.resources.map(r => r.hash) }))) throw new WriterError('EXTENSION_INVALID', 'Catalogue hash mismatch.');
    const value = { id: newId('catalog'), serverId, catalog: structuredClone(c), createdAt: now() }; this.tx(() => this.insert('mcp_catalogs', value.id, value, { server_id: serverId })); return value;
  }
  catalog(id: string): StoredCatalog { return this.read<StoredCatalog>('mcp_catalogs', id); }
  latestCatalog(serverId: string): StoredCatalog | null { this.ready(); const row = this.db.prepare('SELECT payload,payload_hash FROM mcp_catalogs WHERE server_id=? ORDER BY seq DESC LIMIT 1').get(serverId); return row ? unpack<StoredCatalog>(row) : null; }
  capture(options: WorkflowExtensions): CapturedExtensions {
    this.ready(); validateWorkflowExtensions(options); const skills = this.loadSkills(options.skills);
    const calls: ApprovedMcpCall[] = options.calls.map(c => {
      const server = this.server(c.serverId), trustId = this.trust(server.id); if (!trustId) throw new WriterError('EXTENSION_PERMISSION', 'MCP server is not trusted or was revoked.');
      const catalog = this.catalog(c.catalogId); if (catalog.serverId !== server.id) throw new WriterError('EXTENSION_INVALID', 'Cross-server catalogue.');
      const descriptor = c.kind === 'tool' ? catalog.catalog.tools.find(t => t.name === c.name) : catalog.catalog.resources.find(r => r.uri === c.name);
      if (!descriptor) throw new WriterError('EXTENSION_INVALID', 'Unknown or excluded MCP descriptor.');
      const selectedSeq=this.db.prepare('SELECT seq FROM mcp_catalogs WHERE id=?').get(c.catalogId)!.seq;
      for(const row of this.db.prepare('SELECT payload,payload_hash FROM mcp_catalogs WHERE server_id=? AND seq>? ORDER BY seq').all(server.id,selectedSeq as number)){
        const observed=unpack<StoredCatalog>(row).catalog;const prior=c.kind==='tool'?observed.tools.find(t=>t.name===c.name):observed.resources.find(r=>r.uri===c.name);
        if(!prior||prior.hash!==descriptor.hash)throw new WriterError('EXTENSION_PERMISSION','This descriptor changed after the selected catalogue; reselect its current version, even if its text later changed back.');
      }
      const current = this.latestCatalog(server.id)?.catalog; const latest = c.kind === 'tool' ? current?.tools.find(t => t.name === c.name) : current?.resources.find(r => r.uri === c.name);
      if (!latest || latest.hash !== descriptor.hash) throw new WriterError('EXTENSION_PERMISSION', 'Descriptor changed; select the new version and reauthorize.');
      if (c.kind === 'tool') { if((descriptor as McpTool).annotations.destructiveHint===true)throw new WriterError('EXTENSION_PERMISSION','Destructive-declared tools cannot be authorized for automatic read/compute workflows.'); validateToolArguments((descriptor as McpTool).inputSchema, c.arguments); }
      const toolId = `${server.id}/${c.name}`;
      for (const skill of skills) if (skill.allowedTools.length && !skill.allowedTools.includes(toolId) && !skill.allowedTools.includes(c.name)) throw new WriterError('EXTENSION_PERMISSION', 'Selected tool falls outside a selected skill allowed-tools restriction.');
      return { serverId:c.serverId,catalogId:c.catalogId,name:c.name,kind:c.kind,arguments:structuredClone(c.arguments),permission:c.permission,config:server.config,serverHash:server.launchHash,trustId,descriptor };
    });
    return { version: 'extensions-v1', skills, calls, chapterDrafting: options.chapterDrafting };
  }
  assertCall(call: ApprovedMcpCall): void {
    const fresh = this.capture({ skills: [], calls: [{ serverId: call.serverId, catalogId: call.catalogId, name: call.name, kind: call.kind, arguments: call.arguments, permission: call.permission }], chapterDrafting: false }).calls[0]!;
    if (workflowHash(fresh) !== workflowHash(call)) throw new WriterError('EXTENSION_PERMISSION', 'MCP approval input changed.');
  }
  index(snapshotId: string): ResearchIndex {
    this.ready(); const snapshot = this.host.sources.snapshot(snapshotId), key = hashBytes(`${RESEARCH_INDEX_VERSION}:${snapshotId}:${snapshot.textHash}`);
    const row = this.db.prepare('SELECT payload,payload_hash FROM research_indexes WHERE cache_key=?').get(key); if (row) { const index = unpack<ResearchIndex>(row); if (index.textHash !== snapshot.textHash || index.snapshotId !== snapshotId) throw new WriterError('CORRUPT_DATA', 'Index identity mismatch.'); return index; }
    const index = indexResearch(snapshotId, snapshot.text), payload = JSON.stringify(index);
    this.tx(() => this.db.prepare('INSERT OR IGNORE INTO research_indexes(cache_key,snapshot_id,payload,payload_hash) VALUES(?,?,?,?)').run(key, snapshotId, payload, hashBytes(payload))); return index;
  }
  evidence(snapshotId: string, query: string, maxBytes = 8000, maxWindows = 2): { plan: ReturnType<typeof planEvidence>; items: SourceContextItem[] } {
    this.ready(); const snapshot = this.host.sources.snapshot(snapshotId), plan = planEvidence(this.index(snapshotId), snapshot.text, query, maxBytes, maxWindows);
    return this.tx(() => ({ plan, items: plan.windows.map(w => {
      const existing = this.db.prepare('SELECT id FROM source_excerpts WHERE snapshot_id=? AND start_line=? AND end_line=? ORDER BY rowid LIMIT 1').get(snapshotId, w.startLine, w.endLine);
      const id = existing ? String(existing.id) : this.host.sources.extract(snapshotId, w.startLine, w.endLine).id;
      return this.host.sources.context({ excerpts: [id] })[0]!;
    }) }));
  }
  saveToolSource(call: ApprovedMcpCall, attemptId: string, result: { text: string; raw: unknown }) {
    this.ready(); this.assertCall(call); extText(result.text, 200000); boundedExtension(result, 256000);
    // Existing file means imported bytes at the storage level; explicit provenance prevents local-file/web masquerading.
    return this.tx(() => {
      const saved = this.host.sources.add({ kind: 'file', locator: `mcp-result-${attemptId}.txt`, raw: Buffer.from(result.text), mediaType: 'text/plain' });
      const provenance = { kind: 'mcp', serverId: call.serverId, name: call.name, operation: call.kind, descriptorHash: call.descriptor.hash, attemptId, interpretation: 'external-service-unverified', rawResult: result.raw };
      const payload = JSON.stringify(provenance); this.db.prepare('INSERT INTO source_provenance(snapshot_id,payload,payload_hash) VALUES(?,?,?)').run(saved.snapshot.id, payload, hashBytes(payload)); return saved;
    });
  }
  sourceProvenance(snapshotId: string): unknown | null { this.ready(); this.host.sources.snapshot(snapshotId); const r = this.db.prepare('SELECT payload,payload_hash FROM source_provenance WHERE snapshot_id=?').get(snapshotId); return r ? unpack(r) : null; }
  candidateCitations(artifact: WorkflowArtifact): void {
    this.ready(); if (!isRecord(artifact.value) || !isRecord(artifact.value.output) || !['draft','draft-revision'].includes(String(artifact.value.output.task))) return;
    const value = artifact.value as unknown as { output: DraftOutput; request: WorkflowContentRequest }; validateWorkflowOutput(value.output, value.request); this.host.sources.verifyContext(value.request.sources);
    const map = mapCitations(value.output, value.request.sources); const sources = value.request.sources.map(s => ({ ...s, metadata: this.host.sources.snapshot(s.snapshotId).metadata, capturedAt: this.host.sources.snapshot(s.snapshotId).capturedAt, provenance: this.sourceProvenance(s.snapshotId) }));
    const record: CitationRecord = { id: newId('citations'), artifactId: artifact.id, documentId: null, revisionId: null, map, sources, createdAt: now() };
    this.insert('citation_maps', record.id, record, { artifact_id: artifact.id, document_id: null, revision_id: null });
  }
  adoptCitations(artifact: WorkflowArtifact, documentId: string): void {
    this.ready(); const value = artifact.value as { output: DraftOutput; request: WorkflowContentRequest }, doc = this.host.currentRevision(documentId);
    const rendered = renderCitedDraft(value.output, value.request.sources);
    if (this.host.markdown(documentId) !== rendered.markdown) throw new WriterError('CORRUPT_DATA', 'Adopted text differs from citation-rendered candidate.');
    const prior = this.db.prepare('SELECT payload,payload_hash FROM citation_maps WHERE artifact_id=? AND document_id IS NULL').get(artifact.id); if (!prior) throw new WriterError('CORRUPT_DATA', 'Candidate citation map missing.');
    const candidate = unpack<CitationRecord>(prior), id = newId('citations'); const record: CitationRecord = { ...candidate, id, documentId, revisionId: doc.id, map: { ...rendered.map, manuscriptHash: hashBytes(rendered.markdown) }, createdAt: now() };
    this.insert('citation_maps', id, record, { artifact_id: artifact.id, document_id: documentId, revision_id: doc.id });
  }
  citations(target: string): (CitationRecord & { freshness: 'current' | 'stale'; note: string })[] {
    this.ready(); extText(target, 200); return this.db.prepare('SELECT payload,payload_hash FROM citation_maps WHERE artifact_id=? OR document_id=? ORDER BY rowid').all(target, target).map(r => {
      const v = unpack<CitationRecord>(r); const freshness = v.documentId && this.host.getDocument(v.documentId).headRevisionId !== v.revisionId ? 'stale' : 'current';
      return { ...v, freshness, note: 'Anchor/reference structure, not a verdict that a source supports the sentence. Candidate references remain pinned to that candidate.' };
    });
  }
}
