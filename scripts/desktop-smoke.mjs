// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSmokeWorkspace, smokeRuntimeDirectory, waitForSmokeChild, finalizeSmoke } from './desktop-smoke-support.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'apps/desktop/runtime-lock.json'), 'utf8'));
const dir = smokeRuntimeDirectory({ root, version: lock.version, argv: process.argv.slice(2) });
const binary = join(dir, process.platform === 'win32' ? 'electron.exe' : 'electron');
if (!existsSync(binary)) throw Error('Verified Electron runtime missing. Run the explicit desktop-runtime helper or supply --runtime.');
let file = binary, args = [join(root, 'apps/desktop/test')];
const headless = process.platform === 'linux' && !process.env.DISPLAY;
if (headless) {
  file = '/usr/bin/xvfb-run';
  if (!existsSync(file)) throw Error('An X display or xvfb-run is required; the renderer sandbox will not be disabled.');
  args = ['-a', binary, ...args];
}
const owner = createSmokeWorkspace();
const output = join(root, '.cache', 'desktop-test', owner.id); mkdirSync(output, { recursive: true });
const env = { ...process.env, SIGLUM_TEST_OUTPUT: output, SIGLUM_E2E_ROOT: owner.root, SIGLUM_E2E_ID: owner.id, SIGLUM_E2E_XVFB: headless ? '1' : '0' };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
// The CI runtime has its own adjacent, protected helper. Do not rely on the
// development environment fallback, which loses to an adjacent chrome-sandbox.
if (env.SIGLUM_CI_RUNTIME) delete env.CHROME_DEVEL_SANDBOX;
const child = await waitForSmokeChild(file, args, { cwd: root, env });
const result = await finalizeSmoke(owner, child, { output, expectedElectron: lock.version });
writeFileSync(join(output, 'desktop-smoke-result.json'), JSON.stringify(result, null, 2) + '\n');
console.log('DESKTOP_SMOKE_REPORT', join(output, 'desktop-smoke-result.json'));
if (result.passed) console.log('DESKTOP_E2E_OK', result.checks, '— Electron exited and owned temporary data cleaned.');
else { console.error('DESKTOP_SMOKE_FAILED', JSON.stringify(result)); process.exitCode = 1; }
