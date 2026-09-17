// SPDX-License-Identifier: Apache-2.0
// Subprocess-only regression: load the actual CI module with a Windows or POSIX
// default node:path API. No process.platform mutation, filesystem writes or
// privilege changes; explicit path.posix always remains the real POSIX API.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const flavour = process.argv[2];
assert(['posix', 'win32'].includes(flavour));
const target = new URL('../../../../scripts/desktop-sandbox-ci.mjs', import.meta.url).href;
const shim = 'data:text/javascript,' + encodeURIComponent(`
  import { posix, win32 } from 'node:path';
  export { posix, win32 };
  export const join = ${flavour}.join;
  export const resolve = ${flavour}.resolve;
  export const dirname = ${flavour}.dirname;
`);
let intercepted = false;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:path' && context.parentURL === target) {
      intercepted = true;
      return { url: shim, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
const { ciStagePath } = await import(target);
assert.equal(intercepted, true, 'The production module must use the selected path shim.');
const env = { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: '/tmp' };
for (const [temp, expected] of [
  ['/tmp', '/tmp/siglum-sandbox-123-1'],
  ['/tmp/', '/tmp/siglum-sandbox-123-1'],
  ['/home/runner/work/_temp', '/home/runner/work/_temp/siglum-sandbox-123-1'],
  ['/tmp/Siglum 文稿', '/tmp/Siglum 文稿/siglum-sandbox-123-1']
]) {
  assert.equal(ciStagePath({ ...env, RUNNER_TEMP: temp }, 'linux'), expected);
}
for (const platform of ['win32', 'darwin']) assert.throws(() => ciStagePath(env, platform));
assert.throws(() => ciStagePath({ ...env, GITHUB_ACTIONS: '' }, 'linux'));
console.log(JSON.stringify({ pathFlavour: flavour, intercepted, linuxPathCases: 4, platformAndConsentRefusals: 3, noFilesystemOrPrivilegeChanges: true }));
