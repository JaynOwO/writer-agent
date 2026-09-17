// SPDX-License-Identifier: Apache-2.0
/** Desktop test instrumentation only. Never changes the normal application defaults. */
import { setTimeout as sleep } from 'node:timers/promises';
import { createHash } from 'node:crypto';

export const CAPTURE_DELAYS_MS = Object.freeze([150, 400]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PAINT_READY = `new Promise((resolve, reject) => {
  Promise.resolve(document.fonts.ready).then(() => requestAnimationFrame(() =>
    requestAnimationFrame(() => resolve({width: innerWidth, height: innerHeight}))), reject);
})`;

export function configureSmokeRendering(app, { platform = process.platform, headless = false } = {}) {
  if (!headless) return 'default';
  if (platform !== 'linux' || app.isReady()) throw Error('Headless rendering must be configured on Linux before Electron is ready.');
  // Xvfb provides an X11 display, not a physical GPU. Software compositing is a
  // deterministic test mode; no renderer/process sandbox switch is changed.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  return 'software-x11';
}

async function bounded(operation, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(Error(`${label} timed out.`), { code: 'CAPTURE_TIMEOUT' })), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

/** A capture failure is still fatal after the finite attempts; no placeholder PNG. */
export async function captureSmokeImage(window, { timeoutMs = 5000, wait = sleep } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw Error('Invalid capture deadline.');
  const errors = [];
  for (let attempt = 0; ; attempt++) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) throw Error('Cannot capture a destroyed desktop window.');
    try {
      const viewport = await bounded(() => window.webContents.executeJavaScript(PAINT_READY), timeoutMs, 'Render readiness');
      if (![viewport?.width, viewport?.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 8192)) {
        throw Error('Invalid capture viewport.');
      }
      const image = await bounded(() => window.webContents.capturePage(
        { x: 0, y: 0, width: viewport.width, height: viewport.height }, { stayAwake: true }
      ), timeoutMs, 'Page capture');
      if (image.isEmpty()) throw Object.assign(Error('Empty compositor capture.'), { code: 'EMPTY_CAPTURE' });
      const { width, height } = image.getSize();
      if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 16384)) throw Error('Invalid captured image dimensions.');
      const png = image.toPNG();
      if (!Buffer.isBuffer(png) || png.length < 33 || png.length > 20_000_000 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw Error('Invalid captured PNG.');
      }
      return { png, width, height, attempts: attempt + 1, retryErrors: errors,
        sha256: createHash('sha256').update(png).digest('hex') };
    } catch (error) {
      // Retry only an explicitly identified compositor-empty/Viz result. A
      // destroyed renderer, timeout, invalid PNG or any other failure stays fatal.
      const transient = error?.message === 'UnknownVizError' || error?.code === 'EMPTY_CAPTURE';
      if (!transient || attempt >= CAPTURE_DELAYS_MS.length) throw error;
      errors.push(String(error.message));
      await wait(CAPTURE_DELAYS_MS[attempt]);
    }
  }
}
