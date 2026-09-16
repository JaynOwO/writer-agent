// SPDX-License-Identifier: Apache-2.0
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, lstatSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exactObject, isRecord, validateWorkflowModel, validateMcpConnection, workflowHash, requireString } from '@writer-agent/core';
import type { WorkflowModel, McpConnection, ConnectionRef, WorkflowConfig } from '@writer-agent/core';
import type { Workspace } from '@writer-agent/storage';
import { ProductError, checkKey, checkSecretId, secretId, OsSecretStore, credentialSelfTest } from './secrets.js';
import type { SecretStore } from './secrets.js';
export type PresetSettings = {
    kind: 'model';
    model: WorkflowModel;
} | {
    kind: 'search';
    endpoint: 'https://api.tavily.com/search';
} | {
    kind: 'mcp';
    connection: McpConnection;
};
export type CredentialSpec = {
    mode: 'none';
} | {
    mode: 'env';
    name: string;
} | {
    mode: 'system';
    id: string;
} | {
    mode: 'session';
    id: string;
};
export interface ConnectionPreset {
    id: string;
    version: string;
    name: string;
    settings: PresetSettings;
    credential: CredentialSpec;
    enabled: boolean;
    createdAt: string;
}
const sessions = new Map<string, string>();
export function defaultAppDirectory(): string {
    if (process.platform === 'win32')
        return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Siglum');
    if (process.platform === 'darwin')
        return join(homedir(), 'Library', 'Application Support', 'Siglum');
    return join(process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.startsWith('/') ? process.env.XDG_CONFIG_HOME : join(homedir(), '.config'), 'siglum');
}
function id(prefix: string): string { return prefix + '_' + randomUUID().replaceAll('-', ''); }
function realPath(path: string) { if (existsSync(path)) {
    const s = lstatSync(path);
    if (s.isSymbolicLink())
        throw new ProductError('CONFIG_PATH', 'Symlink configuration paths are refused.');
} }
function nonsecretInput(name: string, settings: unknown): asserts settings is PresetSettings {
    requireString(name, 'connection name', 200);
    if (!isRecord(settings))
        throw new ProductError('PRESET_INVALID', 'Invalid connection settings.');
    if (settings.kind === 'model') {
        exactObject(settings, ['kind', 'model']);
        validateWorkflowModel(settings.model);
        if (settings.model.apiKeyEnv !== null)
            throw new ProductError('PRESET_INVALID', 'Select credential mode separately; model apiKeyEnv must be null.');
    }
    else if (settings.kind === 'search') {
        exactObject(settings, ['kind', 'endpoint']);
        if (settings.endpoint !== 'https://api.tavily.com/search')
            throw new ProductError('PRESET_INVALID', 'Search preset must target the fixed Tavily endpoint.');
    }
    else if (settings.kind === 'mcp') {
        exactObject(settings, ['kind', 'connection']);
        validateMcpConnection(settings.connection);
        if (settings.connection.transport === 'http' && settings.connection.tokenEnv !== null)
            throw new ProductError('PRESET_INVALID', 'Select credential mode separately; MCP tokenEnv must be null.');
    }
    else
        throw new ProductError('PRESET_INVALID', 'Unknown preset kind.');
    if (Buffer.byteLength(JSON.stringify(settings)) > 64000)
        throw new ProductError('PRESET_INVALID', 'Settings exceed size budget.');
}
function decode(row: Record<string, unknown>): ConnectionPreset {
    if (typeof row.payload !== 'string' || row.hash !== workflowHash(row.payload))
        throw new ProductError('CONFIG_CORRUPT', 'Invalid local preset record.');
    const p = JSON.parse(row.payload) as ConnectionPreset;
    exactObject(p, ['id', 'version', 'name', 'settings', 'credential', 'enabled', 'createdAt']);
    nonsecretInput(p.name, p.settings);
    if (!/^preset_[a-f0-9]{32}$/.test(p.id) || !/^pv_[a-f0-9]{32}$/.test(p.version) || typeof p.enabled !== 'boolean')
        throw new ProductError('CONFIG_CORRUPT', 'Malformed preset identity.');
    const c = p.credential;
    exactObject(c, c.mode === 'none' ? ['mode'] : c.mode === 'env' ? ['mode', 'name'] : ['mode', 'id']);
    if (c.mode === 'system' || c.mode === 'session')
        checkSecretId(c.id);
    else if (c.mode === 'env' && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(c.name))
        throw new ProductError('CONFIG_CORRUPT', 'Bad environment reference.');
    else if (!['none', 'env'].includes(c.mode))
        throw new ProductError('CONFIG_CORRUPT', 'Unknown credential mode.');
    return p;
}
/** User-local nonsecret configuration. It is never implicitly created by diagnostics. */
export class ConnectionStore {
    readonly path: string;
    constructor(readonly directory = defaultAppDirectory(), readonly secrets: SecretStore = new OsSecretStore()) { this.directory = resolve(directory); this.path = join(this.directory, 'connections.sqlite'); }
    private open(write = false): DatabaseSync | null {
        let parent = this.directory;
        for (;;) {
            realPath(parent);
            const next = dirname(parent);
            if (next === parent)
                break;
            parent = next;
        }
        realPath(this.path);
        if (!existsSync(this.path) && !write)
            return null;
        if (!existsSync(this.directory)) {
            if (!write)
                return null;
            mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        }
        const fresh = !existsSync(this.path), db = new DatabaseSync(this.path, { readOnly: !write, timeout: 2000 });
        try {
            if (fresh) {
                db.exec(`BEGIN IMMEDIATE; PRAGMA application_id=1397181516; PRAGMA user_version=1;
      CREATE TABLE presets(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL,version TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,hash TEXT NOT NULL);
      CREATE TABLE bindings(workspace TEXT NOT NULL,run_id TEXT NOT NULL,slot TEXT NOT NULL,version TEXT NOT NULL,settings_hash TEXT NOT NULL,PRIMARY KEY(workspace,run_id,slot));
      CREATE TABLE secret_operations(id TEXT PRIMARY KEY NOT NULL,secret_id TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE probes(id TEXT PRIMARY KEY NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TRIGGER presets_no_update BEFORE UPDATE ON presets BEGIN SELECT RAISE(ABORT,'append-only'); END;
      CREATE TRIGGER presets_no_delete BEFORE DELETE ON presets BEGIN SELECT RAISE(ABORT,'append-only'); END; COMMIT;`);
                if (process.platform !== 'win32')
                    chmodSync(this.path, 0o600);
            }
            if (db.prepare('PRAGMA user_version').get()?.user_version !== 1 || db.prepare('PRAGMA application_id').get()?.application_id !== 1397181516) {
                db.close();
                throw new ProductError('CONFIG_SCHEMA', 'Unknown local configuration format.');
            }
            if (write)
                db.exec('PRAGMA synchronous=FULL;');
            return db;
        }
        catch (e) {
            try {
                db.close();
            }
            catch { }
            throw e;
        }
    }
    list(): ConnectionPreset[] { const db = this.open(); if (!db)
        return []; try {
        return db.prepare('SELECT * FROM presets WHERE seq IN (SELECT max(seq) FROM presets GROUP BY id) ORDER BY seq').all().map(decode);
    }
    finally {
        db.close();
    } }
    get(ref: ConnectionRef): ConnectionPreset {
        const p = this.list().find(p => p.id === ref.id);
        if (!p || p.version !== ref.version || !p.enabled)
            throw new ProductError('PRESET_STALE', 'Connection was removed, changed or is not registered locally. Re-select and authorize it.');
        return p;
    }
    private insert(p: ConnectionPreset, expected: ConnectionRef | null) { const db = this.open(true)!; try {
        db.exec('BEGIN IMMEDIATE');
        if (expected) {
            const old = db.prepare('SELECT version FROM presets WHERE id=? ORDER BY seq DESC LIMIT 1').get(expected.id);
            if (old?.version !== expected.version)
                throw new ProductError('PRESET_STALE', 'Connection changed concurrently.');
        }
        const text = JSON.stringify(p);
        db.prepare('INSERT INTO presets(id,version,payload,hash) VALUES(?,?,?,?)').run(p.id, p.version, text, workflowHash(text));
        db.exec('COMMIT');
    }
    catch (e) {
        try {
            db.exec('ROLLBACK');
        }
        catch { }
        throw e;
    }
    finally {
        db.close();
    } }
    private operation(op: string, secret: string, status: string) { const db = this.open(true)!; try {
        db.prepare('INSERT INTO secret_operations VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status').run(op, secret, status, new Date().toISOString());
    }
    finally {
        db.close();
    } }
    async save(name: string, settings: PresetSettings, mode: 'none' | 'env' | 'system' | 'session', input?: string, replace: ConnectionRef | null = null): Promise<ConnectionPreset> {
        nonsecretInput(name, settings);
        if (replace)
            this.get(replace);
        let credential: CredentialSpec = { mode: 'none' }, op: string | null = null, created = false;
        if (!['none', 'env', 'system', 'session'].includes(mode))
            throw new ProductError('PRESET_INVALID', 'Unknown credential mode.');
        if (mode === 'env') {
            if (!input || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(input))
                throw new ProductError('PRESET_INVALID', 'Expected an environment variable NAME.');
            credential = { mode: 'env', name: input };
        }
        if (settings.kind === 'mcp' && settings.connection.transport === 'stdio' && mode !== 'none')
            throw new ProductError('PRESET_INVALID', 'Stdio uses the explicitly named process environment, not an HTTP credential preset.');
        if (mode === 'system' || mode === 'session') {
            checkKey(input);
            credential = { mode, id: secretId() };
            if (settings.kind === 'mcp' && settings.connection.transport === 'stdio')
                throw new ProductError('PRESET_INVALID', 'System/session tokens are supported for HTTP MCP only; stdio uses its explicitly selected environment names.');
        }
        const preset: ConnectionPreset = { id: replace?.id ?? id('preset'), version: id('pv'), name, settings: structuredClone(settings), credential, enabled: true, createdAt: new Date().toISOString() };
        try {
            if (credential.mode === 'system') {
                op = id('secretop');
                this.operation(op, credential.id, 'pending');
                created = true;
                await this.secrets.write(credential.id, input!);
                this.operation(op, credential.id, 'written');
            }
            if (credential.mode === 'session')
                sessions.set(credential.id, input!);
            this.insert(preset, replace);
            if (op && credential.mode === 'system')
                this.operation(op, credential.id, 'committed');
            return preset;
        }
        catch (e) {
            if (credential.mode === 'system' && op) {
                // A committed preset wins even when journaling after commit failed: never delete its key.
                const committed = this.list().some(p => p.version === preset.version);
                if (!committed) {
                    try {
                        if (created)
                            await this.secrets.remove(credential.id);
                        this.operation(op, credential.id, 'abandoned');
                    }
                    catch {
                        this.operation(op, credential.id, 'cleanup-required');
                    }
                }
            }
            if (credential.mode === 'session')
                sessions.delete(credential.id);
            throw e;
        }
    }
    disable(ref: ConnectionRef): ConnectionPreset { const p = this.get(ref), next = { ...p, version: id('pv'), enabled: false, createdAt: new Date().toISOString() }; this.insert(next, ref); if (p.credential.mode === 'session')
        sessions.delete(p.credential.id); return next; }
    async remove(ref: ConnectionRef) { const p = this.get(ref); this.disable(ref); if (p.credential.mode === 'system') {
        await this.secrets.remove(p.credential.id);
        for (const op of this.pendingSecrets().filter(o => o.secretId === (p.credential as {
            id: string;
        }).id))
            this.operation(String(op.id), String(op.secretId), 'abandoned');
    } return { disabled: true, remoteKeyRevoked: false }; }
    /** Journal the one isolated self-test entry so a failed delete can be recovered explicitly. */
    async testCredentials() {
        const op = id('selftest');
        let owned: string | null = null;
        const backend = this.secrets;
        const wrapper: SecretStore = { backend: backend.backend,
            write: async (key, value) => { if (owned && owned !== key)
                throw new ProductError('CREDENTIAL_REFERENCE', 'Self-test changed its isolated reference.'); if (!owned) {
                this.operation(op, key, 'pending');
                owned = key;
            } await backend.write(key, value); this.operation(op, key, 'written'); },
            read: async (key) => { if (key !== owned)
                throw new ProductError('CREDENTIAL_REFERENCE', 'Self-test reference mismatch.'); return backend.read(key); },
            remove: async (key) => { if (key !== owned)
                throw new ProductError('CREDENTIAL_REFERENCE', 'Self-test reference mismatch.'); const removed = await backend.remove(key); this.operation(op, key, 'abandoned'); return removed; } };
        return credentialSelfTest(wrapper);
    }
    pendingSecrets() { const db = this.open(); if (!db)
        return []; try {
        return db.prepare("SELECT id,secret_id AS secretId,status FROM secret_operations WHERE status!='abandoned' ORDER BY created_at").all().filter(r => !this.list().some(p => p.enabled && p.credential.mode === 'system' && p.credential.id === r.secretId));
    }
    finally {
        db.close();
    } }
    async cleanupSecret(operationId: string) { const r = this.pendingSecrets().find(r => r.id === operationId); if (!r)
        throw new ProductError('CREDENTIAL_REFERENCE', 'No unreferenced Siglum operation selected.'); await this.secrets.remove(String(r.secretId)); this.operation(operationId, String(r.secretId), 'abandoned'); }
    /** Resolves only a locally registered current preset, bound to its exact destination. */
    async resolve(ref: ConnectionRef, settings: PresetSettings): Promise<string | undefined> {
        const p = this.get(ref);
        if (workflowHash(p.settings) !== workflowHash(settings))
            throw new ProductError('PRESET_TARGET', 'Credential destination does not match its preset.');
        const c = p.credential;
        exactObject(c, c.mode === 'none' ? ['mode'] : c.mode === 'env' ? ['mode', 'name'] : ['mode', 'id']);
        if (c.mode === 'none')
            return undefined;
        const value = c.mode === 'system' ? await this.secrets.read(c.id) : c.mode === 'env' ? process.env[c.name] : sessions.get(c.id);
        this.get(ref);
        if (!value)
            throw new ProductError('CREDENTIAL_MISSING', 'Selected credential is absent/expired. No other credential source was tried.');
        checkKey(value);
        return value;
    }
    private workspace(w: Workspace) { return workflowHash({ id: w.info().id, root: resolve(w.root) }); }
    bind(w: Workspace, runId: string, slot: string, ref: ConnectionRef, settings: PresetSettings) { this.get(ref); if (workflowHash(this.get(ref).settings) !== workflowHash(settings))
        throw new ProductError('PRESET_TARGET', 'Settings mismatch.'); const db = this.open(true)!; try {
        db.prepare('INSERT INTO bindings VALUES(?,?,?,?,?) ON CONFLICT(workspace,run_id,slot) DO UPDATE SET version=excluded.version,settings_hash=excluded.settings_hash').run(this.workspace(w), runId, slot, ref.version, workflowHash(settings));
    }
    finally {
        db.close();
    } }
    checkBinding(w: Workspace, runId: string, slot: string, ref: ConnectionRef, settings: PresetSettings) { const p = this.get(ref), db = this.open(); try {
        const b = db?.prepare('SELECT * FROM bindings WHERE workspace=? AND run_id=? AND slot=?').get(this.workspace(w), runId, slot);
        if (!b || b.version !== p.version || b.settings_hash !== workflowHash(settings) || workflowHash(p.settings) !== workflowHash(settings))
            throw new ProductError('PRESET_UNTRUSTED', 'No local author binding for this task and destination. Imported/copied configuration cannot unlock credentials.');
    }
    finally {
        db?.close();
    } }
    async forRun(w: Workspace, runId: string, slot: string, ref: ConnectionRef, settings: PresetSettings, endpoint: string) { this.checkBinding(w, runId, slot, ref, settings); const expected = settings.kind === 'model' ? new URL(settings.model.baseURL.replace(/\/+$/, '') + (settings.model.provider === 'ollama' ? '/api/chat' : '/chat/completions')).href : settings.kind === 'search' ? settings.endpoint : settings.connection.transport === 'http' ? settings.connection.url : ''; const target = new URL(expected); if (target.hostname === 'localhost')
        target.hostname = '127.0.0.1'; if (new URL(endpoint).href !== target.href)
        throw new ProductError('PRESET_TARGET', 'Credential endpoint mismatch.'); const secret = await this.resolve(ref, settings); this.checkBinding(w, runId, slot, ref, settings); return secret; }
    /** Nonsecret probe state. An abandoned dispatched check is visibly outcome-unknown. */
    probeStart(payload: unknown): string { const db = this.open(true)!, key = id('probe'); try {
        db.prepare('INSERT INTO probes VALUES(?,?,?,?)').run(key, 'dispatched', JSON.stringify(payload), new Date().toISOString());
        return key;
    }
    finally {
        db.close();
    } }
    probeFinish(key: string, status: string, payload: unknown) { const db = this.open(true)!; try {
        db.prepare('UPDATE probes SET status=?,payload=?,updated_at=? WHERE id=?').run(status, JSON.stringify(payload), new Date().toISOString(), key);
    }
    finally {
        db.close();
    } }
    probes() { const db = this.open(); if (!db)
        return []; try {
        return db.prepare('SELECT * FROM probes ORDER BY updated_at DESC LIMIT 100').all().map(r => ({ id: r.id, status: r.status === 'dispatched' ? 'outcome-unknown' : r.status, payload: JSON.parse(String(r.payload)), updatedAt: r.updated_at }));
    }
    finally {
        db.close();
    } }
}
export function presetRef(p: ConnectionPreset): ConnectionRef { return { id: p.id, version: p.version }; }
/** Only this explicit author action creates a local mapping; stage grants are then revoked. */
export function attachPreset(w: Workspace, runId: string, p: ConnectionPreset, store: ConnectionStore, serverId?: string) {
    const run = w.workflows.run(runId), config: WorkflowConfig = structuredClone(run.config), ref = presetRef(p);
    config.connectionRefs ??= {};
    if (p.settings.kind === 'model') {
        config.model = structuredClone(p.settings.model);
        config.connectionRefs.model = ref;
    }
    else if (p.settings.kind === 'search')
        config.connectionRefs.search = ref;
    else {
        if (!serverId)
            throw new ProductError('PRESET_TARGET', 'Choose an existing MCP server from this task.');
        const call = run.capture.extensions?.calls.find(c => c.serverId === serverId);
        if (!call || workflowHash(call.config) !== workflowHash(p.settings.connection))
            throw new ProductError('PRESET_TARGET', 'MCP task connection must exactly match the saved preset.');
        config.connectionRefs.mcp = { ...config.connectionRefs.mcp, [serverId]: ref };
    }
    const updated = w.workflows.refresh(runId, config);
    store.bind(w, runId, p.settings.kind === 'mcp' ? 'mcp:' + serverId : p.settings.kind, ref, p.settings);
    return updated;
}
