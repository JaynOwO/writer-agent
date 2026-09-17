// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprint } from '../src/common.mjs';
import { fixture, delivery, git } from './helpers.mjs';

test('CI-failed PR is preserved when a corrected same-version package opens and merges a separate approved PR', async t => {
  const f = await fixture(t);
  f.gh.ciState = 'failed';
  const old = (await f.engine.prepare(f.bytes, 'old CI-failed package')).task;
  f.engine.authorize(old.id, fingerprint(f.engine.preview(old)), 'full');
  const stopped = await f.engine.run(old.id);
  assert.equal(stopped.error.code, 'CI_FAILED');
  assert.equal(stopped.state, 'ci-waiting');
  assert.equal(f.gh.mergeCount, 0);
  const oldRecord = f.store.get(old.id);
  const oldCache = readFileSync(join(f.store.root, 'cache', stopped.bundleHash + '.zip'));
  const oldWork = readFileSync(join(stopped.worktree, 'new.txt'));
  const oldPr = await f.gh.pull(stopped.prNumber);

  const files = new Map(f.files); files.set('new.txt', Buffer.from('CI correction at the same release number\n'));
  const fixed = delivery(f.baseFiles, files, f.baseSha, f.baseTree);
  const next = await f.engine.prepare(fixed.bytes, 'winfix2 package');
  assert.equal(next.duplicate, false); assert.equal(next.task.authorized, false);
  assert.notEqual(next.task.id, stopped.id); assert.notEqual(next.task.bundleHash, stopped.bundleHash);
  f.engine.authorize(next.task.id, fingerprint(f.engine.preview(next.task)), 'full');
  f.gh.ciState = 'passed';
  const done = await f.engine.run(next.task.id);
  assert.equal(done.error, null, JSON.stringify(done.error));
  assert.equal(done.remoteMerged, true); assert.equal(done.localSynced, true);
  assert.notEqual(done.prNumber, stopped.prNumber);
  assert.equal(f.gh.createCount, 2); assert.equal(f.gh.mergeCount, 1);
  assert.deepEqual(f.store.get(old.id), oldRecord);
  assert.deepEqual(readFileSync(join(f.store.root, 'cache', stopped.bundleHash + '.zip')), oldCache);
  assert.deepEqual(readFileSync(join(stopped.worktree, 'new.txt')), oldWork);
  assert.equal(git(stopped.worktree, 'rev-parse', 'HEAD'), stopped.commitSha);
  const retainedPr = await f.gh.pull(oldPr.number);
  assert.equal(retainedPr.state, 'open'); assert.equal(retainedPr.merged, false);
  assert.equal(retainedPr.head.sha, oldPr.head.sha);
});
