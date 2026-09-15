// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
test('all six project manifests adopt Apache-2.0 and v0.0.2 without enabling npm publication',()=>{
  for(const dir of ['.','apps/cli','packages/core','packages/models','packages/storage','tests']){
    const p=JSON.parse(readFileSync(join(root,dir,'package.json'),'utf8')) as {version:string;license:string;private:boolean};
    assert.equal(p.version,'0.0.2');assert.equal(p.license,'Apache-2.0');assert.equal(p.private,true);
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
test('CI explicitly runs both demos without configuring a real model key',()=>{
  const ci=readFileSync(join(root,'.github/workflows/ci.yml'),'utf8');assert.match(ci,/pnpm demo:provider/);assert.match(ci,/pnpm install --frozen-lockfile/);assert.doesNotMatch(ci,/secrets\./);
});
