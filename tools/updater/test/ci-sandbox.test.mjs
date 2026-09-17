// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifiedSandboxBytes, stageSandbox, ciStagePath } from '../../../scripts/desktop-sandbox-ci.mjs';
import { zip, temporary } from './helpers.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
const helper = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from('owned non-executable test data')]);
function fixture() {
  const archive = zip([['chrome-sandbox', helper]]);
  return { archive, asset: { bytes: archive.length, sha256: hash(archive) } };
}
test('helper verification requires both the pinned archive and exact extracted bytes', () => {
  const { archive, asset } = fixture(), result = verifiedSandboxBytes(archive, asset, helper);
  assert(result.bytes.equals(helper)); assert.equal(result.sha256, hash(helper));
});
for (const kind of ['size', 'archive', 'helper', 'missing-helper', 'not-ELF']) {
  test('sandbox preparation refuses ' + kind, () => {
    let { archive, asset } = fixture(), extracted = helper;
    if (kind === 'size') asset.bytes++;
    if (kind === 'archive') archive = Buffer.from(archive).fill(0, 0, 1);
    if (kind === 'helper') extracted = Buffer.from('changed');
    if (kind === 'missing-helper' || kind === 'not-ELF') {
      archive = zip([[kind === 'missing-helper' ? 'other' : 'chrome-sandbox', Buffer.from('invalid')]]);
      asset = { bytes: archive.length, sha256: hash(archive) }; extracted = Buffer.from('invalid');
    }
    assert.throws(() => verifiedSandboxBytes(archive, asset, extracted));
  });
}
function stagedFixture(t) {
  const root = temporary(t), project = join(root, 'source'), stage = join(root, 'stage');
  const { archive, asset } = fixture(), name = 'electron-v44.4.1-linux-x64.zip';
  const runtime = join(project, '.cache/desktop/electron-44.4.1-linux-x64');
  mkdirSync(runtime, { recursive: true }); mkdirSync(join(project, 'apps/desktop'), { recursive: true });
  writeFileSync(join(project, 'apps/desktop/runtime-lock.json'), JSON.stringify({ version: '44.4.1', assets: { 'linux-x64': { ...asset, name } } }));
  writeFileSync(join(project, '.cache/desktop', name), archive);
  writeFileSync(join(runtime, 'chrome-sandbox'), helper);
  return { root, project, stage, runtime };
}
test('stage creates only two unprivileged verified files and refuses to reuse a directory', t => {
  const f = stagedFixture(t); assert.equal(stageSandbox(f.project, f.stage), hash(helper));
  assert(readFileSync(join(f.stage, 'chrome-sandbox')).equals(helper));
  assert.throws(() => stageSandbox(f.project, f.stage), { code: 'EEXIST' });
});
test('changed extracted helper cannot create a staging directory', t => {
  const f = stagedFixture(t); writeFileSync(join(f.runtime, 'chrome-sandbox'), 'tampered');
  assert.throws(() => stageSandbox(f.project, f.stage)); assert.equal(existsSync(f.stage), false);
});
test('sandbox CLI cannot be invoked as an ordinary desktop or Windows setup command', () => {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: '/tmp' };
  assert.equal(ciStagePath(env, 'linux'), '/tmp/siglum-sandbox-123-1');
  for (const changed of [{ GITHUB_ACTIONS: '' }, { RUNNER_OS: 'Windows' }, { GITHUB_RUN_ID: '../escape' }, { GITHUB_RUN_ATTEMPT: '1\n2' }, { RUNNER_TEMP: 'relative' }]) {
    assert.throws(() => ciStagePath({ ...env, ...changed }, 'linux'));
  }
  assert.throws(() => ciStagePath(env, 'win32'));
});
test('CI retains both Node/OS matrix entries, active smoke tests, privileged-helper cleanup and no sandbox bypass', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const smoke = readFileSync(join(root, 'scripts/desktop-smoke.mjs'), 'utf8');
  assert.match(ci, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(ci, /node: \['22', '24'\]/);
  assert.match(ci, /run: pnpm desktop:smoke/);
  assert(ci.indexOf('node scripts/desktop-sandbox-ci.mjs') < ci.indexOf('sudo -n install'));
  assert(ci.indexOf('sudo -n install') < ci.indexOf('run: pnpm desktop:smoke'));
  assert.match(ci, /install -o root -g root -m 4755/);
  assert.match(ci, /SIGLUM_CI_RUNTIME=/);
  assert(!ci.includes('CHROME_DEVEL_SANDBOX='));
  assert.match(ci, /\$stage\/runtime\/chrome-sandbox/);
  assert.match(ci, /runtime\.sha256/);
  assert.match(ci, /if: always\(\) && steps\.linux-sandbox\.outputs\.directory/);
  assert.match(ci, /sudo -n rmdir --/);
  for (const unsafe of ['--no-sandbox', '--disable-setuid-sandbox', 'apparmor_restrict_unprivileged_userns=0', 'continue-on-error: true']) {
    assert(!ci.includes(unsafe)); assert(!smoke.includes(unsafe));
  }
});
