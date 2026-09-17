// SPDX-License-Identifier: Apache-2.0
import { createServer } from 'node:http';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { readFileSync,existsSync } from 'node:fs';
import { join,dirname,resolve,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictJson } from './json.mjs';
import { insist,UpdateError,errorRecord,fingerprint,samePath,readBounded } from './common.mjs';
import { toolchain,gitAdapter } from './process.mjs';
import { GitHubAdapter } from './github.mjs';
import { UpdateEngine } from './engine.mjs';
import { UpdateStore,readConfig,saveConfig } from './state.mjs';
import { DEFAULT_POLICY,checkRemoteName,validPolicy } from './identity.mjs';
import { releaseCatalogue,downloadReleaseProduct } from './releases.mjs';
import { readTaskLog,cleanLogText,redactLogText,processErrorDetails } from './task-log.mjs';

const STATIC=join(dirname(fileURLToPath(import.meta.url)),'..','public');
const cleanText=cleanLogText;
export function diagnosticTask(t){return {format:1,tool:'siglum-updater/0.2.0',id:t.id,repositoryId:t.repositoryId,version:t.version,state:t.state,bundleHash:t.bundleHash,baseSha:t.baseSha,targetTree:t.targetTree,commitSha:t.commitSha||null,prNumber:t.prNumber||null,mergeSha:t.mergeSha||null,remoteMerged:t.remoteMerged,localSynced:t.localSynced,cleanupComplete:t.cleanupComplete,error:t.error?{code:t.error.code,message:t.error.message}:null,createdAt:t.createdAt,updatedAt:t.updatedAt};}
export class PanelApplication {
  constructor(root,{legacyHint=null,loadTools=toolchain,makeGit=gitAdapter,makeGitHub=(t,p)=>new GitHubAdapter(t,p)}={}){this.store=new UpdateStore(root);this.root=root;this.legacyHint=legacyHint;this.loadTools=loadTools;this.makeGit=makeGit;this.makeGitHub=makeGitHub;this.config=readConfig(root);if(this.config)validPolicy(this.config.policy);this.pendingConfig=null;this.engines=new Map();this.jobs=new Map();this.output=new Map();this.catalogue=null;this.closing=false;}
  state(){return {version:'0.2.0-panel-fix1',configured:!!this.config,config:this.config?{repoPath:this.config.repoPath,identity:this.config.policy}:null,legacyHint:this.legacyHint,tasks:this.store.list().slice(0,200).map(t=>({...t,active:this.jobs.has(t.id)})),active:this.jobs.size};}
  savedOutput(id) {
    // Prove the task exists before opening its fixed, application-owned log path.
    const task = this.store.get(id); let log;
    try { log = readTaskLog(this.root, id); }
    catch (error) { log = { available:false,text:'',truncated:false,error:{code:error.code||'LOG_UNAVAILABLE',message:'The saved task log could not be read safely.'} }; }
    let output = log.available ? log.text : (this.output.get(id) || '');
    const details = processErrorDetails(task.error);
    if (task.error && details) {
      // Retain persisted process details after restart, even if its log is missing.
      const tail = [details.stdoutTail, details.stderrTail].filter(Boolean).filter(text => !output.includes(text)).join('\n');
      const summary = '\n[Saved process failure] ' + task.error.code +
        (details.exitCode !== null ? ' · exit ' + details.exitCode : '') +
        (details.signal ? ' · ' + details.signal : '');
      output += summary + (tail ? '\n' + tail : '');
    }
    const { text, ...logInfo } = log;
    return { output, logInfo, details };
  }
  taskSnapshot(id) {
    const task = this.store.get(id), saved = this.savedOutput(id);
    return { task, events:this.store.events(id), output:saved.output, logInfo:saved.logInfo, active:this.jobs.has(id) };
  }
  failureReport(body) {
    insist(body.confirm === true, 'CONFIRMATION_REQUIRED', 'Explicitly confirm exporting this task log.');
    insist(typeof body.id === 'string' && /^[a-z0-9-]{10,80}$/.test(body.id), 'TASK_NOT_FOUND', 'Invalid task ID.');
    const task = this.store.get(body.id), saved = this.savedOutput(body.id);
    return { format:1,tool:'siglum-updater/0.2.0-panel-fix1',kind:'selected-task-failure-report',
      exportedAt:new Date().toISOString(),diagnostic:diagnosticTask(task),processError:saved.details,
      log:{...saved.logInfo,tail:redactLogText(saved.output)},
      disclosure:'Contains only the selected task log tail and whitelisted process error fields; local paths and project test text may remain. Known credential-pattern redaction is best effort. Review before sharing.',
      noTaskExecution:true,noGitHubRequest:true };
  }
  async engine(){insist(this.config,'CONFIG_REQUIRED','Select and verify the existing repository first.');const tools=this.loadTools(this.config),key=fingerprint(this.config);if(!this.engines.has(key))this.engines.set(key,new UpdateEngine({store:this.store,git:this.makeGit(tools),github:this.makeGitHub(tools,this.config.policy),tools,config:this.config}));return this.engines.get(key);}
  async previewConfig(body){insist(!this.jobs.size,'BUSY','An integration is running.');insist(typeof body.repoPath==='string'&&isAbsolute(body.repoPath)&&body.repoPath.length<4096,'CONFIG_INVALID','Select an absolute repository path.');const tools=this.loadTools(),git=this.makeGit(tools),policy=structuredClone(DEFAULT_POLICY),gh=this.makeGitHub(tools,policy),repoPath=resolve(body.repoPath);
    insist(samePath(await git.text(repoPath,'rev-parse','--show-toplevel'),repoPath),'REPOSITORY_PATH','Choose the repository root, not a subfolder.');const repo=await gh.resolve(),remote=await git.text(repoPath,'remote','get-url','origin'),remoteName=checkRemoteName(remote);let pushurl='';try{pushurl=await git.text(repoPath,'config','--get','remote.origin.pushurl');}catch{}insist(!pushurl,'REMOTE_UNSUPPORTED','A custom origin pushurl needs inspection; it was not changed.');
    // A fork can share every commit with the target; commit presence alone cannot establish identity.
    const remoteIdentity=await gh.api('/repos/'+remoteName);insist(String(remoteIdentity.id)===policy.repositoryId,'REPOSITORY_MISMATCH','The configured origin is not the approved repository ID. An old name now owned by another repo must be repaired explicitly before first binding.');
    policy.legacyNames=[...new Set([...policy.legacyNames,repo.fullName,remoteName])];policy.legacyApproved=true;
    const config={format:1,repoPath,policy},preview={config,repository:repo,willPreserveOriginal:true,willUseExistingGhLogin:true,sourceExecutionWarning:'Dependency installation and project checks execute code. A worktree is not a sandbox.'};const hash=fingerprint(preview);this.pendingConfig={hash,preview,expires:Date.now()+300000};return {...preview,fingerprint:hash};
  }
  async confirmConfig(body){insist(!this.jobs.size,'BUSY','An integration is running.');const p=this.pendingConfig;insist(p&&p.hash===body.fingerprint&&p.expires>Date.now(),'PREVIEW_STALE','Configuration preview expired or changed.');if(this.config)insist(this.store.list().every(t=>t.state==='done'||t.state==='already-current'),'TASKS_UNFINISHED','Keep the original configuration while tasks are unfinished.');const tools=this.loadTools(p.preview.config),repo=await this.makeGitHub(tools,p.preview.config.policy).resolve();insist(repo.repositoryId===p.preview.repository.repositoryId&&repo.ownerId===p.preview.repository.ownerId,'REPOSITORY_MISMATCH','Repository identity changed.');saveConfig(this.root,p.preview.config);this.config=p.preview.config;this.pendingConfig=null;return this.state();}
  async prepare(bytes){insist(!this.jobs.size,'BUSY','Wait for the current integration before adding another package.');return (await this.engine()).prepare(bytes);}
  async preview(id){const preview=(await this.engine()).preview(this.store.get(id));return {...preview,fingerprint:fingerprint(preview)};}
  async action(id,action,body={}){insist(!this.closing,'CLOSING','Updater is closing.');const engine=await this.engine(),t=this.store.get(id);if(body.expectedRevision!==undefined)insist(body.expectedRevision===t.revision,'TASK_STALE','Task changed; refresh the preview.');
    if(action==='approve')return engine.authorize(id,body.fingerprint,body.mode);
    if(action==='pause'){engine.pause(id);return this.store.get(id);}
    if(action==='revalidate'){insist(!this.jobs.size,'BUSY','An integration is running.');return engine.revalidate(id);}
    insist(action==='run','ACTION_UNKNOWN','Unknown action.');insist(!this.jobs.size,'BUSY','Only one foreground integration is allowed.');
    const log=(s,kind)=>{const old=this.output.get(id)||'';this.output.set(id,(old+cleanText(s)).slice(-60000));};
    const promise=engine.run(id,{maxWaitMs:15*60*1000,ackUnknown:body.ackUnknown===true,recoverLock:body.recoverLock===true,finishLocal:body.finishLocal===true,onOutput:log});
    this.jobs.set(id,promise);promise.catch(e=>log(errorRecord(e).message,'stderr')).finally(()=>this.jobs.delete(id));return {started:true,id};
  }
  async releases(body){const engine=await this.engine();this.catalogue=await releaseCatalogue(engine.github,{prerelease:body.prerelease===true});return this.catalogue;}
  async download(body){insist(!this.jobs.size,'BUSY','An integration is running.');const chosen=this.catalogue?.products.find(x=>x.assetId===body.assetId&&x.releaseId===body.releaseId&&x.sha256===body.sha256);insist(chosen,'PREVIEW_STALE','Select an asset from the current preview.');const engine=await this.engine(),r=await downloadReleaseProduct(engine.github,chosen,join(this.root,'downloads'));return {path:r.path,product:r.product,message:'Downloaded and verified only; not installed, executed or merged.'};}
  async prepareDownloaded(body){insist(this.catalogue,'PREVIEW_STALE','Preview the Release first.');const p=this.catalogue.products.find(p=>p.assetId===body.assetId&&p.sha256===body.sha256);insist(p?.kind==='source-delivery','WRONG_PACKAGE','Only source-delivery assets can be integrated.');return this.prepare(readBounded(join(this.root,'downloads',p.sha256+'.zip'),128000000));}
  async close(){this.closing=true;for(const e of this.engines.values())for(const id of this.jobs.keys())e.pause(id);await Promise.allSettled([...this.jobs.values()]);this.store.close();}
}
async function bodyBytes(req,limit){const size=Number(req.headers['content-length']);insist(!Number.isFinite(size)||size<=limit,'REQUEST_SIZE','Request exceeds size limit.');const chunks=[];let n=0;for await(const b of req){n+=b.length;insist(n<=limit,'REQUEST_SIZE','Request exceeds size limit.');chunks.push(b);}return Buffer.concat(chunks);}
export async function servePanel(app,{port=0}={}){
 const token=randomBytes(32).toString('hex');let origin,closing=false;
 const server=createServer(async(req,res)=>{
  const secureHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};for(const[k,v]of Object.entries(secureHeaders))res.setHeader(k,v);
  const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
  try{
   insist(!closing,'CLOSING','Updater is closing.');insist(req.headers.host===new URL(origin).host,'HOST_REJECTED','Invalid Host header.');const url=new URL(req.url,origin);insist(url.origin===origin,'ORIGIN_REJECTED','Invalid request URL.');
   if(req.method==='GET'&&['/','/app.js','/style.css'].includes(url.pathname)){insist(!req.headers.origin||req.headers.origin===origin,'ORIGIN_REJECTED','Cross-origin UI access rejected.');const file=url.pathname==='/'?'index.html':url.pathname.slice(1);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(readFileSync(join(STATIC,file)));return;}
   insist(url.pathname.startsWith('/api/'),'NOT_FOUND','Unknown path.');const expected=Buffer.from('Bearer '+token),got=Buffer.from(String(req.headers.authorization||''));insist(got.length===expected.length&&timingSafeEqual(got,expected),'UNAUTHENTICATED','Open the updater using its local launch link.');insist(!req.headers.origin||req.headers.origin===origin,'ORIGIN_REJECTED','Cross-origin API access rejected.');
   if(req.method==='GET'){
     if(url.pathname==='/api/state')return send(200,app.state());
     const id=url.searchParams.get('id');insist(typeof id==='string'&&/^[a-z0-9-]{10,80}$/.test(id),'TASK_NOT_FOUND','Invalid task ID.');
     if(url.pathname==='/api/task')return send(200,app.taskSnapshot(id));
     if(url.pathname==='/api/preview')return send(200,await app.preview(id));
     if(url.pathname==='/api/diagnostic'){res.setHeader('Content-Disposition','attachment; filename="siglum-updater-diagnostic.json"');return send(200,diagnosticTask(app.store.get(id)));}
     throw new UpdateError('NOT_FOUND','Unknown read route.');
   }
   insist(req.method==='POST','METHOD_REJECTED','Only explicit POST mutations are supported.');insist(req.headers.origin===origin,'ORIGIN_REJECTED','Mutations require the same local origin.');
   if(url.pathname==='/api/prepare'){insist(req.headers['content-type']==='application/octet-stream','CONTENT_TYPE','Upload a ZIP as binary.');return send(200,await app.prepare(await bodyBytes(req,128000000)));}
   insist(req.headers['content-type']==='application/json','CONTENT_TYPE','Expected a JSON request.');const b=strictJson(await bodyBytes(req,65536));insist(b&&typeof b==='object'&&!Array.isArray(b),'INVALID_INPUT','Expected a JSON object.');
   if(url.pathname==='/api/failure-report')return send(200,app.failureReport(b));
   if(url.pathname==='/api/config/preview')return send(200,await app.previewConfig(b));
   if(url.pathname==='/api/config/confirm')return send(200,await app.confirmConfig(b));
   if(url.pathname==='/api/releases')return send(200,await app.releases(b));
   if(url.pathname==='/api/download')return send(200,await app.download(b));
   if(url.pathname==='/api/prepare-downloaded')return send(200,await app.prepareDownloaded(b));
   if(url.pathname==='/api/action'){insist(typeof b.id==='string','INVALID_INPUT','Task ID required.');return send(200,await app.action(b.id,b.action,b));}
   if(url.pathname==='/api/exit'){insist(b.confirm===true,'CONFIRMATION_REQUIRED','Confirm stopping the local updater.');closing=true;send(200,{closing:true});setImmediate(async()=>{await app.close();server.close();server.closeIdleConnections();});return;}
   throw new UpdateError('NOT_FOUND','Unknown mutation route.');
  }catch(e){const r=errorRecord(e);send(['HOST_REJECTED','ORIGIN_REJECTED','UNAUTHENTICATED'].includes(r.code)?403:r.code==='NOT_FOUND'?404:400,{error:{code:r.code,message:r.message}});}
 });
 server.requestTimeout=150000;server.headersTimeout=10000;server.maxHeadersCount=40;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
 return {server,origin,token,url:origin+'/#'+token,close:async()=>{if(!closing){closing=true;await app.close();}await new Promise(r=>{server.close(r);server.closeIdleConnections();});}};
}
