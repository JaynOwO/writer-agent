// SPDX-License-Identifier: Apache-2.0
import { StringDecoder } from 'node:string_decoder';
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { insist, UpdateError } from './common.mjs';
const NECESSARY=['PATH','Path','PATHEXT','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','HOME','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramFiles','ProgramFiles(x86)','LANG','LC_ALL','TZ'];
export function childEnvironment(kind='build',source=process.env){
  const env={};for(const key of NECESSARY)if(typeof source[key]==='string')env[key]=source[key];
  Object.assign(env,{NO_COLOR:'1',FORCE_COLOR:'0',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GH_PROMPT_DISABLED:'1',GH_HOST:'github.com'});
  if(kind==='github'&&source.GH_CONFIG_DIR)env.GH_CONFIG_DIR=source.GH_CONFIG_DIR;
  if(kind==='git'){if(source.GH_CONFIG_DIR)env.GH_CONFIG_DIR=source.GH_CONFIG_DIR;}
  return env;
}
export function findExecutable(name,extras=[]){
  const names=process.platform==='win32'?[name+'.exe',name]:[name];const roots=(process.env.PATH||process.env.Path||'').split(delimiter);
  const candidates=[...extras,...roots.flatMap(p=>names.map(n=>join(p,n)))];
  for(const p of candidates){try{const s=statSync(p);if(s.isFile()&&isAbsolute(p)){execFileSync(p,['--version'],{stdio:'ignore',timeout:5000,windowsHide:true,env:childEnvironment()});return resolve(p);}}catch{}}
  throw new UpdateError('TOOL_MISSING',`${name} was not found. Install it or select its existing installation; no tools were silently installed.`);
}
export function toolchain(config={}){
  const pf=process.env.ProgramFiles||'C:\\Program Files',local=process.env.LOCALAPPDATA;
  const gitExtras=[config.gitPath,join(pf,'Git','cmd','git.exe')].filter(Boolean);
  if(local){const desktop=join(local,'GitHubDesktop');if(existsSync(desktop))for(const app of readdirSync(desktop).filter(x=>/^app-/.test(x)).sort().reverse())gitExtras.push(join(desktop,app,'resources','app','git','cmd','git.exe'));}
  const git=findExecutable('git',gitExtras),gh=findExecutable('gh',[config.ghPath,join(pf,'GitHub CLI','gh.exe')].filter(Boolean));
  const node=process.execPath;
  const entries=[config.pnpmEntry,join(dirname(node),'node_modules','corepack','dist','pnpm.js'),join(dirname(node),'node_modules','pnpm','bin','pnpm.cjs'),join(dirname(node),'..','lib','node_modules','corepack','dist','pnpm.js'),join(dirname(node),'..','lib','node_modules','pnpm','bin','pnpm.cjs')].filter(Boolean);
  if(process.env.APPDATA)entries.push(join(process.env.APPDATA,'npm','node_modules','pnpm','bin','pnpm.cjs'));
  const pnpm=entries.find(p=>isAbsolute(p)&&existsSync(p));insist(pnpm,'PNPM_MISSING','The pnpm JavaScript entry was not found. Existing GitHub login is unchanged.');
  const version=execFileSync(node,[pnpm,'--version'],{encoding:'utf8',timeout:15000,windowsHide:true,env:{...childEnvironment(),COREPACK_ENABLE_DOWNLOAD_PROMPT:'0',COREPACK_ENABLE_NETWORK:'0'}}).trim();
  insist(version==='10.11.0','PNPM_VERSION','Expected the project-pinned pnpm 10.11.0.',{actual:version});return {git,gh,node,pnpm,version};
}
export function runProcess(file,args,{cwd,kind='build',timeoutMs=120000,maxBytes=12_000_000,signal,onOutput,logPath}={}){
  insist(isAbsolute(file)&&Array.isArray(args)&&args.every(s=>typeof s==='string'&&!s.includes('\0')),'INVALID_COMMAND','Only absolute executables and argument arrays are accepted.');
  return new Promise((resolve,reject)=>{
    let child,bytes=0,finished=false,forced=null;const out=[],err=[],decoders={stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')};
    try{child=spawn(file,args,{cwd,env:childEnvironment(kind),windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});}catch{reject(new UpdateError('SPAWN_FAILED','Could not start a required tool.'));return;}
    child.stdin.end();
    const stop=code=>{if(finished)return;forced=code;child.kill('SIGTERM');setTimeout(()=>{if(!finished)child.kill('SIGKILL');},2000).unref();};
    const timer=setTimeout(()=>stop('PROCESS_TIMEOUT'),timeoutMs),abort=()=>stop('CANCELLED');signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const collect=(a,b,stream)=>{bytes+=b.length;if(bytes>maxBytes){stop('OUTPUT_LIMIT');return;}a.push(b);if(logPath)try{appendFileSync(logPath,b);}catch{stop('LOG_WRITE_FAILED');}if(onOutput){const text=decoders[stream].write(b);if(text)onOutput(text,stream);}};
    child.stdout.on('data',b=>collect(out,b,'stdout'));child.stderr.on('data',b=>collect(err,b,'stderr'));
    child.on('error',()=>{forced='SPAWN_FAILED';});
    child.on('close',(code,sig)=>{finished=true;for(const stream of ['stdout','stderr']){const rest=decoders[stream].end();if(rest&&onOutput)onOutput(rest,stream);}clearTimeout(timer);signal?.removeEventListener('abort',abort);const stdout=Buffer.concat(out),stderr=Buffer.concat(err);if(forced||code!==0){reject(new UpdateError(forced||'PROCESS_FAILED',forced==='CANCELLED'?'Execution stopped; inspect the saved task before resuming.':'A required command did not complete successfully.',{exitCode:code,signal:sig,stdout:stdout.toString('utf8').slice(-12000),stderr:stderr.toString('utf8').slice(-12000)}));}else resolve({stdout,stderr,code});});
  });
}
export function gitAdapter(tools,{onOutput,logPath,signal}={}){
  const call=async(root,args,opts={})=>runProcess(tools.git,['-c','core.quotepath=false','-c','core.autocrlf=false','-c','core.eol=lf','-C',root,...args],{cwd:root,kind:'git',onOutput,logPath,signal,...opts});
  return {run:call,text:async(root,...args)=>(await call(root,args)).stdout.toString('utf8').trim(),bytes:async(root,...args)=>(await call(root,args)).stdout};
}
