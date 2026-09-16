// SPDX-License-Identifier: Apache-2.0
import { lstatSync, realpathSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative, basename, sep } from 'node:path';
import { makeSkillPackage, hashBytes, extensionError, safeSkillPath } from '@writer-agent/core';
import type { SkillPackage, SkillFile } from '@writer-agent/core';
/** Bounded explicit-directory import; no ZIP extraction, repo installation or script execution. */
export function readSkillDirectory(directory: string): SkillPackage {
  const root = resolve(directory), st = lstatSync(root); if (!st.isDirectory() || st.isSymbolicLink()) extensionError('Select an ordinary skill directory, not a symlink.');
  const realRoot = realpathSync(root), files: SkillFile[] = []; let bytes = 0;
  function scan(dir: string, depth: number) {
    if (depth > 4) extensionError('Skill directory nesting exceeds four levels.');
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), item = lstatSync(path); if (item.isSymbolicLink()) extensionError('Skill packages cannot include symlinks.');
      const rel = relative(realRoot, realpathSync(path)); if (rel === '..' || rel.startsWith('..' + sep)) extensionError('Skill path escapes selected directory.');
      const key = relative(root, path).split(sep).join('/'); safeSkillPath(key);
      if (['.git', 'node_modules', 'scripts'].includes(name.toLowerCase())) extensionError('This importer supports instruction/reference-only packages, not scripts or dependency trees.');
      if (item.isDirectory()) { scan(path, depth + 1); continue; }
      if (!item.isFile() || item.size > 200000) extensionError('Skill file is non-regular or oversized.');
      bytes += item.size; if (bytes > 256000 || files.length >= 64) extensionError('Skill package exceeds count/byte limits.');
      let text: string; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path)); } catch { return extensionError('Skill text must be UTF-8.'); }
      files.push({ path: key, text, hash: hashBytes(text) });
    }
  }
  scan(root, 0); return makeSkillPackage(basename(root), files);
}
