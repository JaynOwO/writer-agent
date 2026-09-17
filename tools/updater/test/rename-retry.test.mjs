// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { renameWithRetry, RENAME_RETRY_DELAYS_MS } from '../src/rename-retry.mjs';
const failure = code => Object.assign(new Error('injected filesystem failure'), { code });

test('rename retry has a fixed, finite delay budget and requires a state guard', async () => {
  assert(Object.isFrozen(RENAME_RETRY_DELAYS_MS));
  assert.equal(RENAME_RETRY_DELAYS_MS.length, 10);
  assert.equal(RENAME_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0), 5500);
  await assert.rejects(renameWithRetry('source', 'target'), TypeError);
});
test('successful rename checks state once and never sleeps', async () => {
  let guards = 0, calls = 0;
  await renameWithRetry('source', 'target', {
    beforeAttempt: async () => { guards++; },
    rename: async (from, to) => { assert.equal(from, 'source'); assert.equal(to, 'target'); calls++; },
    wait: async () => assert.fail('unexpected sleep'),
  });
  assert.equal(guards, 1); assert.equal(calls, 1);
});
for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test('retry transient ' + code + ' without changing paths; recheck state each time', async () => {
    let guards = 0, calls = 0;
    const delays = [];
    await renameWithRetry('source', 'target', {
      beforeAttempt: async () => { guards++; },
      rename: async (from, to) => {
        assert.equal(from, 'source'); assert.equal(to, 'target');
        if (++calls < 3) throw failure(code);
      },
      wait: async ms => { delays.push(ms); },
    });
    assert.equal(calls, 3); assert.equal(guards, 3); assert.deepEqual(delays, [100, 200]);
  });
  test('persistent ' + code + ' still fails after the fixed limit, preserving the original error', async () => {
    let guards = 0, calls = 0;
    const delays = [], error = failure(code);
    await assert.rejects(renameWithRetry('source', 'target', {
      beforeAttempt: async () => { guards++; },
      rename: async () => { calls++; throw error; },
      wait: async ms => { delays.push(ms); },
    }), actual => actual === error && actual.renameAttempts === 11 && actual.renameRetryWaitMs === 5500);
    assert.equal(calls, 11); assert.equal(guards, 11); assert.deepEqual(delays, [...RENAME_RETRY_DELAYS_MS]);
  });
}
for (const code of ['ENOENT', 'EXDEV', 'EINVAL', 'ENOTEMPTY', 'EEXIST', 'ENOSPC']) {
  test('structural error ' + code + ' fails immediately without replay', async () => {
    let calls = 0;
    const error = failure(code);
    await assert.rejects(renameWithRetry('source', 'target', {
      beforeAttempt: async () => {},
      rename: async () => { calls++; throw error; },
      wait: async () => assert.fail('unexpected retry'),
    }), actual => actual === error);
    assert.equal(calls, 1);
  });
}
test('a guard error never becomes a retryable rename error', async () => {
  await assert.rejects(renameWithRetry('source', 'target', {
    beforeAttempt: async () => { throw failure('EPERM'); },
    rename: async () => assert.fail('guard must run first'),
    wait: async () => assert.fail('guard failure is not retried'),
  }), { code: 'EPERM' });
});
test('state change during wait blocks the next filesystem mutation', async () => {
  let checks = 0, calls = 0;
  await assert.rejects(renameWithRetry('source', 'target', {
    beforeAttempt: async () => { if (++checks === 2) throw failure('HASH_CHANGED'); },
    rename: async () => { calls++; throw failure('EPERM'); },
    wait: async () => {},
  }), { code: 'HASH_CHANGED' });
  assert.equal(calls, 1);
});
test('cancelled wait stops further rename attempts', async () => {
  let calls = 0;
  await assert.rejects(renameWithRetry('source', 'target', {
    beforeAttempt: async () => {},
    rename: async () => { calls++; throw failure('EBUSY'); },
    wait: async () => { throw failure('ABORT_ERR'); },
  }), { code: 'ABORT_ERR' });
  assert.equal(calls, 1);
});
