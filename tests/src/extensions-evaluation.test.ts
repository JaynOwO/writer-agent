// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
const {evaluateRetrieval}=await import(new URL('../../scripts/eval-retrieval.mjs',import.meta.url).href) as {evaluateRetrieval:()=>{synthetic:boolean;realModelEvaluated:boolean;caseCount:number;newTargetHits:number;oldTargetHits:number;newQualifierHits:number}};
test('Synthetic long-text retrieval comparison reports target inclusion separately from real model quality',()=>{const r=evaluateRetrieval();assert.equal(r.synthetic,true);assert.equal(r.realModelEvaluated,false);assert.equal(r.caseCount,12);assert.equal(r.newTargetHits,12);assert.equal(r.newQualifierHits,12);assert.ok(r.newTargetHits>r.oldTargetHits);});
