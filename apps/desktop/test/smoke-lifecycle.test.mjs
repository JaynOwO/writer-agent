// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createSmokeWorkspace, readSmokeWorkspace, cleanupSmokeWorkspace, CLEANUP_DELAYS_MS,
  waitForSmokeChild, finalizeSmoke, smokeRuntimeDirectory } from '../../../scripts/desktop-smoke-support.mjs';
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'siglum-smoke-regression-'));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }));
  const owner = createSmokeWorkspace(base), output = join(base, 'reports'); mkdirSync(output);
  const report = { runId: owner.id, passed: 17, checks: Array.from({ length: 17 }, (_, i) => `Synthetic scenario ${i}`), versions: { electron: '44.4.1' } };
  writeFileSync(join(output, 'desktop-e2e.json'), JSON.stringify(report));
  return { base, owner, output, report };
}
const closed = { childClosed: true, code: 0, signal: null, error: null };
test('only parent-created root is accepted by Electron fixture', t => {
  const { owner } = fixture(t);
  assert.deepEqual(readSmokeWorkspace({ SIGLUM_E2E_ROOT: owner.root, SIGLUM_E2E_ID: owner.id }), owner);
  assert.throws(() => readSmokeWorkspace({}));
  assert.throws(() => readSmokeWorkspace({ SIGLUM_E2E_ROOT: owner.root, SIGLUM_E2E_ID: '0'.repeat(36) }));
});
test('cleanup refuses while Electron is alive, without even calling rm', async t => {
  const { owner } = fixture(t); let calls = 0;
  await assert.rejects(cleanupSmokeWorkspace(owner, { childClosed: false, remove: () => calls++ }), /may still be alive/);
  assert.equal(calls, 0); assert(existsSync(owner.root));
});
test('unknown or replaced directory cannot be removed by cleanup', async t => {
  const { owner } = fixture(t);
  await assert.rejects(cleanupSmokeWorkspace({ ...owner }, { childClosed: true }), /Unknown/);
  renameSync(owner.root, owner.root + '-retained'); mkdirSync(owner.root);
  await assert.rejects(cleanupSmokeWorkspace(owner, { childClosed: true }), /identity changed/);
  assert(existsSync(owner.root + '-retained'));
});
test('changed ownership marker fails closed', async t => {
  const { owner } = fixture(t); writeFileSync(join(owner.root, '.siglum-e2e-owner.json'), '{}');
  await assert.rejects(cleanupSmokeWorkspace(owner, { childClosed: true }), /marker changed/);
  assert(existsSync(owner.root));
});
for (const code of ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']) {
  test(`post-exit ${code} retry permits partial cleanup but keeps the root identity`, async t => {
    const { owner } = fixture(t); let attempts = 0; const delays = [];
    await cleanupSmokeWorkspace(owner, { childClosed: true, wait: async ms => delays.push(ms), remove: async (path, opts) => {
      if (attempts++ < 2) {
        if (attempts === 1) unlinkSync(join(path, '.siglum-e2e-owner.json'));
        throw Object.assign(Error('synthetic temporary lock'), { code });
      }
      await rm(path, opts);
    } });
    assert.equal(attempts, 3); assert.deepEqual(delays, CLEANUP_DELAYS_MS.slice(0, 2)); assert(!existsSync(owner.root));
  });
}
test('persistent lock remains a failed cleanup, with finite retries and preserved data', async t => {
  const { owner, output } = fixture(t); let attempts = 0;
  const result = await finalizeSmoke(owner, closed, { output, expectedElectron: '44.4.1', wait: async () => {}, remove: async () => {
    attempts++; throw Object.assign(Error('synthetic persistent lock'), { code: 'EPERM' });
  } });
  assert.equal(result.passed, false); assert.equal(result.cleanupComplete, false); assert(existsSync(owner.root));
  assert.equal(attempts, CLEANUP_DELAYS_MS.length + 1); assert.equal(CLEANUP_DELAYS_MS.reduce((a, b) => a + b, 0), 5500);
});
test('structural cleanup error is not retried', async t => {
  const { owner } = fixture(t); let attempts = 0;
  await assert.rejects(cleanupSmokeWorkspace(owner, { childClosed: true, remove: async () => {
    attempts++; throw Object.assign(Error('I/O'), { code: 'EIO' });
  } }), { code: 'EIO' }); assert.equal(attempts, 1);
});
test('root replaced between retries is retained, not recursively deleted', async t => {
  const { owner } = fixture(t); let attempts = 0;
  await assert.rejects(cleanupSmokeWorkspace(owner, { childClosed: true,
    remove: async () => { attempts++; throw Object.assign(Error('busy'), { code: 'EPERM' }); },
    wait: async () => { renameSync(owner.root, owner.root + '-old'); mkdirSync(owner.root); writeFileSync(join(owner.root, 'keep.txt'), 'keep'); }
  }), /identity changed/);
  assert.equal(attempts, 1); assert.equal(readFileSync(join(owner.root, 'keep.txt'), 'utf8'), 'keep');
});
test('parent waits for close instead of treating exit as complete', async () => {
  const child = new EventEmitter(); let finished = false;
  const pending = waitForSmokeChild(process.execPath, [], { spawnProcess: () => child }).then(r => { finished = true; return r; });
  child.emit('exit', 0, null); await new Promise(r => setTimeout(r, 10)); assert.equal(finished, false);
  child.emit('close', 0, null); assert.equal((await pending).childClosed, true);
});
test('spawn errors cannot become a successful test with a stale result', async t => {
  const { owner, output } = fixture(t);
  const child = await waitForSmokeChild(process.execPath, [], { spawnProcess: () => { throw Error('synthetic unavailable binary'); } });
  const result = await finalizeSmoke(owner, child, { output, expectedElectron: '44.4.1' });
  assert.equal(result.passed, false); assert.equal(result.cleanupComplete, true); assert.match(result.errors[0], /Could not start/);
});
test('unknown process closure never cleans a potentially live workspace', async t => {
  const { owner, output } = fixture(t);
  const result = await finalizeSmoke(owner, { childClosed: false, code: null, signal: null, error: 'timeout' }, { output, expectedElectron: '44.4.1' });
  assert(!result.passed && !result.cleanupComplete); assert(existsSync(owner.root));
});
for (const kind of ['nonzero', 'signal', 'stale', 'partial', 'wrong-runtime', 'duplicate']) {
  test(`failed or incomplete ${kind} test report cannot print final success`, async t => {
    const { owner, output, report } = fixture(t); const child = { ...closed };
    if (kind === 'nonzero') child.code = 1;
    if (kind === 'signal') child.signal = 'SIGTERM';
    if (kind === 'stale') report.runId = 'previous-run';
    if (kind === 'partial') report.checks.pop();
    if (kind === 'wrong-runtime') report.versions.electron = '0.0.0';
    if (kind === 'duplicate') report.checks[1] = report.checks[0];
    writeFileSync(join(output, 'desktop-e2e.json'), JSON.stringify(report));
    const result = await finalizeSmoke(owner, child, { output, expectedElectron: '44.4.1' });
    assert(!result.passed); assert(result.cleanupComplete);
  });
}
test('real child leaves its working directory before successful parent cleanup', async t => {
  const { owner, output } = fixture(t);
  const child = await waitForSmokeChild(process.execPath, ['-e', 'process.chdir(process.env.TEST_ROOT); setTimeout(()=>process.exit(0),30)'],
    { env: { ...process.env, TEST_ROOT: owner.root }, timeoutMs: 10000 });
  const result = await finalizeSmoke(owner, child, { output, expectedElectron: '44.4.1' });
  assert(result.passed && result.childClosed && result.cleanupComplete); assert(!existsSync(owner.root));
});
test('real timed-out child is closed and still reported failed', async t => {
  const { owner, output } = fixture(t);
  const child = await waitForSmokeChild(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { env: process.env, timeoutMs: 250, graceMs: 5000 });
  const result = await finalizeSmoke(owner, child, { output, expectedElectron: '44.4.1' });
  assert(!result.passed); assert(result.childClosed && result.cleanupComplete); assert.match(result.errors.join(' '), /timed out/);
});
test('protected CI runtime wins instead of silently launching the cache copy', () => {
  const env = { SIGLUM_CI_RUNTIME: '/opt/siglum-ci-sandbox-123-1', GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
  const args = { root: '/project', version: '44.4.1', env, platform: 'linux', arch: 'x64' };
  assert.equal(smokeRuntimeDirectory(args), env.SIGLUM_CI_RUNTIME);
  for (const extra of [{ platform: 'win32' }, { argv: ['--runtime', '/other'] }, { env: { ...env, GITHUB_ACTIONS: 'false' } }, { env: { ...env, SIGLUM_CI_RUNTIME: '/tmp/arbitrary' } }]) {
    assert.throws(() => smokeRuntimeDirectory({ ...args, ...extra }));
  }
  assert.throws(() => smokeRuntimeDirectory({ ...args, env: {}, argv: ['--runtime'] }));
});
test('Electron scenario runner never deletes live userData or prints final E2E success', () => {
  const run = readFileSync(fileURLToPath(new URL('./run.mjs', import.meta.url)), 'utf8');
  assert(!/\brmSync\s*\(/.test(run)); assert(!run.includes("console.log('DESKTOP_E2E_OK'"));
  assert.match(run, /DESKTOP_SCENARIOS_OK/); assert.match(run, /readSmokeWorkspace/);
});
