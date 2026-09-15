// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Workspace } from '@writer-agent/storage';
import type { ModelProvider, ModelRequest, ModelResponse } from '@writer-agent/models';
import type { Change } from '@writer-agent/core';
import { fixture,propose } from './helpers.js';
import { wire } from './provider-helpers.js';
type Suggest = (w:Workspace,id:string,instruction:string,p:ModelProvider,s?:AbortSignal)=>Promise<{changes:Change[];notes:readonly string[]}>;
// Resolve the compiled application after the normal project-reference build.
const {suggestChanges} = await import(new URL('../../apps/cli/dist/suggest.js',import.meta.url).href) as {suggestChanges:Suggest};
function result(r:ModelRequest):ModelResponse {return {...wire(r),protocolVersion:1,providerId:'test'};}
test('application-owned baseline survives a provider mutating its input',async t=>{
  const{workspace:w,document:d}=fixture(t);
  const p:ModelProvider={id:'test',async propose(r){(r.snapshot.blocks[0] as {text:string}).text='FORGED';return result(r);}};
  await assert.rejects(suggestChanges(w,d.id,'test',p),{code:'PROVIDER_INVALID_PROPOSAL'});
  assert.equal(w.listChanges(d.id).length,0);assert.equal(w.getDocument(d.id).headRevisionId,d.headRevisionId);
});
test('custom providers cannot add acceptance flags at the application boundary',async t=>{
  const{workspace:w,document:d}=fixture(t);
  const p:ModelProvider={id:'test',async propose(r){return {...result(r),autoAccept:true};}};
  await assert.rejects(suggestChanges(w,d.id,'test',p),{code:'PROVIDER_INVALID_PROPOSAL'});assert.equal(w.listChanges(d.id).length,0);
});
test('cancellation after a provider resolves still refuses saving',async t=>{
  const{workspace:w,document:d}=fixture(t);const c=new AbortController();
  const p:ModelProvider={id:'test',async propose(r){c.abort();return result(r);}};
  await assert.rejects(suggestChanges(w,d.id,'test',p,c.signal),{code:'PROVIDER_CANCELLED'});assert.equal(w.listChanges(d.id).length,0);
});
test('even an empty generated batch is rejected if its document revision is stale',async t=>{
  const{workspace:w,document:d}=fixture(t);
  const p:ModelProvider={id:'test',async propose(r){const change=propose(w,d.id,1,'另一项已改动');w.accept(change.id);return {...result(r),edits:[]};}};
  await assert.rejects(suggestChanges(w,d.id,'test',p),{code:'STALE_REVISION'});assert.equal(w.listChanges(d.id).length,1);
});
