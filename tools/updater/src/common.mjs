// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, readFileSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export class UpdateError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'UpdateError'; this.code = code; this.details = details; }
}
export function insist(value, code, message, details) { if (!value) throw new UpdateError(code, message, details); }
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const blobHash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export const now = () => new Date().toISOString();
export const newId = () => randomUUID();
export function text(value, label, max = 4096) {
  insist(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value), 'INVALID_INPUT', `Invalid ${label}.`); return value;
}
export function object(value, label = 'object') {
  insist(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', `Invalid ${label}.`); return value;
}
export function exactKeys(value, allowed, required = []) {
  object(value); insist(Object.keys(value).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(value, k)), 'INVALID_INPUT', 'Unknown or missing fields.');
}
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
export const fingerprint = value => sha256(Buffer.from(canonical(value)));
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y);
}
export function safeRelative(value) {
  text(value, 'package path', 1024);
  insist(!isAbsolute(value) && !value.includes('\\') && !value.includes(':') && !/[<>"|?*]/.test(value), 'UNSAFE_PATH', 'Unsafe package path.');
  const parts = value.split('/');
  insist(parts.every(p => p && p !== '.' && p !== '..' && !/[ .]$/.test(p) && !/^\.git$/i.test(p) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)), 'UNSAFE_PATH', 'Reserved, empty or escaping path.');
  return value;
}
export function ordinary(path, kind = 'file', missing = false) {
  let st; try { st = lstatSync(path); } catch (e) { if (missing && e.code === 'ENOENT') return null; throw e; }
  insist(!st.isSymbolicLink() && (kind === 'directory' ? st.isDirectory() : st.isFile() && st.nlink === 1), 'UNSAFE_PATH', 'Linked or non-ordinary path refused.', { path }); return st;
}
export function contained(root, name, missing = false) {
  safeRelative(name); ordinary(root, 'directory'); let cur = root;
  const parts = name.split('/');
  for (let i = 0; i < parts.length; i++) { cur = join(cur, parts[i]); ordinary(cur, i === parts.length - 1 ? 'file' : 'directory', missing); }
  const rel = relative(resolve(root), resolve(cur)); insist(rel && !rel.startsWith('..') && !isAbsolute(rel), 'UNSAFE_PATH', 'Path escapes root.'); return cur;
}
export function samePath(a, b) {
  const norm = p => { const q = realpathSync(p); return process.platform === 'win32' ? q.toLowerCase() : q; }; return norm(a) === norm(b);
}
export function readBounded(path, maxBytes = 64_000_000) {
  const st = ordinary(path); insist(st.size <= maxBytes, 'SIZE_LIMIT', 'File exceeds size limit.'); return readFileSync(path);
}
/** Atomic metadata replacement within an owned directory, not a general user-file overwrite API. */
export function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); ordinary(dirname(path), 'directory'); ordinary(path, 'file', true);
  const temp = path + '.tmp-' + newId(), fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(temp, path); } catch (e) { try { unlinkSync(temp); } catch {} throw e; }
}
export function errorRecord(e) {
  return { code: e instanceof UpdateError ? e.code : 'IO_ERROR', message: e instanceof UpdateError ? e.message : 'A local operation failed. See the bounded task log.', details: e instanceof UpdateError ? e.details : {}, at: now() };
}
export function parseVersion(value) {
  text(value, 'version', 100); const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([a-zA-Z0-9.-]+))?$/.exec(value);
  insist(m && m.slice(1,4).every(x => Number.isSafeInteger(Number(x))), 'INVALID_VERSION', 'Expected a semantic version.'); return m.slice(1,4).map(Number).concat(m[4] || '');
}
export function compareVersion(a, b) {
  const x = parseVersion(a), y = parseVersion(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  if (x[3] === y[3]) return 0; if (!x[3]) return 1; if (!y[3]) return -1;
  const p=x[3].split('.'),q=y[3].split('.');for(let i=0;i<Math.max(p.length,q.length);i++){if(p[i]===undefined)return -1;if(q[i]===undefined)return 1;if(p[i]===q[i])continue;const n=/^\d+$/.test(p[i]),m=/^\d+$/.test(q[i]);if(n&&m)return Number(p[i])-Number(q[i]);if(n!==m)return n?-1:1;return p[i]<q[i]?-1:1;}return 0;
}
export function sourceTreeHash(files){
  const root=new Map();for(const [path,data]of files){safeRelative(path);let dir=root;const parts=path.split('/');for(const p of parts.slice(0,-1)){if(!dir.has(p))dir.set(p,new Map());insist(dir.get(p) instanceof Map,'MANIFEST_INVALID','File/directory collision.');dir=dir.get(p);}insist(!dir.has(parts.at(-1)),'MANIFEST_INVALID','Duplicate path.');dir.set(parts.at(-1),Buffer.from(data));}
  const walk=dir=>{const entries=[...dir].sort((a,b)=>Buffer.compare(Buffer.from(a[0]+(a[1] instanceof Map?'/':'')),Buffer.from(b[0]+(b[1] instanceof Map?'/':''))));const chunks=[];for(const [name,value]of entries){const tree=value instanceof Map,h=tree?walk(value):blobHash(value);chunks.push(Buffer.from(`${tree?'40000':'100644'} ${name}\0`),Buffer.from(h,'hex'));}const raw=Buffer.concat(chunks);return createHash('sha1').update(`tree ${raw.length}\0`).update(raw).digest('hex');};return walk(root);
}
