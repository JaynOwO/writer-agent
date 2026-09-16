// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const {checkReadmePair,checkReadmes}=await import(new URL('../../scripts/check-readme-parity.mjs',import.meta.url).href) as {
  checkReadmePair:(en:string,zh:string,facts:unknown,manifest:unknown)=>boolean;
  checkReadmes:(dir:string)=>void;
};
const en=readFileSync(join(root,'README.md'),'utf8'),zh=readFileSync(join(root,'README.zh-CN.md'),'utf8');
const facts:Record<string,unknown>=JSON.parse(readFileSync(join(root,'docs/readme-facts.json'),'utf8')) as Record<string,unknown>;
const manifest:Record<string,unknown>=JSON.parse(readFileSync(join(root,'package.json'),'utf8')) as Record<string,unknown>;
test('English and Simplified Chinese READMEs agree mechanically with manifest',()=>assert.equal(checkReadmePair(en,zh,facts,manifest),true));
for(const [name,from,to] of [
  ['visible version',`**v${String(manifest.version)}**`,'**v0.0.0**'],
  ['version marker',`siglum:version=${String(manifest.version)}`,'siglum:version=0.0.0'],
  ['license marker','siglum:license=Apache-2.0','siglum:license=MIT'],
  ['language switch','[简体中文](README.zh-CN.md)','[Chinese](wrong.md)'],
  ['section','<!-- section:sources -->',''],
  ['feature','<!-- feature:provenance -->',''],
  ['limitation','<!-- limit:bounded-web-search -->',''],
  ['installation command','pnpm install --frozen-lockfile','pnpm install --no-frozen-lockfile'],
] as const)test('README checker catches '+name+' drift',()=>{
  assert.ok(zh.includes(from),'Test fixture must exercise existing content');assert.throws(()=>checkReadmePair(en,zh.replace(from,to),facts,manifest));
});
test('README checker catches stale central facts rather than merely comparing two stale translations',()=>assert.throws(()=>checkReadmePair(en,zh,{...facts,version:'0.0.2'},manifest)));
test('README checker rejects duplicated marker',()=>assert.throws(()=>checkReadmePair(en,zh+'\n<!-- feature:provenance -->',facts,manifest)));
test('README links point to existing repository files, and a broken target is caught',t=>{
  checkReadmes(root);
  const dir=mkdtempSync(join(tmpdir(),'siglum-docs-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  for(const name of ['README.md','README.zh-CN.md','package.json','LICENSE','NOTICE','CONTRIBUTING.md','AGENTS.md','docs'])cpSync(join(root,name),join(dir,name),{recursive:true});
  writeFileSync(join(dir,'README.md'),en+'\n[Missing](not-present.md)\n');
  assert.throws(()=>checkReadmes(dir),/Broken link/);
});
