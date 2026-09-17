// SPDX-License-Identifier: Apache-2.0
/** One-time explicit installation of this updater version. Does not integrate an app bundle. */
import {promises as fs,constants} from 'node:fs';
import {join,dirname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {userRoot} from './launch.mjs';
import {childEnvironment} from './src/process.mjs';
import {insist} from './src/common.mjs';
import {renameWithRetry} from './src/rename-retry.mjs';
const run=promisify(execFile),HERE=dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
export async function verifyPackage(root){const raw=await fs.readFile(join(root,'UPDATER_MANIFEST.json'));insist(raw.length<200000,'BOOTSTRAP_MANIFEST','Invalid bootstrap manifest size.');const m=JSON.parse(raw);insist(m.format===1&&m.kind==='updater-bootstrap'&&m.version==='0.2.0'&&Array.isArray(m.files)&&m.files.length<1000,'BOOTSTRAP_MANIFEST','Not a supported updater bootstrap.');const names=new Set();for(const f of m.files){insist(typeof f.path==='string'&&/^[a-zA-Z0-9._/-]+$/.test(f.path)&&!f.path.split('/').some(p=>!p||p==='.'||p==='..')&&!names.has(f.path.toLowerCase())&&/^[0-9a-f]{64}$/.test(f.sha256),'BOOTSTRAP_PATH','Unsafe bootstrap path.');names.add(f.path.toLowerCase());let path=root;for(const part of f.path.split('/')){path=join(path,part);insist(!(await fs.lstat(path)).isSymbolicLink(),'BOOTSTRAP_LINK','Linked bootstrap file.');}const b=await fs.readFile(path);insist(b.length===f.bytes&&hash(b)===f.sha256,'BOOTSTRAP_HASH','A bootstrap file changed.');}insist(names.has('launch.mjs')&&names.has('src/engine.mjs'),'BOOTSTRAP_MANIFEST','Incomplete bootstrap.');return {m,raw,hash:hash(raw)};}
async function refuseLinkedParents(path){for(let p=path;;p=dirname(p)){try{const s=await fs.lstat(p);insist(s.isDirectory()&&!s.isSymbolicLink(),'BOOTSTRAP_ROOT','Installation path is not an ordinary directory.');}catch(e){if(e.code!=='ENOENT')throw e;}if(dirname(p)===p)break;}}
export async function installBootstrap({root=userRoot(),source=HERE,shortcuts=true}={}){
 const p=await verifyPackage(source);await refuseLinkedParents(root);await fs.mkdir(root,{recursive:true,mode:0o700});
 // Refuse to change the version pointer while an owned panel process is live.
 try{const session=JSON.parse(await fs.readFile(join(root,'panel-session.json'),'utf8'));try{process.kill(session.pid,0);throw Object.assign(Error('Close the currently running updater with its Quit button first.'),{code:'PANEL_RUNNING'});}catch(e){if(e.code!=='ESRCH')throw e;}}catch(e){if(e.code!=='ENOENT')throw e;}
 const versions=join(root,'versions'),destination=join(versions,'0.2.0-'+p.hash.slice(0,12));await fs.mkdir(versions,{recursive:true,mode:0o700});
 let reused=false;try{const old=await verifyPackage(destination);insist(old.hash===p.hash,'BOOTSTRAP_DESTINATION','A different updater occupies this version directory.');reused=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 if (!reused) {
  const stage = destination + '.tmp-' + randomBytes(8).toString('hex');
  await fs.mkdir(stage);
  try {
   for (const file of p.m.files) {
    const to = join(stage, file.path);
    await fs.mkdir(dirname(to), { recursive: true });
    await fs.copyFile(join(source, file.path), to, constants.COPYFILE_EXCL);
   }
   await fs.writeFile(join(stage, 'UPDATER_MANIFEST.json'), p.raw, { flag: 'wx' });
   await renameWithRetry(stage, destination, { beforeAttempt: async () => {
    await refuseLinkedParents(stage);
    const staged = await verifyPackage(stage);
    insist(staged.hash === p.hash, 'BOOTSTRAP_HASH', 'Staged updater manifest changed.');
    let occupied;
    try { occupied = await fs.lstat(destination); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    insist(!occupied, 'BOOTSTRAP_DESTINATION', 'An updater destination appeared during installation; it was not replaced.');
   }});
  } catch (error) {
   // This random staging path belongs to this invocation, not an installed version.
   await fs.rm(stage, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }).catch(() => {});
   throw error;
  }
 }
 const launcher=join(root,'start.mjs');const launcherText=`// Siglum Updater stable launcher v1. Opening the panel does not authorize GitHub writes.
import {readFileSync,lstatSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
const root=dirname(fileURLToPath(import.meta.url)),p=JSON.parse(readFileSync(join(root,'current.json'),'utf8'));
if(p.format!==1||!/^0\\.2\\.0-[a-f0-9]{12}$/.test(p.directory)||!/^([a-f0-9]{64})$/.test(p.manifestHash))throw Error('Invalid installed updater pointer.');
const dir=join(root,'versions',p.directory),raw=readFileSync(join(dir,'UPDATER_MANIFEST.json'));
if(hash(raw)!==p.manifestHash)throw Error('Updater manifest changed.');
const m=JSON.parse(raw);if(m.kind!=='updater-bootstrap'||m.version!=='0.2.0'||!Array.isArray(m.files))throw Error('Invalid updater package.');
for(const f of m.files){if(!/^[A-Za-z0-9._/-]+$/.test(f.path)||f.path.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Invalid updater path.');let at=dir;if(lstatSync(at).isSymbolicLink())throw Error('Linked updater directory.');for(const part of f.path.split('/')){at=join(at,part);if(lstatSync(at).isSymbolicLink())throw Error('Linked updater file.');}const bytes=readFileSync(at);if(bytes.length!==f.bytes||hash(bytes)!==f.sha256)throw Error('Updater program changed: '+f.path);}
const {launch}=await import(pathToFileURL(join(dir,'launch.mjs')));
await launch({root});
`;
 try{const old=await fs.readFile(launcher,'utf8');insist(old===launcherText,'BOOTSTRAP_LAUNCHER','A different stable launcher already exists; it was not replaced.');}catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(launcher,launcherText,{flag:'wx',mode:0o700});}
 const pointer = join(root, 'current.json');
 async function readPointer() {
  try {
   const stat = await fs.lstat(pointer);
   insist(stat.isFile() && !stat.isSymbolicLink(), 'BOOTSTRAP_POINTER_CHANGED', 'Updater pointer is not an ordinary file.');
   return await fs.readFile(pointer);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
 }
 const previousPointer = await readPointer();
 if (previousPointer !== null) {
  await fs.writeFile(join(root, 'previous-' + Date.now() + '-' + randomBytes(4).toString('hex') + '.json'), previousPointer, { flag: 'wx', mode: 0o600 });
 }
 const temp = pointer + '.tmp-' + randomBytes(8).toString('hex');
 const pointerBytes = Buffer.from(JSON.stringify({ format: 1, directory: destination.slice(versions.length + 1), manifestHash: p.hash }));
 await fs.writeFile(temp, pointerBytes, { flag: 'wx', mode: 0o600 });
 try {
  await renameWithRetry(temp, pointer, { beforeAttempt: async () => {
   await refuseLinkedParents(root);
   const stat = await fs.lstat(temp);
   insist(stat.isFile() && !stat.isSymbolicLink() && (await fs.readFile(temp)).equals(pointerBytes), 'BOOTSTRAP_POINTER_CHANGED', 'Staged updater pointer changed.');
   const current = await readPointer();
   insist(previousPointer === null ? current === null : current !== null && current.equals(previousPointer), 'BOOTSTRAP_POINTER_CHANGED', 'Updater pointer changed during installation; the newer pointer was retained.');
   insist((await verifyPackage(destination)).hash === p.hash, 'BOOTSTRAP_HASH', 'Installed updater changed before activation.');
  }});
 } catch (error) {
  // Never delete the current pointer to work around Windows sharing or permission errors.
  await fs.rm(temp, { force: true, maxRetries: 4, retryDelay: 100 }).catch(() => {});
  throw error;
 }
 if(shortcuts&&process.platform==='win32'){const script=`$ErrorActionPreference='Stop'; $ws=New-Object -ComObject WScript.Shell; foreach($dir in @([Environment]::GetFolderPath('DesktopDirectory'),[Environment]::GetFolderPath('Programs'))){$path=Join-Path $dir 'Siglum Updater.lnk'; if(Test-Path -LiteralPath $path){$old=$ws.CreateShortcut($path); if($old.TargetPath -ne $env:SIGLUM_NODE -or $old.Arguments -ne ('"'+$env:SIGLUM_LAUNCHER+'"')){throw 'Existing shortcut belongs to another launch target'}}; $s=$ws.CreateShortcut($path); $s.TargetPath=$env:SIGLUM_NODE; $s.Arguments='"'+$env:SIGLUM_LAUNCHER+'"'; $s.WorkingDirectory=$env:SIGLUM_ROOT; $s.WindowStyle=7; $s.Description='Siglum source integration panel'; $s.Save()}`;await run(join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{timeout:30000,windowsHide:true,env:{...childEnvironment(),SIGLUM_LAUNCHER:launcher,SIGLUM_NODE:process.execPath,SIGLUM_ROOT:root}});}
 return {installed:true,root,destination,launcher,oldUpdaterUntouched:true,reused};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){console.log('Installs Siglum Updater v0.2 into the current user’s application directory.\nDoes not change the old updater, GitHub repository, writing or credentials.\n安装新的更新器程序与快捷方式；旧更新器、仓库、私稿、凭据保持不变。');installBootstrap().then(async r=>{console.log('UPDATER_INSTALLED',r.root);const {launch}=await import(pathToFileURL(join(r.destination,'launch.mjs')).href);await launch({root:r.root});}).catch(e=>{console.error('BOOTSTRAP_STOPPED',e.code||'',e.message);process.exitCode=1;});}
