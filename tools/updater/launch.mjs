// SPDX-License-Identifier: Apache-2.0
/** Local developer tool. No GitHub writes until the exact package is approved in the panel. */
import {homedir} from 'node:os';
import {join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,readFileSync,writeFileSync,mkdirSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {PanelApplication,servePanel} from './src/server.mjs';
import {ordinary,readBounded,insist} from './src/common.mjs';
import {childEnvironment} from './src/process.mjs';
export function userRoot(){
 if(process.platform==='win32'){const exe=join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');const value=execFileSync(exe,['-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Write([Environment]::GetFolderPath('LocalApplicationData'))"],{encoding:'utf8',windowsHide:true,timeout:10000,env:childEnvironment()});insist(isAbsolute(value),'KNOWN_FOLDER','Could not locate LocalApplicationData.');return join(value,'SiglumUpdater');}
 return join(process.env.XDG_STATE_HOME||join(homedir(),'.local','state'),'siglum-updater');
}
function readLegacyHint(path){if(!path||!existsSync(path))return null;try{const old=JSON.parse(readBounded(path,64000));return typeof old.repoPath==='string'&&isAbsolute(old.repoPath)?old.repoPath:null;}catch{return null;}}
function findLegacyHint(explicit){if(explicit)return readLegacyHint(explicit);const d=join(homedir(),'Downloads');for(const p of [join(d,'writer-agent-updater-v0.1','writer-agent-updater-v0.1','config.json'),join(d,'writer-agent-updater-v0.1','config.json')]){const hint=readLegacyHint(p);if(hint)return hint;}return null;}
function openBrowser(url){let exe,args;if(process.platform==='win32'){exe=join(process.env.SystemRoot||'C:\\Windows','System32','rundll32.exe');args=['url.dll,FileProtocolHandler',url];}else if(process.platform==='darwin'){exe='/usr/bin/open';args=[url];}else{exe='/usr/bin/xdg-open';args=[url];}const p=spawn(exe,args,{stdio:'ignore',shell:false,windowsHide:true,detached:true,env:childEnvironment()});p.once('error',()=>console.log('Open the local session link shown above in a browser.'));p.unref();}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
export async function launch({root=userRoot(),legacyConfig,noOpen=false}={}){
 mkdirSync(root,{recursive:true,mode:0o700});ordinary(root,'directory');const lock=join(root,'panel-session.json');
 if(existsSync(lock)){ordinary(lock);const previous=JSON.parse(readBounded(lock,4096));if(alive(previous.pid)){const u=new URL(previous.url);insist(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&/^[0-9a-f]{64}$/.test(u.hash.slice(1)),'SESSION_INVALID','Existing panel session has invalid metadata.');console.log('PANEL_ALREADY_RUNNING\n'+u.href);if(!noOpen)openBrowser(u.href);return {alreadyRunning:true};}unlinkSync(lock);}
 const fd=openSync(lock,'wx',0o600),nonce=randomBytes(16).toString('hex');writeFileSync(fd,JSON.stringify({pid:process.pid,nonce,url:null}));closeSync(fd);
 let panel;try{const app=new PanelApplication(root,{legacyHint:findLegacyHint(legacyConfig)});panel=await servePanel(app);writeFileSync(lock,JSON.stringify({pid:process.pid,nonce,url:panel.url}),{mode:0o600});}catch(e){unlinkSync(lock);throw e;}
 const cleanup=()=>{try{const old=JSON.parse(readFileSync(lock));if(old.nonce===nonce)unlinkSync(lock);}catch{}};process.once('exit',cleanup);panel.server.once('close',cleanup);
 let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await panel.close();cleanup();};process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
 console.log('Siglum Updater v0.2.0\n'+panel.url+'\nLocal session link: do not share it while the updater is running.\n关闭浏览器不会停止宿主，请使用面板的“退出”。');if(!noOpen)openBrowser(panel.url);return panel;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){const args=process.argv.slice(2),legacyIndex=args.indexOf('--legacy-config');launch({noOpen:args.includes('--no-open'),legacyConfig:legacyIndex>=0?args[legacyIndex+1]:undefined}).catch(e=>{console.error('UPDATER_START_STOPPED',e.code||'',e.message);process.exitCode=1;});}
