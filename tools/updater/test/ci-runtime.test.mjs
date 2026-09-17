// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stageSandboxRuntime } from '../../../scripts/desktop-sandbox-ci.mjs';
import { zip, temporary } from './helpers.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
function fixture(t, missing = false) {
  const root = temporary(t), project = join(root, 'source'), stage = join(root, 'stage');
  const elf = Buffer.concat([Buffer.from([127, 69, 76, 70]), Buffer.from('synthetic never-executed ELF bytes')]);
  const files = new Map([['electron', elf], ['chrome-sandbox', elf], ['chrome_crashpad_handler', elf], ['locales/en-US.pak', Buffer.from('fixture')]]);
  if (missing) files.delete('electron');
  const archive = zip([...files]), name = 'electron-v44.4.1-linux-x64.zip';
  const cache = join(project, '.cache/desktop'); mkdirSync(join(cache, 'electron-44.4.1-linux-x64'), { recursive: true });
  mkdirSync(join(project, 'apps/desktop'), { recursive: true });
  writeFileSync(join(project, 'apps/desktop/runtime-lock.json'), JSON.stringify({ version: '44.4.1', assets: { 'linux-x64': { name, bytes: archive.length, sha256: hash(archive) } } }));
  writeFileSync(join(cache, name), archive); writeFileSync(join(cache, 'electron-44.4.1-linux-x64/chrome-sandbox'), elf);
  return { project, stage, files, cache, name };
}
test('stage exact runtime with the verified helper adjacent to electron, not an env-only helper', t => {
  const f = fixture(t), result = stageSandboxRuntime(f.project, f.stage);
  assert.equal(result.files, f.files.size);
  for (const [name, bytes] of f.files) assert(readFileSync(join(result.runtime, name)).equals(bytes));
  assert.equal(readFileSync(join(f.stage, 'runtime.sha256'), 'utf8').trim().split('\n').length, f.files.size);
  if (process.platform !== 'win32') {
    assert.equal(lstatSync(join(result.runtime, 'chrome-sandbox')).mode & 0o7777, 0o755);
  }
  assert.throws(() => stageSandboxRuntime(f.project, f.stage), { code: 'EEXIST' });
});
test('staging reads archive bytes instead of trusting extra mutable runtime cache files', t => {
  const f = fixture(t); writeFileSync(join(f.cache, 'electron-44.4.1-linux-x64/injected.txt'), 'not in lock');
  const result = stageSandboxRuntime(f.project, f.stage); assert(!existsSync(join(result.runtime, 'injected.txt')));
});
test('missing executable refuses staging before any destination write', t => {
  const f = fixture(t, true); assert.throws(() => stageSandboxRuntime(f.project, f.stage), /runtime executable/);
  assert(!existsSync(f.stage));
});
test('modified archive is refused before staging a privileged runtime candidate', t => {
  const f = fixture(t); writeFileSync(join(f.cache, f.name), 'tampered');
  assert.throws(() => stageSandboxRuntime(f.project, f.stage), /exact lock/); assert(!existsSync(f.stage));
});
