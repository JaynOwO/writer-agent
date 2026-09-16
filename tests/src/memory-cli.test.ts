// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {card,pref,parseMemoryTaskArgs,runWizard,menuChoose,scriptIO,terminalText,WizardCancelled} from './memory-helpers.js';
import {fixture,propose} from './helpers.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),cli=join(root,'apps/cli/dist/index.js');
const command=(args:string[])=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:15000});
for(const family of ['profile','intent','memory'])test(`${family} help runs offline`,()=>{const r=command([family,'help']);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/author control/);});
test('profile/intent/preferences CLI round trip and candidate import use shared storage',t=>{
  const {workspace:w,document:d,dir}=fixture(t);let r=command(['profile','create',w.root,'中文 科普']);assert.equal(r.status,0,r.stderr);const p=JSON.parse(r.stdout) as {id:string};
  r=command(['profile','attach',w.root,d.id,p.id]);assert.equal(r.status,0,r.stderr);
  const cardPath=join(dir,'card.json'),prefPath=join(dir,'pref.json'),exportPath=join(dir,'profile.json');writeFileSync(cardPath,JSON.stringify(card()));writeFileSync(prefPath,JSON.stringify(pref()));
  for(const args of [['intent','save',w.root,d.id,cardPath],['memory','add',w.root,p.id,prefPath],['memory','plan',w.root,d.id,'revise'],['profile','export',w.root,p.id,exportPath]]){r=command(args);assert.equal(r.status,0,r.stderr);}
  assert.equal(w.memory.plan(d.id,'revise').capture.packet.entries.length,1);const old=w.memory.profiles().length;
  r=command(['profile','import',w.root,exportPath]);assert.equal(r.status,0,r.stderr);assert.equal(w.memory.profiles().length,old);
  r=command(['profile','import',w.root,exportPath,'--apply']);assert.equal(r.status,0,r.stderr);assert.equal(w.memory.profiles().length,old+1);assert.match(r.stdout,/candidate/);
  const bytes=readFileSync(exportPath);r=command(['profile','export',w.root,p.id,exportPath]);assert.notEqual(r.status,0);assert.deepEqual(readFileSync(exportPath),bytes);
});
const base=['w','d','--provider','ollama','--model','test','--instruction','brief','--language','zh-CN'];
for(const extra of [['--api-key','fake'],['--auto-accept'],['--sources','source'],['--language','en'],['--unknown','x']])test(`memory task parser refuses ${extra[0]}`,()=>assert.throws(()=>parseMemoryTaskArgs([...base,...extra],'intent-draft')));
test('preference parser needs target profile and selected feedback, intent cannot smuggle them',()=>{assert.throws(()=>parseMemoryTaskArgs(base,'preference-draft'));assert.throws(()=>parseMemoryTaskArgs([...base,'--profile','p'],'intent-draft'));assert.equal(parseMemoryTaskArgs([...base,'--profile','p','--decisions','a,b'],'preference-draft').decisionIds.length,2);});
test('memory draft preview performs no network call or activation',t=>{const {workspace:w,document:d}=fixture(t);const r=command(['intent','draft',w.root,d.id,'--provider','ollama','--model','nonexistent','--base-url','http://127.0.0.1:1','--instruction','brief','--language','en']);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/preview-only/);assert.equal(w.memory.intents(d.id).length,0);});
test('guide refuses non-TTY rather than implicitly consuming piped consent',t=>{const {workspace:w}=fixture(t);const r=command(['guide',w.root]);assert.notEqual(r.status,0);assert.match(r.stderr,/TTY/);assert.equal(w.memory.profiles().length,0);});
test('guide normal exit and exhausted input do not create profile or call a model',async t=>{const {workspace:w}=fixture(t);await runWizard(w,scriptIO(['0']));assert.equal(w.memory.profiles().length,0);await assert.rejects(runWizard(w,scriptIO([])),e=>e instanceof WizardCancelled);});
test('guide profile creation uses numbers, retains Unicode and needs explicit confirmation',async t=>{const {workspace:w,document:d}=fixture(t);const io=scriptIO(['1','1','3','2','中文 科普😀','y','0']);await runWizard(w,io);assert.equal(w.memory.attachedProfile(d.id)!.name,'中文 科普😀');assert.equal(io.remaining.length,0);assert.equal(w.history(d.id).length,1);});
test('guide declining a new profile has no write side effect',async t=>{const {workspace:w}=fixture(t);const io=scriptIO(['1','1','3','2','No save','n','0']);await runWizard(w,io);assert.equal(w.memory.profiles().length,0);});
test('guide supports a blank-reason rejection without inventing style preferences',async t=>{const {workspace:w,document:d}=fixture(t),c=propose(w,d.id,0,'synthetic');const io=scriptIO(['1','1','8','1','2','0','0']);await runWizard(w,io);assert.equal(w.getChange(c.id).status,'rejected');assert.equal(w.decisions(d.id)[0]!.reason,'');assert.equal(w.memory.profiles().length,0);});
test('guide manual intent activation displays draft, and leaving required fields unset is allowed',async t=>{const {workspace:w,document:d}=fixture(t);const io=scriptIO(['1','1','4','1','1','1','普通读者','解释技术','','n','y','0']);await runWizard(w,io);assert.equal(w.memory.activeIntent(d.id)!.card.thesis,'');assert.equal(w.memory.activeIntent(d.id)!.card.purpose,'解释技术');});
test('guide choosing candidates but declining confirmation leaves them all candidates',async t=>{const {workspace:w,document:d}=fixture(t);const imported=w.memory.importProfile({format:1,name:'fixture',preferences:[pref(),pref()]});w.memory.attach(d.id,imported.profile.id);const io=scriptIO(['1','1','5','3','1','n','0']);await runWizard(w,io);assert.ok(w.memory.preferences(imported.profile.id).every(p=>p.status==='candidate'));});
test('guide activates only chosen candidate and leaves the rest unconfirmed',async t=>{const {workspace:w,document:d}=fixture(t);const imported=w.memory.importProfile({format:1,name:'fixture',preferences:[pref(),pref()]});w.memory.attach(d.id,imported.profile.id);const io=scriptIO(['1','1','5','3','1','y','0']);await runWizard(w,io);assert.equal(w.memory.preferences(imported.profile.id).filter(p=>p.status==='active').length,1);});
test('numbered selector pages and duplicate/invalid numbers cannot silently approve',async()=>{const io=scriptIO(['bad','1,1','n','10']);const result=await menuChoose(io,'choose',Array.from({length:12},(_,i)=>String(i)),x=>x,true);assert.deepEqual(result,['9']);assert.ok(io.lines.some(x=>x.includes('(2/2)')));});
test('terminal strips escape/control/bidi injection but preserves Chinese, accents and ordinary spacing',()=>{const text='你好😀 é\n\x1b[2J\x1b]0;hacked\x07A\u202eB\x00';const safe=terminalText(text);assert.match(safe,/你好😀 é/);assert.doesNotMatch(safe,/[\x1b\x07\x00\u202e]/);assert.doesNotMatch(safe,/hacked/);});
test('pre-aborted guide cancels without waiting for answers or touching data',async t=>{const {workspace:w}=fixture(t),ctrl=new AbortController();ctrl.abort();const io={...scriptIO([]),signal:ctrl.signal};await assert.rejects(runWizard(w,io),e=>e instanceof WizardCancelled);assert.equal(w.memory.profiles().length,0);});
test('full standalone memory demo closes all connections before directory cleanup',()=>{const r=command(['demo:memory']);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/MEMORY_DEMO_OK/);assert.match(r.stdout,/Scripted fixtures/);});
