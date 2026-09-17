// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, rmSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { installBootstrap, verifyPackage } from '../bootstrap.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'siglum-rename-test-'));
  const source = join(root, 'source');
  const dest = join(root, 'owned');
  mkdirSync(join(source, 'src'), { recursive: true });
  const files = [
    ['launch.mjs', 'export const launch=()=>{throw Error("do not execute")};'],
    ['src/engine.mjs', '// synthetic code'],
  ].map(([path, body]) => {
    writeFileSync(join(source, path), body);
    return { path, bytes: Buffer.byteLength(body), sha256: sha(body) };
  });
  writeFileSync(join(source, 'UPDATER_MANIFEST.json'), JSON.stringify({
    format: 1, kind: 'updater-bootstrap', version: '0.2.0', files,
  }));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 }));
  return { root, source, dest };
}
function busy(code = 'EPERM') {
  return Object.assign(new Error('injected transient rename failure'), { code, syscall: 'rename' });
}
const opts = f => ({ root: f.dest, source: f.source, shortcuts: false });
const isStage = path => basename(String(path)).includes('.tmp-') && !basename(String(path)).startsWith('current.json');

test('bootstrap completes after two injected directory EPERM failures, with package integrity intact', async t => {
  const f = fixture(t), original = fs.rename;
  let blocked = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (isStage(from) && blocked++ < 2) throw busy();
    return original(from, to);
  });
  const result = await installBootstrap(opts(f));
  assert(result.installed);
  assert.equal(blocked, 3);
  assert.equal((await verifyPackage(result.destination)).hash, (await verifyPackage(f.source)).hash);
  assert.equal(JSON.parse(readFileSync(join(f.dest, 'current.json'))).directory, basename(result.destination));
  assert(!readdirSync(join(f.dest, 'versions')).some(n => n.includes('.tmp-')));
});

test('bootstrap retries pointer rename without deleting the existing pointer', async t => {
  const f = fixture(t);
  await installBootstrap(opts(f));
  const pointer = join(f.dest, 'current.json'), before = readFileSync(pointer), original = fs.rename;
  let blocked = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === pointer) {
      assert.deepEqual(readFileSync(pointer), before);
      if (blocked++ === 0) throw busy('EACCES');
    }
    return original(from, to);
  });
  assert((await installBootstrap(opts(f))).reused);
  assert.equal(blocked, 2);
  assert.deepEqual(readFileSync(pointer), before);
});

test('bootstrap refuses changed staged files between rename attempts', async t => {
  const f = fixture(t), original = fs.rename;
  let calls = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (isStage(from)) {
      calls++;
      writeFileSync(join(from, 'src/engine.mjs'), '// changed during contention');
      throw busy();
    }
    return original(from, to);
  });
  await assert.rejects(installBootstrap(opts(f)), { code: 'BOOTSTRAP_HASH' });
  assert.equal(calls, 1);
  assert(!existsSync(join(f.dest, 'current.json')));
});

test('bootstrap retains a destination created by another writer while waiting', async t => {
  const f = fixture(t), original = fs.rename;
  let competitor;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (isStage(from)) {
      competitor = to;
      mkdirSync(to);
      writeFileSync(join(to, 'someone-elses-file.txt'), 'retain this');
      throw busy();
    }
    return original(from, to);
  });
  await assert.rejects(installBootstrap(opts(f)), { code: 'BOOTSTRAP_DESTINATION' });
  assert.equal(readFileSync(join(competitor, 'someone-elses-file.txt'), 'utf8'), 'retain this');
  assert(!existsSync(join(f.dest, 'current.json')));
});

test('bootstrap retains a pointer changed by another writer while waiting', async t => {
  const f = fixture(t);
  await installBootstrap(opts(f));
  const pointer = join(f.dest, 'current.json'), original = fs.rename;
  let calls = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === pointer) {
      calls++;
      writeFileSync(pointer, '{"another":"writer"}');
      throw busy();
    }
    return original(from, to);
  });
  await assert.rejects(installBootstrap(opts(f)), { code: 'BOOTSTRAP_POINTER_CHANGED' });
  assert.equal(calls, 1);
  assert.equal(readFileSync(pointer, 'utf8'), '{"another":"writer"}');
});

test('bootstrap does not retry structural rename errors or publish a pointer', async t => {
  const f = fixture(t), original = fs.rename;
  let calls = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (isStage(from)) { calls++; throw busy('EXDEV'); }
    return original(from, to);
  });
  await assert.rejects(installBootstrap(opts(f)), { code: 'EXDEV' });
  assert.equal(calls, 1);
  assert(!existsSync(join(f.dest, 'current.json')));
});
