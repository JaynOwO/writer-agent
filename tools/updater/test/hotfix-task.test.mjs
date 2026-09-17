// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprint } from '../src/common.mjs';
import { fixture, delivery, git } from './helpers.mjs';

test('a corrected same-version bundle gets a new approved worktree; failed old task/cache are retained', async t => {
  const f = await fixture(t, { validate: async task => {
    if (task.label === 'old package') throw Object.assign(new Error('injected bootstrap rename failure'), { code: 'EPERM' });
  }});
  const old = (await f.engine.prepare(f.bytes, 'old package')).task;
  f.engine.authorize(old.id, fingerprint(f.engine.preview(old)), 'full');
  const stopped = await f.engine.run(old.id);
  assert.equal(stopped.state, 'applied');
  assert(stopped.error);
  assert.equal(f.gh.createCount, 0);
  const oldBytes = readFileSync(join(stopped.worktree, 'new.txt'));
  const oldCache = readFileSync(join(f.store.root, 'cache', stopped.bundleHash + '.zip'));

  const files = new Map(f.files);
  files.set('new.txt', Buffer.from('corrected version, same release number\n'));
  const fixed = delivery(f.baseFiles, files, f.baseSha, f.baseTree);
  const prepared = await f.engine.prepare(fixed.bytes, 'winfix1 package');
  assert.equal(prepared.duplicate, false);
  assert.notEqual(prepared.task.id, stopped.id);
  assert.notEqual(prepared.task.bundleHash, stopped.bundleHash);
  assert.equal(prepared.task.version, stopped.version);
  assert.equal(prepared.task.authorized, false);
  f.engine.authorize(prepared.task.id, fingerprint(f.engine.preview(prepared.task)), 'full');
  const done = await f.engine.run(prepared.task.id);
  assert.equal(done.error, null, JSON.stringify(done.error));
  assert(done.remoteMerged && done.localSynced);
  assert.notEqual(done.worktree, stopped.worktree);
  assert.equal(f.gh.createCount, 1);
  assert.equal(f.gh.mergeCount, 1);
  assert.equal(readFileSync(join(f.repo, 'new.txt'), 'utf8'), 'corrected version, same release number\n');
  assert.deepEqual(readFileSync(join(stopped.worktree, 'new.txt')), oldBytes);
  assert.deepEqual(readFileSync(join(f.store.root, 'cache', stopped.bundleHash + '.zip')), oldCache);
  assert.equal(f.store.get(stopped.id).state, 'applied');
  assert.equal(git(stopped.worktree, 'rev-parse', 'HEAD'), f.baseSha);
});
