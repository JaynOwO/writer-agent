// SPDX-License-Identifier: Apache-2.0
import {promises as fs,constants} from 'node:fs';
import {join,dirname,isAbsolute} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {VERSION} from './contract.mjs';
const APP_ID='org.siglum.writer';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fail(message){throw Error(message);}
export function safePackagePath(path){return typeof path==='string'&&path.length<1000&&!path.includes('\\')&&!path.includes(':')&&!isAbsolute(path)&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[\x00-\x1f]/.test(p)&&!/[ .]$/.test(p)&&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(p));}
export async function readDesktopManifest(root){
 const bytes=await fs.readFile(join(root,'DESKTOP_MANIFEST.json'));if(bytes.length>2_000_000)fail('Desktop manifest is oversized.');const m=JSON.parse(bytes);
 if(m.format!==1||m.kind!=='siglum-desktop'||m.appId!==APP_ID||m.version!==VERSION||m.platform!=='win32'||m.arch!=='x64'||!Array.isArray(m.files)||m.files.length<10||m.files.length>10000)fail('Not the expected Windows desktop package.');
 const seen=new Set();let total=0;for(const f of m.files){if(!safePackagePath(f.path)||seen.has(f.path.toLowerCase())||!Number.isSafeInteger(f.bytes)||f.bytes<0||!/^([a-f0-9]{64})$/.test(f.sha256))fail('Unsafe or inconsistent desktop manifest.');seen.add(f.path.toLowerCase());total+=f.bytes;}if(total>1_500_000_000||!seen.has('siglum.exe'))fail('Incomplete or oversized desktop package.');return {manifest:m,bytes,hash:hash(bytes)};
}
async function ordinaryPath(root,path){let at=root;const rootStat=await fs.lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail('A linked installation directory is not allowed.');for(const part of path.split('/')){at=join(at,part);const st=await fs.lstat(at);if(st.isSymbolicLink())fail('Linked package files are refused.');}return at;}
export async function verifyDesktop(root,manifest){for(const f of manifest.files){const file=await ordinaryPath(root,f.path),s=await fs.lstat(file);if(!s.isFile()||s.size!==f.bytes||s.nlink!==1||hash(await fs.readFile(file))!==f.sha256)fail('Desktop package changed: '+f.path);}return true;}
async function ensureNoLinkedParents(path){let at=path;while(true){try{const st=await fs.lstat(at);if(st.isSymbolicLink()||!st.isDirectory())fail('Installation parent is linked or not a directory.');}catch(e){if(e.code!=='ENOENT')throw e;}const up=dirname(at);if(up===at)break;at=up;}}
export async function copyVersion(source,destination,manifestBytes,manifest){
 await ensureNoLinkedParents(dirname(destination));await verifyDesktop(source,manifest);
 try{const old=await readDesktopManifest(destination);if(hash(old.bytes)!==hash(manifestBytes))fail('Destination already contains a different package.');await verifyDesktop(destination,manifest);return {reused:true};}catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.mkdir(dirname(destination),{recursive:true});const staging=destination+'.staging-'+randomBytes(8).toString('hex');await fs.mkdir(staging,{recursive:false});
 try{for(const f of manifest.files){const to=join(staging,...f.path.split('/'));await fs.mkdir(dirname(to),{recursive:true});await fs.copyFile(await ordinaryPath(source,f.path),to,constants.COPYFILE_EXCL);if(hash(await fs.readFile(to))!==f.sha256)fail('Copied desktop file failed verification.');}await fs.writeFile(join(staging,'DESKTOP_MANIFEST.json'),manifestBytes,{flag:'wx'});await fs.rename(staging,destination);return {reused:false};}catch(e){await fs.rm(staging,{recursive:true,force:true}).catch(()=>{});throw e;}
}
