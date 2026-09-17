// SPDX-License-Identifier: Apache-2.0
/** CI-only preparation of a verified helper. This module never invokes sudo,
 * changes kernel/AppArmor settings, or executes downloaded bytes. The workflow
 * copies the verified runtime to a fresh root-owned directory on its disposable VM,
 * with the helper beside the Electron executable (Chromium checks it there first).
 */
import { readFileSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { join, resolve, posix, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readZip } from '../tools/updater/src/zip.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifiedSandboxBytes(archive, asset, extracted) {
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 200_000_000 ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) || archive.length !== asset.bytes || hash(archive) !== asset.sha256) {
    throw Error('Sandbox preparation refused: runtime archive differs from the exact lock.');
  }
  const helper = readZip(archive, { compressed: 200_000_000, total: 600_000_000,
    file: 400_000_000, entries: 2000, ratio: 500 }).get('chrome-sandbox');
  if (!helper || helper.length < 4 || helper.length > 4_000_000 ||
      !helper.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw Error('Sandbox preparation refused: locked archive has no supported ELF helper.');
  }
  if (!helper.equals(extracted)) throw Error('Sandbox preparation refused: extracted helper was modified.');
  return { bytes: helper, sha256: hash(helper) };
}
function ordinaryFile(path, max) {
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > max) {
    throw Error('Sandbox preparation refused: linked, oversized or non-ordinary file.');
  }
  return readFileSync(path);
}
export function stageSandbox(projectRoot, target) {
  const lock = JSON.parse(ordinaryFile(join(projectRoot, 'apps/desktop/runtime-lock.json'), 32_000));
  if (!/^\d+\.\d+\.\d+$/.test(lock.version)) throw Error('Invalid runtime version.');
  const asset = lock.assets['linux-x64'];
  if (asset.name !== `electron-v${lock.version}-linux-x64.zip`) throw Error('Invalid runtime filename.');
  const cache = join(projectRoot, '.cache/desktop');
  const verified = verifiedSandboxBytes(ordinaryFile(join(cache, asset.name), 200_000_000), asset,
    ordinaryFile(join(cache, `electron-${lock.version}-linux-x64`, 'chrome-sandbox'), 4_000_000));
  mkdirSync(target, { mode: 0o700 }); // Existing directories are never reused/overwritten.
  writeFileSync(join(target, 'chrome-sandbox'), verified.bytes, { flag: 'wx', mode: 0o700 });
  writeFileSync(join(target, 'helper.sha256'), verified.sha256 + '\n', { flag: 'wx', mode: 0o600 });
  return verified.sha256;
}
/** Fresh runtime staging from the pinned archive, not a recursive copy of a mutable cache. */
export function stageSandboxRuntime(projectRoot, target) {
  const lock = JSON.parse(ordinaryFile(join(projectRoot, 'apps/desktop/runtime-lock.json'), 32_000));
  if (!/^\d+\.\d+\.\d+$/.test(lock.version)) throw Error('Invalid runtime version.');
  const asset = lock.assets['linux-x64'];
  if (asset.name !== `electron-v${lock.version}-linux-x64.zip`) throw Error('Invalid runtime filename.');
  const cache = join(projectRoot, '.cache/desktop');
  const archive = ordinaryFile(join(cache, asset.name), 200_000_000);
  const helper = verifiedSandboxBytes(archive, asset,
    ordinaryFile(join(cache, `electron-${lock.version}-linux-x64`, 'chrome-sandbox'), 4_000_000));
  const files = readZip(archive, { compressed: 200_000_000, total: 600_000_000,
    file: 400_000_000, entries: 2000, ratio: 500 });
  for (const name of ['electron', 'chrome_crashpad_handler']) {
    if (!files.get(name)?.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
      throw Error('Locked archive is missing a supported runtime executable.');
    }
  }
  // sha256sum's line format must not be interpretable as options/escaped names.
  for (const name of files.keys()) if (!/^[a-zA-Z0-9_.\/-]+$/.test(name)) throw Error('Unsupported runtime checksum filename.');
  mkdirSync(target, { mode: 0o700 });
  const runtime = join(target, 'runtime'), sums = [];
  mkdirSync(runtime, { mode: 0o755 });
  for (const [name, bytes] of files) {
    const path = join(runtime, ...name.split('/'));
    mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
    const executable = ['electron', 'chrome-sandbox', 'chrome_crashpad_handler'].includes(name);
    writeFileSync(path, bytes, { flag: 'wx', mode: executable ? 0o755 : 0o644 });
    sums.push(`${hash(bytes)}  ${name}`);
  }
  writeFileSync(join(target, 'runtime.sha256'), sums.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(target, 'helper.sha256'), helper.sha256 + '\n', { flag: 'wx', mode: 0o600 });
  return { runtime, files: files.size, helperSha256: helper.sha256, archiveSha256: asset.sha256 };
}
export function ciStagePath(env, platform = process.platform) {
  if (platform !== 'linux' || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_OS !== 'Linux' ||
      !/^\d+$/.test(env.GITHUB_RUN_ID || '') || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT || '') ||
      typeof env.RUNNER_TEMP !== 'string' || !env.RUNNER_TEMP.startsWith('/')) {
    throw Error('This preparation entry is for an explicitly configured Linux GitHub Actions job only.');
  }
  // This path targets Linux even when a Windows host is testing the Linux guard.
  // Keep local file operations above native; only the target CI path is POSIX.
  return posix.join(env.RUNNER_TEMP, `siglum-sandbox-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw Error('No command arguments are accepted.');
  const destination = ciStagePath(process.env);
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  console.log('SANDBOX_RUNTIME_VERIFIED', JSON.stringify(stageSandboxRuntime(projectRoot, destination)));
}
