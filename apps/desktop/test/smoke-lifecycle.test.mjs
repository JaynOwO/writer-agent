// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createSmokeWorkspace, readSmokeWorkspace, cleanupSmokeWorkspace, CLEANUP_DELAYS_MS,
  waitForSmokeChild, finalizeSmoke, smokeRuntimeDirectory, EXPECTED_DESKTOP_CHECKS } from '../../../scripts/desktop-smoke-support.mjs';
function fixture(t, cleanupOptions = {}) {
  // The OUTER regression fixture owns files too. Use the same guarded async
  // cleanup as the inner Electron test instead of a second rmSync-only path.
  const outer = createSmokeWorkspace(), base = outer.root, children = [];
  t.after(async () => {
    const results = await Promise.all(children);
    if (results.some(result => result.childClosed !== true)) {
      throw Error(`Regression child closure unconfirmed; fixture retained: ${base}`);
    }
    await cleanupSmokeWorkspace(outer, { ...cleanupOptions, childClosed: true });
  });
  const owner = createSmokeWorkspace(base), output = join(base, 'reports'); mkdirSync(output);
  const report = { runId: owner.id, passed: EXPECTED_DESKTOP_CHECKS,
    checks: Array.from({ length: EXPECTED_DESKTOP_CHECKS }, (_, i) => `Synthetic scenario ${i}`),
    versions: { electron: '44.4.1' } };
  writeFileSync(join(output, 'desktop-e2e.json'), JSON.stringify(report));
  const runChild = (...args) => {
    const pending = waitForSmokeChild(...args); children.push(pending); return pending;
  };
  return { base, outer, owner, output, report, runChild };
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
  const { owner, output, runChild } = fixture(t);
  const child = await runChild(process.execPath, ['-e', 'process.chdir(process.env.TEST_ROOT); setTimeout(()=>process.exit(0),30)'],
    { env: { ...process.env, TEST_ROOT: owner.root }, timeoutMs: 10000 });
  const result = await finalizeSmoke(owner, child, { output, expectedElectron: '44.4.1' });
  assert(result.passed && result.childClosed && result.cleanupComplete); assert(!existsSync(owner.root));
});
test('real timed-out child is closed and still reported failed', async t => {
  const { owner, output, runChild } = fixture(t);
  const child = await runChild(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { env: process.env, timeoutMs: 250, graceMs: 5000 });
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

// Exercise the exact after-hook, including locks that last beyond the old
// 4x100ms synchronous budget. Timings are injected; Windows is tested in CI.
test('outer after-hook waits for child close and retries transient fixture-directory locks', async () => {
  let after, attempts = 0; const delays = [], child = new EventEmitter();
  const f = fixture({ after: fn => { after = fn; } }, {
    wait: async ms => delays.push(ms),
    remove: async (path, options) => {
      assert.equal(path, f.base);
      if (++attempts <= 4) throw Object.assign(Error('fixture directory busy'), { code: 'EPERM' });
      await rm(path, options);
    }
  });
  let completed = false;
  const running = f.runChild(process.execPath, [], { spawnProcess: () => child });
  const cleaning = after().then(() => { completed = true; });
  child.emit('exit', 0, null); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(attempts, 0); assert.equal(completed, false); assert(existsSync(f.base));
  child.emit('close', 0, null); await running; await cleaning;
  assert.deepEqual(delays, CLEANUP_DELAYS_MS.slice(0, 4));
  assert.equal(attempts, 5); assert(!existsSync(f.base));
});
test('outer after-hook preserves a persistently locked fixture and reports failure', async () => {
  let after, attempts = 0;
  const f = fixture({ after: fn => { after = fn; } }, {
    wait: async () => {}, remove: async () => {
      attempts++; throw Object.assign(Error('fixture directory permanently busy'), { code: 'EPERM' });
    }
  });
  try {
    await assert.rejects(after(), { code: 'EPERM' });
    assert.equal(attempts, CLEANUP_DELAYS_MS.length + 1); assert(existsSync(f.base));
  } finally { await cleanupSmokeWorkspace(f.outer, { childClosed: true }); }
});
test('failed Electron report retains completed checks and failure phase without becoming success', async t => {
  const { owner, output, report } = fixture(t);
  report.checks = report.checks.slice(0, 16); report.passed = report.checks.length;
  report.failure = { stage: 'screenshot', message: 'UnknownVizError' };
  writeFileSync(join(output, 'desktop-e2e.json'), JSON.stringify(report));
  const result = await finalizeSmoke(owner, { ...closed, code: 1 }, { output, expectedElectron: '44.4.1' });
  assert.equal(result.passed, false); assert.equal(result.checks, 16);
  assert(result.errors.some(x => x.includes('screenshot') && x.includes('UnknownVizError')));
  assert.equal(result.cleanupComplete, true);
});
