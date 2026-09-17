// SPDX-License-Identifier: Apache-2.0
/** Test-harness ownership and lifecycle helpers; not part of the writing app. */
import { mkdtempSync, realpathSync, lstatSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const owners = new WeakMap();
export const CLEANUP_DELAYS_MS = Object.freeze([100, 200, 400, 800, 1600, 2400]);
export const EXPECTED_DESKTOP_CHECKS = 17;
const OWNER_FILE = '.siglum-e2e-owner.json';
function identity(path) {
  const st = lstatSync(path, { bigint: true });
  if (!st.isDirectory() || st.isSymbolicLink() || st.ino === 0n) throw Error('Unsafe smoke-test directory.');
  return { dev: st.dev, ino: st.ino };
}
function sameIdentity(a, b) { return a.dev === b.dev && a.ino === b.ino; }
export function createSmokeWorkspace(base = tmpdir()) {
  const parent = realpathSync.native(base), root = mkdtempSync(join(parent, 'siglum-electron-e2e-'));
  const id = randomUUID(), marker = JSON.stringify({ format: 1, kind: 'siglum-desktop-smoke', id });
  const owner = Object.freeze({ root, id });
  writeFileSync(join(root, OWNER_FILE), marker, { flag: 'wx', mode: 0o600 });
  owners.set(owner, { ...identity(root), parent, marker });
  return owner;
}
function verifyRoot(owner) {
  const known = owners.get(owner);
  if (!known || resolve(owner.root, '..') !== known.parent) throw Error('Unknown smoke-test directory owner.');
  if (!sameIdentity(identity(owner.root), known)) throw Error('Smoke-test directory identity changed; retained.');
  return known;
}
/** Called in Electron only: verify a parent-created test root, never accept a normal workspace. */
export function readSmokeWorkspace(env = process.env) {
  const root = env.SIGLUM_E2E_ROOT, id = env.SIGLUM_E2E_ID;
  if (typeof root !== 'string' || !isAbsolute(root) || !/^[a-f0-9-]{36}$/.test(id || '')) {
    throw Error('Run desktop tests through scripts/desktop-smoke.mjs; a parent-owned test root is required.');
  }
  identity(root);
  const path = join(root, OWNER_FILE), st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 512) throw Error('Invalid test owner marker.');
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.format !== 1 || data.kind !== 'siglum-desktop-smoke' || data.id !== id) throw Error('Wrong test owner marker.');
  return { root, id };
}
/** Cleanup is allowed only after the Electron process has closed. Persistent failure stays a failure. */
export async function cleanupSmokeWorkspace(owner, { childClosed, remove = rm, wait = sleep } = {}) {
  if (childClosed !== true) throw Error('Refusing cleanup while the Electron process may still be alive.');
  const known = verifyRoot(owner);
  if (readFileSync(join(owner.root, OWNER_FILE), 'utf8') !== known.marker) throw Error('Test owner marker changed; retained.');
  for (let attempt = 0; ; attempt++) {
    // rm may remove the marker before encountering a busy cache file. Subsequent
    // attempts therefore use the parent's original filesystem identity, not a new marker.
    try { verifyRoot(owner); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    try { await remove(owner.root, { recursive: true, force: true, maxRetries: 0 }); return; }
    catch (e) {
      if (!['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(e.code) || attempt >= CLEANUP_DELAYS_MS.length) throw e;
      await wait(CLEANUP_DELAYS_MS[attempt]);
    }
  }
}
export function smokeRuntimeDirectory({ root, version, argv = [], env = process.env, platform = process.platform, arch = process.arch }) {
  if (argv.length && (argv.length !== 2 || argv[0] !== '--runtime' || !argv[1] || argv[1].startsWith('--'))) {
    throw Error('Usage: desktop:smoke [--runtime VERIFIED_RUNTIME_DIRECTORY]');
  }
  if (env.SIGLUM_CI_RUNTIME) {
    if (argv.length || platform !== 'linux' || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_OS !== 'Linux' ||
        !/^\d+$/.test(env.GITHUB_RUN_ID || '') || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT || '') ||
        env.SIGLUM_CI_RUNTIME !== `/opt/siglum-ci-sandbox-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`) {
      throw Error('Invalid or ambiguous CI-only runtime selection.');
    }
    return env.SIGLUM_CI_RUNTIME;
  }
  return argv.length ? resolve(argv[1]) : join(root, '.cache', 'desktop', `electron-${version}-${platform}-${arch}`);
}
function killTree(child) {
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return;
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
    if (systemRoot && isAbsolute(systemRoot)) {
      // Only the PID of the child created by this harness, never an image-name kill.
      execFile(join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, timeout: 5000 }, () => {});
    } else child.kill();
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  }
}
/** Wait for close (not just exit), since open stdio/children may outlive exit. */
export function waitForSmokeChild(file, args, { cwd, env, timeoutMs = 180000, graceMs = 10000, spawnProcess = spawn } = {}) {
  return new Promise(resolveResult => {
    let child, error = null, closed = false, settled = false, hardTimer, graceTimer;
    const finish = result => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(hardTimer); clearTimeout(graceTimer);
      process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
      resolveResult({ ...result, error });
    };
    const stop = reason => {
      if (closed || settled) return; error ||= reason; killTree(child);
      hardTimer ||= setTimeout(() => {
        if (!closed && process.platform !== 'win32' && Number.isSafeInteger(child.pid)) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }
      }, Math.min(2000, graceMs));
      graceTimer ||= setTimeout(() => { child.unref?.(); finish({ childClosed: false, code: null, signal: null }); }, graceMs);
    };
    const cancel = () => stop('Desktop smoke cancelled.');
    const timer = setTimeout(() => stop('Desktop smoke timed out.'), timeoutMs);
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try { child = spawnProcess(file, args, { cwd, env, stdio: 'inherit', shell: false, detached: process.platform !== 'win32' }); }
    catch (e) { error = `Could not start Electron: ${e.message}`; finish({ childClosed: true, code: null, signal: null }); return; }
    child.once('error', e => { error ||= `Could not start Electron: ${e.message}`; });
    child.once('close', (code, signal) => { closed = true; finish({ childClosed: true, code, signal }); });
  });
}
export async function finalizeSmoke(owner, child, { output, expectedElectron, remove, wait } = {}) {
  const errors = [];
  if (child.error) errors.push(child.error);
  if (!child.childClosed || child.code !== 0 || child.signal) errors.push(`Electron did not complete cleanly (code=${child.code}, signal=${child.signal}).`);
  let report = null;
  if (!errors.length) {
    try {
      const path = join(output, 'desktop-e2e.json'), st = lstatSync(path);
      if (!st.isFile() || st.isSymbolicLink() || st.size > 200000) throw Error('Invalid desktop result file.');
      report = JSON.parse(readFileSync(path, 'utf8'));
      if (report.runId !== owner.id || report.passed !== EXPECTED_DESKTOP_CHECKS ||
          !Array.isArray(report.checks) || report.checks.length !== report.passed ||
          report.checks.some(x => typeof x !== 'string' || !x) || new Set(report.checks).size !== report.passed ||
          report.versions?.electron !== expectedElectron) throw Error('Missing, stale or incomplete desktop test results.');
    } catch (e) { errors.push(e.message); }
  }
  let cleanupComplete = false;
  if (child.childClosed) {
    try { await cleanupSmokeWorkspace(owner, { childClosed: true, remove, wait }); cleanupComplete = true; }
    catch (e) { errors.push(`Desktop test cleanup failed (${e.code || 'ERROR'}): ${e.message}`); }
  } else errors.push('Cleanup not attempted: Electron process closure is unconfirmed.');
  return { passed: errors.length === 0, runId: owner.id, checks: report?.passed || 0, childClosed: child.childClosed,
    cleanupComplete, errors, retainedTestDirectory: cleanupComplete ? null : owner.root };
}
