// SPDX-License-Identifier: Apache-2.0
/** Owned local fixture: no private workspaces, real credentials or remote APIs. */
import {app} from 'electron';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {extensionWorkflowFixture} from '../../cli/dist/extensions-demo.js';
import {navigationDemoFixture} from '../../cli/dist/product-demo.js';
import {reviewFixture} from '../../cli/dist/review-demo.js';
import {tmpdir} from 'node:os';
const desktopRoot=process.env.SIGLUM_TEST_APP||fileURLToPath(new URL('../',import.meta.url));
const {registerScheme,startDesktop}=await import(pathToFileURL(join(desktopRoot,'host.mjs')).href);
import {Workspace} from '../../../packages/storage/dist/index.js';
const temp=mkdtempSync(join(tmpdir(),'siglum-electron-e2e-'));
app.setPath('userData',join(temp,'ui'));
registerScheme();let host,passed=0;
const checks=[];let fixtureServer;const modelRequests=[];const credential='SYNTHETIC_DESKTOP_FIXTURE_NOT_A_REAL_KEY';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function check(name,fn){await fn();passed++;checks.push(name);console.log('PASS',name);}
async function wait(code){for(let i=0;i<100;i++){if(await host.window.webContents.executeJavaScript(code))return;await sleep(80);}throw Error('UI condition timed out: '+code);}
const js=code=>host.window.webContents.executeJavaScript(code);
const rpc=(method,input={})=>js(`window.siglum.invoke(${JSON.stringify(method)},${JSON.stringify(input)})`);
const clickText=text=>js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)})?.click()`);
async function run(){
try{
 console.log('E2E_START');
 host=await startDesktop({configDirectory:join(temp,'connections'),show:true});
 await check('real Electron window, isolated renderer and utility process',async()=>{assert.equal(await js('typeof require'),'undefined');assert.equal(await js('typeof process'),'undefined');assert.equal((await rpc('overview')).version,'0.0.9');assert.equal(host.window.webContents.getLastWebPreferences().sandbox,true);assert.equal(host.window.webContents.getLastWebPreferences().contextIsolation,true);});
 await check('actual Electron runtime loads the native keyring binding without reading OS keys',async()=>{const req=createRequire(join(desktopRoot,'../../cli/package.json')),binding=req('@napi-rs/keyring');assert.equal(typeof binding.AsyncEntry,'function');});
 const workspace=join(temp,'写作 space 👩🏽‍💻');await host.call('host:open',{path:workspace,create:true,name:'真实桌面测试'});
 const doc=await host.call('documentCreate',{title:'写作的边界 / A writing test',text:'One red boat. Two blue birds.\n\n研究可能有帮助，但结论并不确定。'});
 const w=Workspace.open(workspace);try{const r=w.currentRevision(doc.id),b=r.snapshot.blocks[0];w.proposeChanges(doc.id,r.id,[{blockId:b.id,before:b.text,after:'One crimson boat. Two azure birds.',summary:'Two independently reviewable color changes'}],'synthetic');}finally{w.close();}
 await host.window.reload();await wait("document.querySelector('#documents button')!==null");await js("document.querySelector('#documents button').click()");await wait("document.querySelectorAll('textarea.editor').length===2");
 await check('real UI loads Unicode workspace and original stable blocks',async()=>{assert((await js("document.querySelector('h1').textContent")).includes('写作的边界'));assert.equal((await rpc('document',{id:doc.id})).ranges.length,0);});
 await clickText('拆分为可审核范围');await wait("document.querySelectorAll('.range-before').length===2");
 await check('UI splits block proposal into independently actionable ranges',async()=>{const state=await rpc('document',{id:doc.id});assert.equal(state.ranges.length,2);assert(state.changes[0].rangeSet);});
 await clickText('采用');await wait("document.querySelector('#modal').open");await clickText('执行我的决定');await wait("Array.from(document.querySelectorAll('.badge')).some(b=>b.textContent==='accepted')");
 await check('UI accepts just the first range',async()=>{assert.equal((await rpc('document',{id:doc.id})).revision.snapshot.blocks[0].text,'One crimson boat. Two blue birds.');});
 await clickText('采用');await wait("document.querySelector('#modal').open");await clickText('执行我的决定');await wait("Array.from(document.querySelectorAll('.badge')).filter(b=>b.textContent==='accepted').length===2");
 await clickText('撤回此范围');await wait("document.querySelector('#modal').open");await clickText('执行我的决定');await wait("Array.from(document.querySelectorAll('.badge')).some(b=>b.textContent==='reverted')");
 await check('UI reverts first range and preserves the second accepted range',async()=>{assert.equal((await rpc('document',{id:doc.id})).revision.snapshot.blocks[0].text,'One red boat. Two azure birds.');});
 await js("(()=>{const t=document.querySelectorAll('textarea.editor')[1];t.dispatchEvent(new CompositionEvent('compositionstart'));t.value+=' 中文输入 👩🏽‍💻 é';t.dispatchEvent(new Event('input'));t.dispatchEvent(new CompositionEvent('compositionend'));})()");
 await sleep(1200);await wait("document.querySelector('#status').textContent.includes('缓冲已保存')");
 await check('composition-event sequence autosaves a separate Unicode buffer',async()=>{const state=await rpc('document',{id:doc.id});assert(state.buffer.blocks[1].text.endsWith(' 中文输入 👩🏽‍💻 é'));assert(!state.revision.snapshot.blocks[1].text.includes('中文输入'));});
 await clickText('保存正文');await wait("document.querySelector('#status').textContent==='正文已保存在本地'");
 await check('manual commit is distinct from model acceptance and buffers',async()=>{const state=await rpc('document',{id:doc.id});assert.equal(state.buffer,null);assert(state.revision.snapshot.blocks[1].text.endsWith('中文输入 👩🏽‍💻 é'));});
 await check('preload rejects arbitrary capabilities',async()=>{for(const method of ['exec','git','readFile','sql'])assert(await js(`window.siglum.invoke(${JSON.stringify(method)},{path:'/etc/passwd'}).then(()=>false,()=>true)`));});
 await check('rendered manuscript HTML remains inert text',async()=>{await rpc('documentCreate',{title:'Malicious text fixture',text:'<script>window.compromised=1</script><img src=https://example.invalid/tracking onerror=alert(1)>'});await host.window.reload();await wait("Array.from(document.querySelectorAll('#documents button')).some(b=>b.textContent.includes('Malicious text fixture'))");await js("Array.from(document.querySelectorAll('#documents button')).find(b=>b.textContent.includes('Malicious text fixture')).click()");await wait("document.querySelector('textarea.editor')?.value.includes('<script>')");assert.equal(await js('window.compromised'),undefined);assert.equal(await js("document.querySelectorAll('#main img').length"),0);});
 fixtureServer=createServer(async(req,res)=>{try{assert.equal(req.headers.authorization,'Bearer '+credential);const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>6_000_000)throw Error('fixture bound');chunks.push(c);}const data=JSON.parse(Buffer.concat(chunks).toString()),r=JSON.parse(data.messages[1].content);modelRequests.push(r);const output=r.task==='semantic-review'?reviewFixture(r):r.task==='navigation-summary'?navigationDemoFixture(r):extensionWorkflowFixture(r);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({done:true,done_reason:'stop',message:{role:'assistant',content:JSON.stringify(output)},prompt_eval_count:20,eval_count:30}));}catch(e){console.error('FIXTURE_FAILED',e.message);res.writeHead(500);res.end();}});
 fixtureServer.listen(0,'127.0.0.1');await once(fixtureServer,'listening');const endpoint='http://127.0.0.1:'+fixtureServer.address().port;
 const preset=await rpc('presetSave',{name:'Owned loopback model; no genuine inference',settings:{kind:'model',model:{provider:'ollama',model:'desktop-fixture',baseURL:endpoint,apiKeyEnv:null,allowRemote:false,responseFormat:'json-schema',tokenParameter:'max_completion_tokens',timeoutMs:5000,maxOutputTokens:4096}},mode:'session',input:credential});
 await check('desktop preset hides the synthetic secret from metadata',async()=>{assert(!JSON.stringify(await rpc('overview')).includes(credential));assert.equal(preset.credentialMode,'session');});
 const w2=Workspace.open(workspace);let reviewChange;try{const rev=w2.currentRevision(doc.id),b=rev.snapshot.blocks[0];reviewChange=w2.proposeChanges(doc.id,rev.id,[{blockId:b.id,before:b.text,after:b.text.replace('red','green'),summary:'Synthetic proposed color change'}],'fixture')[0];}finally{w2.close();}
 const beforeReview=await rpc('document',{id:doc.id});await rpc('rangeSplit',{changeId:reviewChange.id,head:beforeReview.revision.id});const pendingForReview=(await rpc('document',{id:doc.id})).ranges.filter(x=>x.operation.status==='pending').map(x=>x.operation.id);
 const reviewPreview=await rpc('reviewPreview',{documentId:doc.id,instruction:'Compare the selected range; do not approve it.',selection:{snapshots:[],excerpts:[]},presetId:preset.id,rangeIds:pendingForReview,documentScope:true});const reviewJob=await rpc('previewSend',{id:reviewPreview.id,fingerprint:reviewPreview.fingerprint});for(let i=0;i<100;i++){const j=(await rpc('overview')).jobs.find(j=>j.id===reviewJob.jobId);if(j.state!=='running'){assert.equal(j.state,'completed',JSON.stringify(j.error));break;}await sleep(80);}
 await host.window.reload();await wait("Array.from(document.querySelectorAll('#documents button')).some(b=>b.textContent.includes('写作的边界'))");await js("Array.from(document.querySelectorAll('#documents button')).find(b=>b.textContent.includes('写作的边界')).click()");await wait("document.querySelector('#aside').textContent.includes('语义审稿')");
 await check('range review uses the same HTTP model path and renders a current semantic report',async()=>{const d=await rpc('document',{id:doc.id});assert.equal(d.reports[0].freshness,'current');assert(d.ranges.some(x=>x.operation.status==='pending'));});
 const src=await host.call('host:importSource',{name:'fictional-study.txt',raw:Buffer.from('Fictional study reports 12 percent longer endurance in six samples. This does not establish causality; cold-room results differed.'),mediaType:'text/plain'});
 const run=await rpc('runCreate',{title:'Desktop workflow fixture',goal:'Retain the small sample and contrary findings.',publicBrief:'',language:'en',research:'selected',template:'new-article',documentId:null,changeIds:[],selection:{snapshots:[src.snapshot.id],excerpts:[]},profileId:null,modelPresetId:preset.id,searchPresetId:null,autoRevision:true,navigationSummary:true,chapterDrafting:true,budget:{models:10,searches:0,fetches:0,activeMs:120000}});
 async function stage(){const pre=await rpc('runPreview',{id:run.id});assert(!JSON.stringify(pre).includes(credential));await rpc('runAuthorize',{id:run.id,fingerprint:pre.fingerprint,limits:pre.limits});const j=await rpc('runStart',{id:run.id});for(let i=0;i<150;i++){const job=(await rpc('overview')).jobs.find(x=>x.id===j.jobId);if(job.state!=='running'){assert.equal(job.state,'completed',JSON.stringify(job.error));return;}await sleep(80);}throw Error('Workflow timed out');}
 await stage();const first=await rpc('run',{id:run.id});
 await check('real utility process performs authorized HTTP research-summary and outline steps',async()=>{assert.equal(first.run.state,'waiting-approval');assert(first.run.outlineId);assert.equal(modelRequests.filter(r=>r.task==='navigation-summary').length,1);});
 await rpc('runOutline',{id:run.id,artifactId:first.run.outlineId});await stage();const second=await rpc('run',{id:run.id});
 await check('desktop task composes chapters, reviews and keeps both candidates',async()=>{assert.equal(second.run.candidateIds.length,2);assert.equal(modelRequests.filter(r=>r.task==='draft'&&r.section).length,2);assert.equal(modelRequests.filter(r=>r.task==='draft-review').length,1);assert(!JSON.stringify(second).includes(credential));});
 const adopted=await rpc('runAdopt',{id:run.id,artifactId:second.run.candidateIds[0]});
 await check('desktop explicit adoption is idempotent',async()=>{assert.deepEqual(await rpc('runAdopt',{id:run.id,artifactId:second.run.candidateIds[0]}),adopted);assert((await rpc('document',{id:adopted.documentId})).citations.length>0);});
 await host.window.reload();await wait("Array.from(document.querySelectorAll('#documents button')).some(b=>b.textContent.includes('Desktop workflow fixture'))");await js("Array.from(document.querySelectorAll('#documents button')).find(b=>b.textContent.includes('Desktop workflow fixture')).click()");await wait("document.querySelector('textarea.editor')!==null");

 await clickText('EN');await wait("document.documentElement.lang==='en'");
 await check('English interface renders without resetting saved writing',async()=>{assert.equal(await js("document.querySelector('#open').textContent"),'Open workspace');});
 await sleep(700);const image=await host.window.webContents.capturePage();writeFileSync(join(process.env.SIGLUM_TEST_OUTPUT||temp,'desktop-e2e.png'),image.toPNG());
 await host.shutdown();await check('worker and SQLite close before re-opening workspace',async()=>{const x=Workspace.open(workspace);try{assert(x.markdown(doc.id).includes('Two azure birds.'));}finally{x.close();}});
 writeFileSync(join(process.env.SIGLUM_TEST_OUTPUT||temp,'desktop-e2e.json'),JSON.stringify({passed,checks,versions:process.versions,fixture:'owned synthetic data; composition events, not actual OS IME; no remote services'},null,2));
 fixtureServer?.closeAllConnections();await new Promise(r=>fixtureServer?fixtureServer.close(r):r());console.log('DESKTOP_E2E_OK',passed);rmSync(temp,{recursive:true,force:true,maxRetries:4,retryDelay:50});app.exit(0);
}catch(e){console.error('DESKTOP_E2E_FAILED',e.stack);try{await host?.shutdown();}catch{}fixtureServer?.closeAllConnections();fixtureServer?.close();app.exit(1);}
}
run();
