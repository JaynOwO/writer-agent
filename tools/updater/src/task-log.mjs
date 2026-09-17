// SPDX-License-Identifier: Apache-2.0
// Read only the selected task's existing log; never execute, retry, or discover files.
import { lstatSync, openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';
import { join } from 'node:path';
import { insist, ordinary } from './common.mjs';
export const LOG_TAIL_BYTES = 256 * 1024;
export function cleanLogText(value) {
  return String(value ?? '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
}
/** Best-effort redaction of known credential patterns, NOT a general privacy guarantee. */
export function redactLogText(value) {
  return cleanLogText(value)
    .replace(/\b(?:gh[oprsu]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,})\b/g, '[REDACTED_TOKEN]')
    .replace(/\b(Bearer|Basic)[ \t]+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:api_key|apikey|access_token|auth_token|token)=)[^\s&#"']+/gi, '$1[REDACTED]');
}
export function readTaskLog(root, id, { maxBytes = LOG_TAIL_BYTES } = {}) {
  insist(typeof id === 'string' && /^[a-z0-9-]{10,80}$/.test(id), 'TASK_NOT_FOUND', 'Invalid task ID.');
  insist(Number.isSafeInteger(maxBytes) && maxBytes >= 1024 && maxBytes <= LOG_TAIL_BYTES, 'LOG_LIMIT', 'Invalid log tail limit.');
  ordinary(root, 'directory'); const directory = join(root, 'logs'); ordinary(directory, 'directory');
  const path = join(directory, id + '.log');
  let before;
  try { before = lstatSync(path, { bigint: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return { available: false, text: '', totalBytes: 0, startByte: 0, bytesRead: 0, truncated: false };
    throw error;
  }
  insist(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n, 'UNSAFE_PATH', 'Linked or non-ordinary task log refused.');
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    const current = fstatSync(fd, { bigint: true });
    insist(current.isFile() && current.nlink === 1n && current.dev === before.dev && current.ino === before.ino,
      'LOG_CHANGED', 'Task log identity changed during read.');
    insist(current.size <= BigInt(Number.MAX_SAFE_INTEGER), 'LOG_LIMIT', 'Task log exceeds the supported file-offset range.');
    const totalBytes = Number(current.size), startByte = Math.max(0, totalBytes - maxBytes);
    const buffer = Buffer.alloc(totalBytes - startByte); let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const n = readSync(fd, buffer, bytesRead, buffer.length - bytesRead, startByte + bytesRead);
      if (!n) break; bytesRead += n;
    }
    return { available: true, text: cleanLogText(buffer.subarray(0, bytesRead).toString('utf8')),
      totalBytes, startByte, bytesRead, truncated: startByte > 0 };
  } finally { if (fd !== undefined) closeSync(fd); }
}
export function processErrorDetails(error) {
  const d = error?.details;
  if (!d || typeof d !== 'object') return null;
  return {
    exitCode: Number.isInteger(d.exitCode) ? d.exitCode : null,
    signal: typeof d.signal === 'string' && /^[A-Z0-9]{1,30}$/.test(d.signal) ? d.signal : null,
    stdoutTail: typeof d.stdout === 'string' ? redactLogText(d.stdout.slice(-12000)) : '',
    stderrTail: typeof d.stderr === 'string' ? redactLogText(d.stderr.slice(-12000)) : ''
  };
}
