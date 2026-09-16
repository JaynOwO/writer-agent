// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Workspace } from '@writer-agent/storage';
import { temporary } from './helpers.js';
import { workflowSetup, grant, executeWorkflow } from './workflow-helpers.js';
import { fakeServer, json, wire, requestFromBody, ollamaEnvelope, request } from './provider-helpers.js';
import { ConnectionStore, presetRef, FakeSecrets, settings, credentialSelfTest, ProductError, attachPreset, presetDependencies, modelFromPreset, localDiagnostics, prepareProbe, runProbe } from './product-helpers.js';
for (const mode of ['none', 'env', 'session', 'system'] as const)
    test(`Named preset ${mode} stores no plaintext and resolves only explicit source`, async (t) => {
        const secrets = new FakeSecrets(), store = new ConnectionStore(join(temporary(t), 'config'), secrets);
        process.env.SIGLUM_TEST_ENV = 'KEY-SYNTHETIC-env';
        try {
            const input = mode === 'none' ? undefined : mode === 'env' ? 'SIGLUM_TEST_ENV' : 'KEY-SYNTHETIC-' + mode;
            const p = await store.save('writing', settings(), mode, input), ref = presetRef(p);
            assert.equal(store.list().length, 1);
            const actual = await store.resolve(ref, p.settings);
            assert.equal(actual, mode === 'none' ? undefined : 'KEY-SYNTHETIC-' + mode);
            assert.equal(readFileSync(store.path).includes(Buffer.from('KEY-SYNTHETIC')), false);
            assert.doesNotMatch(JSON.stringify(p), /KEY-SYNTHETIC/);
            await assert.rejects(store.resolve(ref, settings('http://127.0.0.1:1234')), { code: 'PRESET_TARGET' });
        }
        finally {
            delete process.env.SIGLUM_TEST_ENV;
        }
    });
test('Listing/diagnostics creates no app config and does not load/read/unlock OS credentials', t => {
    const dir = join(temporary(t), 'new-app'), secret = new FakeSecrets(), s = new ConnectionStore(dir, secret);
    assert.deepEqual(s.list(), []);
    const d = localDiagnostics(null, s);
    assert.equal(existsSync(dir), false);
    assert.equal(secret.reads + secret.writes, 0);
    assert.equal(d.results.find(r => r.name === 'os-credential-store')!.status, 'not-run');
});
test('Default metadata check does not call live endpoints or inspect key values', async (t) => {
    const secret = new FakeSecrets(), s = new ConnectionStore(join(temporary(t), 'app'), secret);
    await s.save('Private user title', settings(), 'system', 'SYNTHETIC-KEY');
    const before = secret.reads;
    const d = localDiagnostics(null, s);
    assert.equal(secret.reads, before);
    assert.doesNotMatch(JSON.stringify(d), /SYNTHETIC-KEY|Private user title/);
});
test('System key is persistent via backend reference when ConnectionStore reopens', async (t) => {
    const dir = join(temporary(t), 'app'), secret = new FakeSecrets(), a = new ConnectionStore(dir, secret), p = await a.save('test', settings(), 'system', 'Fake-A');
    const b = new ConnectionStore(dir, secret);
    assert.equal(await b.resolve(presetRef(p), p.settings), 'Fake-A');
});
test('Unavailable system backend does not save config or silently use environment', async (t) => {
    const secret = new FakeSecrets();
    secret.write = async () => { throw new ProductError('CREDENTIAL_LOCKED', 'Locked'); };
    const s = new ConnectionStore(join(temporary(t), 'app'), secret);
    await assert.rejects(s.save('test', settings(), 'system', 'Fake-A'), { code: 'CREDENTIAL_LOCKED' });
    assert.equal(s.list().length, 0);
});
test('Possible keyring side effect followed by write error compensates only its new key', async (t) => {
    const secret = new FakeSecrets();
    secret.values.set('OTHER_APP', 'KEEP');
    secret.write = async (id, value) => { secret.values.set(id, value); throw Error('backend failed after write'); };
    const s = new ConnectionStore(join(temporary(t), 'app'), secret);
    await assert.rejects(s.save('test', settings(), 'system', 'Fake-A'));
    assert.deepEqual([...secret.values], [['OTHER_APP', 'KEEP']]);
    assert.equal(s.list().length, 0);
});
test('Config commit failure after keyring write deletes only newly created key', async (t) => {
    const s = new ConnectionStore(join(temporary(t), 'app'), new FakeSecrets());
    await s.save('baseline', settings(), 'none');
    const db = new DatabaseSync(s.path);
    try {
        db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON presets BEGIN SELECT RAISE(ABORT,'synthetic');END");
    }
    finally {
        db.close();
    }
    await assert.rejects(s.save('new', settings(), 'system', 'Fake-A'), /synthetic/);
    assert.equal((s.secrets as FakeSecrets).values.size, 0);
    assert.equal(s.list().length, 1);
});
test('Replacing a key creates a new immutable reference and invalidates the old version', async (t) => {
    const s = new ConnectionStore(join(temporary(t), 'app'), new FakeSecrets()), p = await s.save('old', settings(), 'system', 'Fake-A');
    const next = await s.save('new', settings(), 'system', 'Fake-B', presetRef(p));
    assert.equal(next.id, p.id);
    assert.notEqual(next.version, p.version);
    assert.notDeepEqual(next.credential, p.credential);
    await assert.rejects(s.resolve(presetRef(p), p.settings), { code: 'PRESET_STALE' });
    assert.equal(await s.resolve(presetRef(next), next.settings), 'Fake-B');
    assert.equal(s.pendingSecrets().length, 1);
    await s.cleanupSecret(String(s.pendingSecrets()[0]!.id));
    assert.equal((s.secrets as FakeSecrets).values.size, 1);
});
test('Concurrent replacement refuses config commit and preserves winner/key', async (t) => {
    const secrets = new FakeSecrets(), s = new ConnectionStore(join(temporary(t), 'app'), secrets), p = await s.save('old', settings(), 'none');
    const original = secrets.write.bind(secrets);
    secrets.write = async (id, value) => { await original(id, value); s.disable(presetRef(p)); };
    await assert.rejects(s.save('conflict', settings(), 'system', 'Fake-A', presetRef(p)), { code: 'PRESET_STALE' });
    assert.equal(s.list()[0]!.enabled, false);
    assert.equal(secrets.values.size, 0);
});
test('Missing explicitly selected environment key never falls back to another key', async (t) => {
    const s = new ConnectionStore(join(temporary(t), 'app'), new FakeSecrets()), p = await s.save('missing', settings(), 'env', 'SIGLUM_MISSING_NOT_CONFIGURED');
    process.env.WRITER_AGENT_API_KEY = 'DO-NOT-FALLBACK';
    try {
        await assert.rejects(s.resolve(presetRef(p), p.settings), { code: 'CREDENTIAL_MISSING' });
    }
    finally {
        delete process.env.WRITER_AGENT_API_KEY;
    }
});
test('Removing local key disables the connection and explicitly does not revoke provider key', async (t) => {
    const secrets = new FakeSecrets(), s = new ConnectionStore(join(temporary(t), 'app'), secrets), p = await s.save('delete', settings(), 'system', 'Fake-A');
    assert.deepEqual(await s.remove(presetRef(p)), { disabled: true, remoteKeyRevoked: false });
    assert.equal(secrets.values.size, 0);
    assert.throws(() => s.get(presetRef(p)), { code: 'PRESET_STALE' });
});
for (const value of ['', 'two words', '\nsecret', '密钥', 'a'.repeat(8193)])
    test('Invalid key is rejected without storage: ' + JSON.stringify(value.slice(0, 15)), async (t) => {
        const secrets = new FakeSecrets(), s = new ConnectionStore(join(temporary(t), 'app'), secrets);
        await assert.rejects(s.save('bad', settings(), 'system', value), { code: 'CREDENTIAL_INVALID' });
        assert.equal(secrets.writes, 0);
    });
test('Symlink user-config directory is refused rather than reading arbitrary file', async (t) => { const dir = temporary(t), target = join(dir, 'target'), link = join(dir, 'link'); mkdirSync(target); symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); const s = new ConnectionStore(link, new FakeSecrets()); assert.throws(() => s.list(), { code: 'CONFIG_PATH' }); });
test('Unknown user config schema is refused without overwriting', t => { const dir = temporary(t), path = join(dir, 'connections.sqlite'), db = new DatabaseSync(path); db.exec('PRAGMA user_version=999;'); db.close(); assert.throws(() => new ConnectionStore(dir, new FakeSecrets()).list(), { code: 'CONFIG_SCHEMA' }); });
test('Preset metadata corruption is detected', async (t) => { const s = new ConnectionStore(temporary(t), new FakeSecrets()); await s.save('x', settings(), 'none'); const db = new DatabaseSync(s.path); try {
    db.exec('DROP TRIGGER presets_no_update');
    db.exec("UPDATE presets SET payload='{}'");
}
finally {
    db.close();
} assert.throws(() => s.list(), { code: 'CONFIG_CORRUPT' }); });
test('Credential self-test only touches one isolated id and verifies replacement/deletion', async () => { const f = new FakeSecrets(); f.values.set('OTHER', 'KEEP'); const r = await credentialSelfTest(f); assert.equal(r.status, 'passed'); assert.equal(r.cleanup, 'passed'); assert.deepEqual([...f.values], [['OTHER', 'KEEP']]); });
test('Credential self-test cleans ambiguous write outcome with no other-app enumeration', async () => { const f = new FakeSecrets(); f.write = async (id, v) => { f.values.set(id, v); throw Error('uncertain'); }; await assert.rejects(credentialSelfTest(f)); assert.equal(f.values.size, 0); });
test('Imported task SecretRef cannot unlock a local key without explicit task binding', async (t) => { const { w, run, dir } = workflowSetup(t), f = new FakeSecrets(), s = new ConnectionStore(join(dir, 'app'), f), p = await s.save('x', settings(), 'system', 'Fake-A'); w.workflows.refresh(run.id, { ...run.config, model: p.settings.kind === 'model' ? p.settings.model : run.config.model, connectionRefs: { model: presetRef(p) } }); assert.throws(() => presetDependencies(w, w.workflows.run(run.id), s), { code: 'PRESET_UNTRUSTED' }); assert.equal(f.reads, 0); });
test('Explicit preset attachment revokes old phase grant and prevents cross-workspace reuse', async (t) => { const { w, run, dir } = workflowSetup(t), f = new FakeSecrets(), s = new ConnectionStore(join(dir, 'app'), f), p = await s.save('x', settings(), 'system', 'Fake-A'); grant(w, run.id); attachPreset(w, run.id, p, s); assert.equal(w.workflows.run(run.id).grantId, null); const other = Workspace.create(join(dir, 'other'), 'Other'); try {
    const copied = other.workflows.create({ ...w.workflows.run(run.id).config, selection: {} });
    assert.throws(() => presetDependencies(other, copied, s), { code: 'PRESET_UNTRUSTED' });
}
finally {
    other.close();
} });
test('Credential callback is absent from describe/prompts but sets exactly approved authorization', async (t) => {
    const fixture = await fakeServer(t, (r, res) => json(res, ollamaEnvelope(wire(requestFromBody(r.body)))));
    const s = new ConnectionStore(join(temporary(t), 'app'), new FakeSecrets()), p = await s.save('test', settings(fixture.base), 'system', 'Fake-Private-Token');
    const model = modelFromPreset(s, p.id, p.version);
    assert.doesNotMatch(JSON.stringify(model.describe()), /Fake-Private-Token|credential|assertCurrent/);
    await model.propose(request());
    assert.equal(fixture.requests[0]!.headers.authorization, 'Bearer Fake-Private-Token');
    assert.doesNotMatch(JSON.stringify(fixture.requests[0]!.body), /Fake-Private-Token/);
});
test('Connection changed during independent model wait rejects response before storage', async (t) => { let change: () => void = () => { }; const f = await fakeServer(t, (r, res) => { change(); json(res, ollamaEnvelope(wire(requestFromBody(r.body)))); }); const s = new ConnectionStore(join(temporary(t), 'app'), new FakeSecrets()), p = await s.save('x', settings(f.base), 'none'); change = () => { s.disable(presetRef(p)); }; await assert.rejects(modelFromPreset(s, p.id, p.version).propose(request()), { code: 'PRESET_STALE' }); });
test('Bound workflow uses private credential callback and does not save a changed preset response', async (t) => {
    const { w, run, dir } = workflowSetup(t);
    let change = () => { };
    const f = await fakeServer(t, (_r, res) => { change(); json(res, { done: true, message: { role: 'assistant', content: '{}' } }); });
    const secrets = new FakeSecrets(), store = new ConnectionStore(join(dir, 'app'), secrets), p = await store.save('test', settings(f.base), 'system', 'Fake-A');
    attachPreset(w, run.id, p, store);
    grant(w, run.id);
    change = () => { store.disable(presetRef(p)); };
    await assert.rejects(executeWorkflow(w, run.id, presetDependencies(w, w.workflows.run(run.id), store)));
    assert.equal(w.workflows.artifacts(run.id).length, 0);
    assert.equal(w.listDocuments().length, 1);
});
test('Preparing a test never reads a key; mutated confirmation never dispatches', async (t) => {
    const secrets = new FakeSecrets(), s = new ConnectionStore(join(temporary(t), 'app'), secrets), p = await s.save('test', settings(), 'system', 'Fake-A');
    const plan = await prepareProbe('model', s, p);
    assert.equal(secrets.reads, 0);
    assert.equal(plan.maxRequests, 2);
    await assert.rejects(runProbe(plan, 'bad', s), { code: 'PROBE_STALE' });
    assert.equal(s.probes().length, 0);
    assert.equal(secrets.reads, 0);
});
test('Explicit isolated keyring probe records status without key values', async (t) => { const f = new FakeSecrets(), s = new ConnectionStore(join(temporary(t), 'app'), f), plan = await prepareProbe('keyring', s); const r = await runProbe(plan, plan.fingerprint, s); assert.equal(r.status, 'passed'); assert.doesNotMatch(JSON.stringify(s.probes()), /Siglum-test-/); assert.equal(f.values.size, 0); });
test('Abandoned dispatched diagnostics remain outcome-unknown when reopened', t => { const dir = temporary(t), s = new ConnectionStore(dir, new FakeSecrets()); s.probeStart({ kind: 'search', maxRequests: 1 }); const again = new ConnectionStore(dir, new FakeSecrets()); assert.equal(again.probes()[0]!.status, 'outcome-unknown'); });
