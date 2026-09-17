// SPDX-License-Identifier: Apache-2.0
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const matches=(text,re)=>[...text.matchAll(re)].map(m=>m[1]);
/** Checks mechanical facts and command parity, never translation quality or semantic truth. */
export function checkReadmePair(en,zh,facts,manifest) {
  assert.equal(facts.version,manifest.version,'README facts version differs from package.json');
  assert.equal(facts.license,manifest.license,'README facts license differs from package.json');
  assert.equal(facts.brand,'Siglum');assert.match(facts.repository,/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);assert.equal(facts.repositoryId,'1370967185');
  const languages=[['README.md',en],['README.zh-CN.md',zh]];
  for(const[name,text]of languages) {
    assert.match(text,/^# Siglum\r?\n/,'Missing product heading in '+name);
    assert.ok(text.includes(`[English](README.md) | [简体中文](README.zh-CN.md)`),'Missing language switch in '+name);
    assert.deepEqual(matches(text,/<!-- siglum:version=([^ >]+) -->/g),[facts.version],'Version marker in '+name);
    assert.deepEqual(matches(text,/<!-- siglum:license=([^ >]+) -->/g),[facts.license],'License marker in '+name);
    assert.ok(text.includes('**v'+facts.version+'**'),'Visible version must match in '+name);
    assert.ok(text.includes('**'+facts.license+'**'),'Visible license must match in '+name);
    assert.ok(text.includes(facts.repository),'Repository identity missing in '+name);
    for(const provider of facts.providers)assert.ok(text.includes('`'+provider+'`'),'Missing provider '+provider+' in '+name);
    for(const[key,plural]of [['section','sections'],['feature','features'],['limit','limitations']]) {
      const markers=matches(text,new RegExp('<!-- '+key+':([a-z0-9-]+) -->','g'));
      assert.equal(new Set(markers).size,markers.length,'Duplicate '+key+' marker in '+name);
      assert.deepEqual([...markers].sort(),[...facts[plural]].sort(),'Missing or extra '+key+' marker in '+name);
    }
  }
  const commands=text=>matches(text,/^\s*(pnpm(?:\.cmd)? .+)$/gm).map(s=>s.trim());
  assert.deepEqual(commands(en),commands(zh),'README command examples diverge');
  return true;
}
export function checkReadmes(directory=root) {
  const facts=JSON.parse(readFileSync(resolve(directory,'docs/readme-facts.json'),'utf8'));
  const manifest=JSON.parse(readFileSync(resolve(directory,'package.json'),'utf8'));
  const en=readFileSync(resolve(directory,'README.md'),'utf8'),zh=readFileSync(resolve(directory,'README.zh-CN.md'),'utf8');
  checkReadmePair(en,zh,facts,manifest);
  for(const[name,text]of [['README.md',en],['README.zh-CN.md',zh]]) {
    for(const target of matches(text,/\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
      if(/^(?:https?:|#)/.test(target))continue;
      const file=target.split('#')[0];
      assert.ok(file&&!isAbsolute(file)&&!file.split('/').includes('..'),'Invalid README link: '+target);
      assert.ok(existsSync(resolve(directory,file)),'Broken link in '+name+': '+target);
    }
  }
  console.log('README_PARITY_OK — versions, license, section/feature/limit markers, commands and local links agree. Translation quality is a human review task.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))checkReadmes();
