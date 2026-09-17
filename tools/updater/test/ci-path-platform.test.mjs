// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const flavour of ['posix', 'win32']) {
  test(`Linux CI staging keeps POSIX paths with ${flavour} host path defaults`, () => {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/ci-path-host.mjs', import.meta.url)), flavour], {
      encoding: 'utf8', timeout: 15_000, windowsHide: true, maxBuffer: 256_000
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const result = JSON.parse(child.stdout.trim());
    assert.equal(result.pathFlavour, flavour);
    assert.equal(result.intercepted, true);
    assert.equal(result.linuxPathCases, 4);
    assert.equal(result.platformAndConsentRefusals, 3);
    assert.equal(result.noFilesystemOrPrivilegeChanges, true);
  });
}
