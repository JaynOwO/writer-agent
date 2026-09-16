// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { indexResearch, planEvidence, lineRange } from '../packages/core/dist/index.js';
export function evaluateRetrieval() {
  const corpus=JSON.parse(readFileSync(new URL('../evaluation/retrieval-synthetic.json',import.meta.url),'utf8'));
  const cases=corpus.cases.map(c=>{
    let end=0;for(let i=1;i<=Math.min(40,c.text.split('\n').length);i++){if(Buffer.byteLength(lineRange(c.text,1,i).quote)>8000)break;end=i;}
    const old=end?lineRange(c.text,1,end).quote:'';
    const plan=planEvidence(indexResearch(c.id,c.text),c.text,c.query);
    const selected=plan.windows.map(w=>lineRange(c.text,w.startLine,w.endLine).quote).join('\n');
    return {id:c.id,old:{target:old.includes(c.target),qualifier:old.includes(c.qualifier),inputBytes:Buffer.byteLength(old)},new:{target:selected.includes(c.target),qualifier:selected.includes(c.qualifier),inputBytes:Buffer.byteLength(selected)},windows:plan.windows.map(w=>[w.startLine,w.endLine]),modelReadEntireText:plan.modelReadEntireText};
  });
  return {synthetic:true,realModelEvaluated:false,realSearchEvaluated:false,metric:'exact synthetic target-string inclusion, not semantic/research accuracy',caseCount:cases.length,oldTargetHits:cases.filter(c=>c.old.target).length,newTargetHits:cases.filter(c=>c.new.target).length,oldQualifierHits:cases.filter(c=>c.old.qualifier).length,newQualifierHits:cases.filter(c=>c.new.qualifier).length,cases};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(evaluateRetrieval(),null,2));
