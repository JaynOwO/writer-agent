// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, realpathSync, symlinkSync, statSync } from 'node:fs';
import { join, resolve, toNamespacedPath } from 'node:path';
import { execFileSync } from 'node:child_process';
import { samePath, fingerprint } from '../src/common.mjs';
import { fixture, temporary } from './helpers.mjs';

test('Git root and native long-name root identify the same real temporary repository', async t => {
  const f = await fixture(t), fromGit = await f.git.text(f.repo, 'rev-parse', '--show-toplevel');
  const native = realpathSync.native(f.repo);
  assert.equal(samePath(fromGit, f.repo), true);
  assert.equal(samePath(native, f.repo), true);
  const { task } = await f.engine.prepare(f.bytes);
  assert.equal(task.state, 'prepared');
  t.diagnostic(`platform=${process.platform}; native spelling differs=${native !== resolve(f.repo)}`);
});

test('existing alternate native path reaches full update without bypassing repository validation', async t => {
  const f = await fixture(t);
  let alias;
  if (process.platform === 'win32') {
    // Static shell program only: no path or author input is interpolated into CMD.
    // /u makes internal echo UTF-16 even on non-English Windows runners.
    alias = execFileSync(join(process.env.SystemRoot, 'System32', 'cmd.exe'),
      ['/d', '/u', '/c', 'for %I in (.) do @echo %~fsI'],
      { cwd: f.repo, encoding: 'utf16le', windowsHide: true, timeout: 10000 }).trim();
    assert(alias.length > 0);
    assert.equal(samePath(alias, realpathSync.native(f.repo)), true);
    assert.equal(samePath(toNamespacedPath(f.repo), alias), true);
    t.diagnostic(`Windows actual 8.3 alias obtained=${alias.includes('~')}`);
  } else {
    // A real ancestor alias exercises physical identity on POSIX. The selected
    // final directory is ordinary; this does not bypass symlink import checks.
    const link = join(f.root, 'ancestor-alias');
    symlinkSync(f.root, link, 'dir');
    alias = join(link, 'original 文稿 repository');
    assert.equal(samePath(alias, f.repo), true);
    t.diagnostic('POSIX ancestor-alias branch; Windows 8.3 branch requires Windows CI');
  }
  f.config.repoPath = alias;
  const { task } = await f.engine.prepare(f.bytes);
  f.engine.authorize(task.id, fingerprint(f.engine.preview(task)), 'full');
  const result = await f.engine.run(task.id);
  assert.equal(result.error, null, JSON.stringify(result.error));
  assert.equal(result.remoteMerged, true);
  assert.equal(result.localSynced, true);
});

test('separate same-name same-content directories never compare equal', t => {
  const root = temporary(t);
  const a = join(root, 'a', 'repo'), b = join(root, 'b', 'repo');
  for (const p of [a, b]) { mkdirSync(p, { recursive: true }); writeFileSync(join(p, 'same'), 'same'); }
  assert.equal(samePath(a, b), false);
  assert.equal(samePath(root, a), false);
  assert.equal(samePath(join(a, 'same'), join(b, 'same')), false);
});

test('directory case comparison follows actual filesystem identity, not lowercase strings', t => {
  const root = temporary(t), upper = join(root, 'Repo'), lower = join(root, 'repo');
  mkdirSync(upper);
  try { mkdirSync(lower); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const a = statSync(upper, { bigint: true }), b = statSync(lower, { bigint: true });
  assert.equal(samePath(upper, lower), a.dev === b.dev && a.ino === b.ino);
});

test('missing paths throw rather than accepting matching spelling', t => {
  const root = temporary(t), p = join(root, 'missing');
  assert.throws(() => samePath(p, p), { code: 'ENOENT' });
  assert.throws(() => samePath(root, p), { code: 'ENOENT' });
});

test('a subdirectory is still rejected as a selected repository root before task/cache creation', async t => {
  const f = await fixture(t), child = join(f.repo, 'subdir'); mkdirSync(child);
  f.config.repoPath = child;
  await assert.rejects(() => f.engine.prepare(f.bytes), { code: 'REPOSITORY_ROOT' });
  assert.equal(f.store.list().length, 0);
  assert.equal(f.gh.createCount, 0);
});
