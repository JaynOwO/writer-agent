// SPDX-License-Identifier: Apache-2.0
import { promises as fs } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// A local filesystem retry only. Never use this for Git, HTTP, or whole install steps.
// 11 attempts; at most 5.5 seconds of deliberate waiting. Persistent denial still fails.
export const RENAME_RETRY_DELAYS_MS = Object.freeze(
  Array.from({ length: 10 }, (_, index) => (index + 1) * 100),
);
const retryable = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Retry a contended rename, rechecking the caller's expected paths before EVERY try.
 * The guard is outside the catch: conflicts, failed hashes and bad paths never retry.
 * Dependencies are injectable for fault tests; production callers use filesystem defaults.
 */
export async function renameWithRetry(from, to, {
  beforeAttempt,
  rename = (source, target) => fs.rename(source, target),
  wait = sleep,
} = {}) {
  if (typeof beforeAttempt !== 'function') {
    throw new TypeError('A rename state guard is required.');
  }
  for (let retry = 0; ; retry++) {
    await beforeAttempt();
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (!retryable.has(error?.code) || retry === RENAME_RETRY_DELAYS_MS.length) {
        if (retryable.has(error?.code)) {
          error.renameAttempts = retry + 1;
          error.renameRetryWaitMs = RENAME_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
        }
        throw error;
      }
      await wait(RENAME_RETRY_DELAYS_MS[retry]);
    }
  }
}
