// SPDX-License-Identifier: Apache-2.0
import {app,BrowserWindow,protocol,ipcMain,utilityProcess,dialog,shell,Menu} from 'electron';
import {readFile,lstat,writeFile,link,unlink} from 'node:fs/promises';
import {join,dirname,basename,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {PAGE,APP_METHODS,validateEnvelope,validSender,safeExternal} from './contract.mjs';
import {installationInfo,installCurrentUser} from './install.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
export function registerScheme(){protocol.registerSchemesAsPrivileged([{scheme:'siglum',privileges:{standard:true,secure:true,supportFetchAPI:true,codeCache:true}}]);}
async function readText(path){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>6_000_000)throw Error('Choose a regular UTF-8 text file below 6 MB.');return new TextDecoder('utf-8',{fatal:true}).decode(await readFile(path));}
async function publishText(path,text){const temporary=join(dirname(path),`.siglum-export-${randomBytes(12).toString('hex')}`);await writeFile(temporary,text,{flag:'wx',mode:0o600});try{await link(temporary,path);}finally{await unlink(temporary).catch(()=>{});}}
export async function startDesktop({configDirectory,show=true}={}){
 await app.whenReady();
 const staticPaths=new Map([['/index.html',['index.html','text/html']],['/app.js',['app.js','text/javascript']],['/style.css',['style.css','text/css']]]);
 const csp="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";
 protocol.handle('siglum',async request=>{const u=new URL(request.url),entry=staticPaths.get(u.pathname);if(request.method!=='GET'||u.host!=='app'||u.search||!entry)return new Response('Not found',{status:404});return new Response(await readFile(join(HERE,'public',entry[0])),{headers:{'Content-Type':entry[1]+'; charset=utf-8','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});});
 const env={...process.env};delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_PATH;
 const child=utilityProcess.fork(join(HERE,'worker.mjs'),[],{env,stdio:'pipe',serviceName:'Siglum writing service'});
 // Child output may contain provider text: do not mirror raw stdout/stderr into application logs.
 child.stdout?.on('data',()=>{});child.stderr?.on('data',()=>{});
 let seq=0,closing=false,dirty=false,closed=false;const pending=new Map();
 child.on('message',m=>{const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.ok?p.resolve(m.value):p.reject(Object.assign(Error(m.error.message),{code:m.error.code}));}});
 child.on('exit',()=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Writing service exited. Saved work remains on disk.'));}pending.clear();});
 function call(method,input={}){if(closed)return Promise.reject(Error('Writing service is not running.'));return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('The local operation timed out; its result may be unknown. Refresh before repeating.'));},120000);pending.set(id,{resolve,reject,timer});child.postMessage({id,method,input});});}
 await call('initialize',{configDirectory:configDirectory??null});
 const window=new BrowserWindow({width:1320,height:900,minWidth:860,minHeight:620,show:false,title:'Siglum',backgroundColor:'#f5f3ef',webPreferences:{preload:join(HERE,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,webviewTag:false,spellcheck:false}});
 window.webContents.session.setPermissionRequestHandler((_w,_p,callback)=>callback(false));
 window.webContents.session.setPermissionCheckHandler(()=>false);
 window.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('siglum://app/')}));
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(url!==PAGE)event.preventDefault();});
 window.webContents.on('will-attach-webview',event=>event.preventDefault());
 Menu.setApplicationMenu(null);
 async function hostAction(method,input){
  if(method==='windowDirty'){if(Object.keys(input).join()!=='dirty'||typeof input.dirty!=='boolean')throw Error('Invalid buffer state.');dirty=input.dirty;return {tracked:true};}
  if(method==='workspaceOpen'||method==='workspaceCreate'){
   if(dirty)throw Error('Wait for the editing buffer to save, or keep this window open and retry saving.');
   let path;if(method==='workspaceCreate'){const result=await dialog.showSaveDialog(window,{title:'Create writing workspace / 新建写作工作区',defaultPath:join(app.getPath('documents'),'Siglum Writing'),buttonLabel:'Create / 新建'});if(result.canceled)return {cancelled:true};path=result.filePath;}else{const result=await dialog.showOpenDialog(window,{title:'Open writing workspace / 打开写作工作区',properties:['openDirectory']});if(result.canceled)return {cancelled:true};path=result.filePaths[0];}
   return call('host:open',{path,create:method==='workspaceCreate',name:basename(path)});
  }
  if(method==='workspaceMigrate'){
   const preview=await call('host:migrationPreview');const answer=await dialog.showMessageBox(window,{type:'warning',title:'Workspace upgrade / 工作区升级',message:'Back up and upgrade this writing workspace? / 备份并升级此写作工作区？',detail:'Close other sessions first. The backup contains private, unencrypted writing. Code installation does not migrate it.\n请先关闭其他会话；备份包含未加密私稿。\n\n'+JSON.stringify(preview,null,2),buttons:['Cancel / 取消','Back up & upgrade / 备份并升级'],defaultId:0,cancelId:0});return answer.response===1?call('host:migrate'):{cancelled:true};
  }
  if(method==='importDocument'||method==='importSource'){
   if(dirty)throw Error('Save the current buffer first.');const result=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'UTF-8 text / 文本',extensions:method==='importDocument'?['md','txt']:['md','txt','html','htm']}]});if(result.canceled)return {cancelled:true};const path=result.filePaths[0],text=await readText(path);
   return method==='importDocument'?call('host:importDocument',{title:basename(path),text}):call('host:importSource',{name:basename(path),raw:Buffer.from(text),mediaType:['.html','.htm'].includes(extname(path).toLowerCase())?'text/html':extname(path).toLowerCase()==='.md'?'text/markdown':'text/plain'});
  }
  if(method==='exportDocument'||method==='exportReport'){
   const content=await call(method==='exportDocument'?'host:exportDocument':'host:exportReport',input);const result=await dialog.showSaveDialog(window,{title:'Export private writing / 导出私人文稿',defaultPath:join(app.getPath('documents'),method==='exportDocument'?'Siglum draft.md':'Siglum report.html')});if(result.canceled)return {cancelled:true};await publishText(result.filePath,content);return {saved:true,path:result.filePath};
  }
  if(method==='externalSource'){const url=safeExternal(input.url);const answer=await dialog.showMessageBox(window,{type:'question',message:'Open this source in your browser? / 用浏览器打开此来源？',detail:url,buttons:['Cancel / 取消','Open / 打开'],defaultId:0,cancelId:0});if(answer.response===1)await shell.openExternal(url);return {opened:answer.response===1};}
  if(method==='installationInfo')return installationInfo();
  if(method==='installCurrentUser'){const info=await installationInfo();if(!info.supported)throw Error(info.reason);const answer=await dialog.showMessageBox(window,{type:'question',message:'Install Siglum for this Windows user? / 为当前 Windows 用户安装 Siglum？',detail:info.destination+'\nCopies this portable build and creates Start menu/Desktop shortcuts. No administrator request, auto-start or private-writing deletion.\n复制此便携版本，创建快捷方式；不提权，不开机自启，不删除私稿。',buttons:['Cancel / 取消','Install / 安装'],defaultId:0,cancelId:0});return answer.response===1?installCurrentUser():{cancelled:true};}
  throw Error('Unknown host capability.');
 }
 ipcMain.handle('siglum:request',async(event,method,input)=>{try{if(!validSender(event,window)||closing)throw Error('Untrusted sender or closing application.');validateEnvelope(method,input);return {ok:true,value:APP_METHODS.includes(method)?await call(method,input):await hostAction(method,input)};}catch(e){return {ok:false,error:{code:typeof e?.code==='string'?e.code:'DESKTOP_OPERATION_STOPPED',message:String(e?.message??'Operation stopped.')}};}});
 async function shutdown(){if(closing)return;closing=true;await Promise.race([call('host:close').catch(()=>{}),new Promise(r=>setTimeout(r,10000))]);if(!closed)child.kill();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Application closed.'));}pending.clear();ipcMain.removeHandler('siglum:request');if(!window.isDestroyed())window.destroy();}
 window.on('close',event=>{if(closing)return;event.preventDefault();(async()=>{const state=await call('overview').catch(()=>null),active=state?.jobs?.some(j=>j.state==='running');if(dirty||active){const answer=await dialog.showMessageBox(window,{type:'warning',message:'Stop tasks and close? / 停止任务并退出？',detail:dirty?'Some typing has not been saved. Keep open to save it. / 部分输入尚未落盘，建议返回保存。':'Saved task progress remains. Dispatched calls may have an unknown result and will not retry automatically. / 已保存进度保留；已派发请求可能结果未知，不会自动重试。',buttons:['Keep open / 返回','Stop and close / 停止并退出'],defaultId:0,cancelId:0});if(answer.response!==1)return;}await shutdown();app.quit();})().catch(()=>{});});
 await window.loadURL(PAGE);if(show)window.show();
 return {window,call,shutdown,versions:process.versions};
}
