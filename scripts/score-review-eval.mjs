// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const labels=['certainty','attribution','scope','time','numeric','causality','claim-added','claim-unmapped','claim-reversed','claim-reformulated','evidence-shift','protected-claim'];
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
/** Scores supplied predictions only. Never starts inference or silently trusts AI-authored labels. */
export function scoreEvaluation(corpus,predictions,{allowDraft=false}={}) {
  if(corpus?.formatVersion!==1||!Array.isArray(corpus.cases)||!Array.isArray(predictions)||!corpus.cases.length)throw Error('Invalid evaluation input.');
  const cases=new Map();for(const c of corpus.cases){if(typeof c.id!=='string'||cases.has(c.id)||!Array.isArray(c.expectedLabels)||c.expectedLabels.some(l=>!labels.includes(l)))throw Error('Invalid/duplicate reference case.');cases.set(c.id,c);}
  if(!allowDraft&&[...cases.values()].some(c=>c.labelStatus!=='human-reviewed'||typeof c.reviewedBy!=='string'||!c.reviewedBy.trim()))throw Error('Reference labels are not human-reviewed. Use --allow-draft-labels only for scaffold development, not quality claims.');
  const seen=new Set(),stats=Object.fromEntries(labels.map(l=>[l,{truePositive:0,falsePositive:0,falseNegative:0}]));
  let abstentions=0,benign=0,falseAlarms=0,quoteChecks=0,validQuotes=0,success=0;const latencies=[];
  for(const p of predictions){if(!p||!cases.has(p.id)||seen.has(p.id)||!Array.isArray(p.labels)||new Set(p.labels).size!==p.labels.length||p.labels.some(l=>!labels.includes(l))||typeof p.abstain!=='boolean'||typeof p.model!=='string'||!p.model.trim())throw Error('Invalid/duplicate prediction or missing model identity.');seen.add(p.id);
    if(p.abstain&&p.labels.length)throw Error('Abstentions cannot carry scored category decisions.');
    const c=cases.get(p.id);if(p.abstain)abstentions++;else{success++;for(const l of labels){const expected=c.expectedLabels.includes(l),found=p.labels.includes(l);if(found&&expected)stats[l].truePositive++;else if(found)stats[l].falsePositive++;else if(expected)stats[l].falseNegative++;}}
    if(!c.expectedLabels.length&&!c.expectedAbstention){benign++;if(p.labels.length)falseAlarms++;}
    if(typeof p.quotationValid==='boolean'){quoteChecks++;if(p.quotationValid)validQuotes++;}
    if(p.latencyMs!==undefined){if(typeof p.latencyMs!=='number'||!Number.isFinite(p.latencyMs)||p.latencyMs<0)throw Error('Invalid latency.');latencies.push(p.latencyMs);}
  }
  return {qualityClaimAllowed:false,referenceLabelsHumanReviewed:!allowDraft,liveRunVerified:false,referenceStatus:allowDraft?'draft-exploratory-only':'human-reviewed',totalCases:cases.size,submitted:predictions.length,
    missingPredictions:cases.size-seen.size,abstentions,coverage:cases.size?success/cases.size:null,
    perCategory:Object.fromEntries(Object.entries(stats).map(([l,s])=>[l,{...s,precision:s.truePositive+s.falsePositive?s.truePositive/(s.truePositive+s.falsePositive):null,recallOnNonAbstained:s.truePositive+s.falseNegative?s.truePositive/(s.truePositive+s.falseNegative):null}])),
    benignCasesScored:benign,falseAlarms,falseAlarmRate:benign?falseAlarms/benign:null,quotationChecks:quoteChecks,quotationValidity:quoteChecks?validQuotes/quoteChecks:null,meanLatencyMs:mean(latencies),
    notice:'Not a factual certification. Recall excludes abstentions; read coverage/missing counts together. This tool cannot verify that predictions came from a live model. Token costs and missing measurements are unknown.'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{const args=process.argv.slice(2),allow=args.at(-1)==='--allow-draft-labels';if(allow)args.pop();if(args.length!==2)throw Error('Usage: node scripts/score-review-eval.mjs <corpus.json> <predictions.json> [--allow-draft-labels]');
    console.log(JSON.stringify(scoreEvaluation(JSON.parse(readFileSync(args[0],'utf8')),JSON.parse(readFileSync(args[1],'utf8')),{allowDraft:allow}),null,2));
  }catch(e){console.error(e instanceof Error?e.message:'Evaluation failed.');process.exitCode=1;}
}
