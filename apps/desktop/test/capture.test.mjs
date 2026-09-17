// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureSmokeRendering, captureSmokeImage, CAPTURE_DELAYS_MS } from '../../../scripts/desktop-capture-support.mjs';

// A tiny PNG fixture is only for contract checks. Actual PNG output is required
// separately by the real Electron scenario; this cannot certify visual rendering.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ9sAAAAASUVORK5CYII=', 'base64');
function fakeWindow(capture = async () => ({ isEmpty: () => false, getSize: () => ({ width: 640, height: 480 }), toPNG: () => png })) {
  const calls = [];
  return { calls, isDestroyed: () => false, webContents: {
    isDestroyed: () => false,
    executeJavaScript: async code => { calls.push('paint'); assert(code.includes('requestAnimationFrame')); return { width: 640, height: 480 }; },
    capturePage: async (rect, opts) => { calls.push('capture'); assert.deepEqual(rect, { x: 0, y: 0, width: 640, height: 480 }); assert.equal(opts.stayAwake, true); return capture(); }
  }};
}
test('only headless Linux test mode configures software X11 before ready, without sandbox changes', () => {
  const calls = [], app = { isReady: () => false, disableHardwareAcceleration: () => calls.push('software'), commandLine: { appendSwitch: (...args) => calls.push(args) } };
  assert.equal(configureSmokeRendering(app, { platform: 'linux', headless: true }), 'software-x11');
  assert.deepEqual(calls, ['software', ['ozone-platform', 'x11']]);
  assert.equal(configureSmokeRendering(app, { platform: 'win32', headless: false }), 'default');
  assert.throws(() => configureSmokeRendering(app, { platform: 'win32', headless: true }));
  assert.throws(() => configureSmokeRendering({ ...app, isReady: () => true }, { platform: 'linux', headless: true }));
  assert.equal(calls.length, 2);
});
test('capture waits for paint, validates PNG and records its actual digest', async () => {
  const window = fakeWindow(), result = await captureSmokeImage(window);
  assert.deepEqual(window.calls, ['paint', 'capture']); assert(result.png.equals(png));
  assert.equal(result.attempts, 1); assert.equal(result.retryErrors.length, 0); assert.match(result.sha256, /^[a-f0-9]{64}$/);
});
test('exact CI UnknownVizError is retried at a fresh frame, not by replaying writing tasks', async () => {
  let attempts = 0; const waits = [];
  const window = fakeWindow(async () => {
    if (++attempts < 3) throw Error('UnknownVizError');
    return { isEmpty: () => false, getSize: () => ({ width: 640, height: 480 }), toPNG: () => png };
  });
  const result = await captureSmokeImage(window, { wait: async ms => waits.push(ms) });
  assert.equal(attempts, 3); assert.equal(result.attempts, 3);
  assert.deepEqual(waits, CAPTURE_DELAYS_MS); assert.deepEqual(result.retryErrors, ['UnknownVizError', 'UnknownVizError']);
  assert.deepEqual(window.calls, ['paint', 'capture', 'paint', 'capture', 'paint', 'capture']);
});
test('permanent compositor failure does not produce a successful screenshot or loop indefinitely', async () => {
  let calls = 0;
  await assert.rejects(captureSmokeImage(fakeWindow(async () => { calls++; throw Error('UnknownVizError'); }), { wait: async () => {} }), /UnknownVizError/);
  assert.equal(calls, 3);
});
test('destroyed view, invalid PNG and unrelated errors are never retried into success', async () => {
  const dead = fakeWindow(); dead.isDestroyed = () => true;
  await assert.rejects(captureSmokeImage(dead), /destroyed/); assert.equal(dead.calls.length, 0);
  for (const capture of [async () => { throw Error('renderer crashed'); }, async () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => Buffer.from('not a PNG') })]) {
    const window = fakeWindow(capture); let waits = 0;
    await assert.rejects(captureSmokeImage(window, { wait: async () => waits++ })); assert.equal(waits, 0); assert.equal(window.calls.length, 2);
  }
});
test('stalled capture has a deadline rather than hanging CI', async () => {
  await assert.rejects(captureSmokeImage(fakeWindow(() => new Promise(() => {})), { timeoutMs: 20 }), { code: 'CAPTURE_TIMEOUT' });
});
test('real Electron fixture keeps screenshot mandatory and preserves failure progress', () => {
  const source = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
  assert.match(source, /check\('real compositor screenshot/); assert.match(source, /await captureSmokeImage/);
  assert.match(source, /failure=\{stage:currentStage/); assert.match(source, /passed,checks,versions:process\.versions,capture,rendering,failure/);
});
