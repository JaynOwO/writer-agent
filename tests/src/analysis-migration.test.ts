// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace, migrateWorkspace } from '@writer-agent/storage';
import { temporary, propose, expectCode } from './helpers.js';
import { candidate } from './analysis-helpers.js';
const { SCHEMA_V1_SQL } = await import(new URL('../../packages/storage/dist/schema.js', import.meta.url).href) as {
    SCHEMA_V1_SQL: string;
};
const { SOURCES_SQL } = await import(new URL('../../packages/storage/dist/source-schema.js', import.meta.url).href) as {
    SOURCES_SQL: string;
};
function legacy(t: Parameters<typeof temporary>[0], version: 1 | 2) {
    const root = join(temporary(t), 'legacy 数据');
    mkdirSync(join(root, '.writer'), { recursive: true });
    const path = join(root, '.writer/workspace.sqlite'), db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode=WAL;' + SCHEMA_V1_SQL + (version === 2 ? SOURCES_SQL + 'PRAGMA user_version=2;' : ''));
    db.prepare('INSERT INTO workspace(id,name,created_at) VALUES(?,?,?)').run('legacy_id', 'legacy', '2026-01-01');
    db.close();
    const w = Workspace.open(root), d = w.createDocument('old', '可能成立。\n\n保留。'), c = propose(w, d.id, 0, '成立。');
    w.accept(c.id, 'old decision');
    w.revert(c.id);
    if (version === 2) {
        const s = w.sources.add({ kind: 'file', locator: 'keep.txt', raw: Buffer.from('old material'), mediaType: 'text/plain' });
        const e = w.sources.extract(s.snapshot.id, 1, 1);
        w.sources.note(s.snapshot.id, 'keep note', e.id);
        w.sources.bind(d.id, w.currentRevision(d.id).snapshot.blocks[0]!.id, e.id);
    }
    w.close();
    return { root, path, d };
}
function rows(path: string) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name!='sqlite_sequence' ORDER BY name").all().map(r => String(r.name));
        return Object.fromEntries(tables.map(t => [t, db.prepare('SELECT * FROM ' + t).all()]));
    }
    finally {
        db.close();
    }
}
for (const version of [1, 2] as const) {
    test(`schema v${version} preview and old workflows do not implicitly enable analysis`, t => { const { root, path } = legacy(t, version), before = rows(path); assert.equal(migrateWorkspace(root).to, 7); assert.deepEqual(rows(path), before); assert.equal(existsSync(join(root, '.writer/backups')), false); const w = Workspace.open(root); try {
        assert.equal(w.info().schemaVersion, version);
        expectCode(() => w.analysis.list(w.listDocuments()[0]!.id), 'MIGRATION_REQUIRED');
    }
    finally {
        w.close();
    } });
    test(`schema v${version} -> v7 preserves all original rows and verifies a v${version} backup`, t => {
        const { root, path, d } = legacy(t, version), before = rows(path), m = migrateWorkspace(root, true);
        assert.equal(m.from, version);
        assert.equal(m.to, 7);
        assert.ok(m.backup);
        const backupRows = rows(m.backup);
        assert.deepEqual(backupRows, before);
        const after = rows(path);
        for (const [table, records] of Object.entries(before))
            assert.deepEqual(after[table], records, table);
        const w = Workspace.open(root);
        try {
            assert.equal(w.info().schemaVersion, 7);
            w.analysis.add(d.id, candidate(w.currentRevision(d.id).snapshot));
            assert.equal(w.history(d.id).length, 3);
        }
        finally {
            w.close();
        }
        assert.equal(migrateWorkspace(root, true).needed, false);
        assert.equal(readdirSync(join(root, '.writer/backups')).length, 1);
    });
}
test('v2 migration DDL failure rolls back all analysis tables and retains backup', t => { const { root, path } = legacy(t, 2), db = new DatabaseSync(path); db.exec('CREATE TABLE analysis_runs(dummy TEXT)'); db.close(); const before = rows(path); expectCode(() => migrateWorkspace(root, true), 'CORRUPT_DATA'); assert.deepEqual(rows(path), before); const check = new DatabaseSync(path); assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 2); assert.equal(check.prepare("SELECT count(*) n FROM sqlite_master WHERE name='ledger_claims'").get()?.n, 0); check.close(); assert.equal(readdirSync(join(root, '.writer/backups')).length, 1); assert.equal(existsSync(join(root, '.writer/migration.lock')), false); });
test('future schema v8 is rejected, not silently downgraded to v7', t => { const { root, path } = legacy(t, 2), db = new DatabaseSync(path); db.exec('PRAGMA user_version=8'); db.close(); expectCode(() => Workspace.open(root), 'UNSUPPORTED_SCHEMA'); expectCode(() => migrateWorkspace(root, true), 'UNSUPPORTED_SCHEMA'); });
