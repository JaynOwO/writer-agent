// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
test('all six project manifests adopt Apache-2.0 and v0.0.7 without enabling npm publication',()=>{
  for(const dir of ['.','apps/cli','packages/core','packages/models','packages/storage','tests']){
    const p=JSON.parse(readFileSync(join(root,dir,'package.json'),'utf8')) as {version:string;license:string;private:boolean};
    assert.equal(p.version,'0.0.7');assert.equal(p.license,'Apache-2.0');assert.equal(p.private,true);
  }
});
test('license includes standard terms and appendix; notice identifies the project',()=>{
  const license=readFileSync(join(root,'LICENSE'),'utf8');assert.match(license,/Version 2\.0, January 2004/);assert.match(license,/4\. Redistribution/);assert.match(license,/6\. Trademarks/);assert.match(license,/APPENDIX: How to apply/);
  const notice=readFileSync(join(root,'NOTICE'),'utf8');assert.match(notice,/JaynOwO and contributors/);
});
test('runtime packages keep only the already-declared workspace dependencies',()=>{
  for(const dir of ['apps/cli','packages/core','packages/models','packages/storage','tests']){
    const p=JSON.parse(readFileSync(join(root,dir,'package.json'),'utf8')) as {dependencies?:Record<string,string>};
    for(const[name,version]of Object.entries(p.dependencies??{})){assert.match(name,/^@writer-agent\//);assert.equal(version,'workspace:*');}
  }
});
test('CI explicitly runs all seven demos without configuring a real model key',()=>{
  const ci=readFileSync(join(root,'.github/workflows/ci.yml'),'utf8');assert.match(ci,/pnpm demo:provider/);assert.match(ci,/pnpm demo:sources/);assert.match(ci,/pnpm demo:review/);assert.match(ci,/pnpm demo:memory/);assert.match(ci,/pnpm demo:workflow/);assert.match(ci,/pnpm demo:extensions/);assert.match(ci,/pnpm install --frozen-lockfile/);assert.doesNotMatch(ci,/secrets\./);
});

test('public CLI and core demo identify Siglum v0.0.7 while repository names stay compatible',()=>{
  for(const file of ['apps/cli/src/index.ts','apps/cli/src/demo.ts'])assert.match(readFileSync(join(root,file),'utf8'),/Siglum v0\.0\.7/);
  const p=JSON.parse(readFileSync(join(root,'package.json'),'utf8')) as {name:string;scripts:Record<string,string>};
  assert.equal(p.name,'writer-agent');assert.equal(p.scripts.siglum,p.scripts.writer);
});


test('new review guide translations retain matching executable command examples',()=>{
  const en=readFileSync(join(root,'docs/review.md'),'utf8'),zh=readFileSync(join(root,'docs/review.zh-CN.md'),'utf8');
  const commands=(text:string)=>[...text.matchAll(/```sh\n([\s\S]*?)```/g)].map(m=>m[1]!.trim());
  assert.deepEqual(commands(en),commands(zh));
  for(const text of [en,zh]){assert.match(text,/REVIEW_DEMO_OK/);assert.match(text,/model-assessment-not-verified/);assert.match(text,/mapping:N/);assert.match(text,/assessment:N/);}
});
test('manual claim JSON shown in both review guides has exact quote offsets',async()=>{
  const {pinAnchor}=await import('@writer-agent/core');
  for(const file of ['docs/review.md','docs/review.zh-CN.md']){
    const text=readFileSync(join(root,file),'utf8');const code=/```json\n([\s\S]*?)```/.exec(text)!;
    const example=JSON.parse(code[1]!) as {anchors:{blockId:string;start:number;end:number;quote:string}[]};
    const a=example.anchors[0]!;
    assert.doesNotThrow(()=>pinAnchor({blocks:[{id:a.blockId,version:1,text:'Some teams may improve.',separator:''}]},a));
  }
});
test('analysis demo is wired into the CLI, root scripts and CI but no updater is added to runtime',()=>{
  const p=JSON.parse(readFileSync(join(root,'package.json'),'utf8')) as {scripts:Record<string,string>};
  assert.equal(p.scripts['demo:review'],'node scripts/review-demo.mjs');
  assert.match(readFileSync(join(root,'apps/cli/src/index.ts'),'utf8'),/demo:review/);
  assert.doesNotMatch(JSON.stringify(p.scripts),/auto-update|gh pr|git push/);
});

test('paired memory guides use identical runnable command/JSON examples and mark privacy boundaries',async()=>{
  const {validateIntentCard,validatePreferenceInput,normalizeMemoryOptions}=await import('@writer-agent/core');
  const en=readFileSync(join(root,'docs/memory.md'),'utf8'),zh=readFileSync(join(root,'docs/memory.zh-CN.md'),'utf8');
  const blocks=(s:string)=>[...s.matchAll(/```(?:sh|json)\n([\s\S]*?)```/g)].map(m=>m[1]!.trim());assert.deepEqual(blocks(en),blocks(zh));
  for(const text of [en,zh]){
    assert.match(text,/MEMORY_DEMO_OK/);assert.match(text,/candidate/);assert.match(text,/--feedback-examples/);
    const jsons=[...text.matchAll(/```json\n([\s\S]*?)```/g)].map(m=>JSON.parse(m[1]!) as unknown);
    assert.equal(jsons.length,3);assert.doesNotThrow(()=>validateIntentCard(jsons[0]));assert.doesNotThrow(()=>validatePreferenceInput(jsons[1]));assert.doesNotThrow(()=>normalizeMemoryOptions({exceptions:jsons[2] as never}));
  }
});
test('memory guide/demo are actual commands without changing updater or tool execution permissions',()=>{
  const p=JSON.parse(readFileSync(join(root,'package.json'),'utf8')) as {scripts:Record<string,string>};
  assert.equal(p.scripts['demo:memory'],'node scripts/memory-demo.mjs');assert.doesNotMatch(JSON.stringify(p.scripts),/auto-update|git push|gh pr/);
  const guide=readFileSync(join(root,'apps/cli/src/wizard.ts'),'utf8');assert.match(guide,/runMemoryTask/);assert.match(guide,/submitSuggestion/);assert.match(guide,/runAnalysis/);
});
