// SPDX-License-Identifier: Apache-2.0
/** Reproducible directory packaging from a verified official runtime and installed locked modules.
 * Does not download dependencies, sign binaries, or claim a Windows execution on Linux.
 */
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,lstatSync,statSync,realpathSync,copyFileSync,cpSync,renameSync,chmodSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const runtime=get('--runtime'),out=get('--out'),platform=get('--platform')||process.platform,extra=get('--extra-modules');
if(!runtime||!out||!['win32','linux'].includes(platform))throw Error('Usage: node scripts/package-desktop.mjs --runtime VERIFIED_DIR --out NEW_DIR --platform win32|linux [--extra-modules DIR]');
const source=resolve(runtime),destination=resolve(out);if(existsSync(destination))throw Error('Output must not exist; no overwrite performed.');
const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version,lock=JSON.parse(readFileSync(join(root,'apps/desktop/runtime-lock.json'),'utf8'));
const exe=platform==='win32'?'electron.exe':'electron';if(!existsSync(join(source,exe)))throw Error('Wrong runtime platform or missing runtime.');
// Verify extracted runtime bytes against its adjacent downloaded ZIP when provided by the acquisition helper.
const {readZip}=await import('../tools/updater/src/zip.mjs');const asset=lock.assets[platform+'-x64'];const zipPath=get('--runtime-zip');
if(!zipPath)throw Error('Provide --runtime-zip for checksum verification before packaging.');const zipBytes=readFileSync(resolve(zipPath)),sha=b=>createHash('sha256').update(b).digest('hex');if(zipBytes.length!==asset.bytes||sha(zipBytes)!==asset.sha256)throw Error('Official runtime ZIP differs from the lock.');
const entries=readZip(zipBytes,{compressed:200_000_000,total:600_000_000,file:400_000_000,entries:2000,ratio:500});for(const[name,bytes]of entries){const path=join(source,...name.split('/'));if(lstatSync(path).isSymbolicLink()||sha(readFileSync(path))!==sha(bytes))throw Error('Extracted runtime changed: '+name);}
mkdirSync(destination,{recursive:false});for(const [name]of entries){const path=join(destination,...name.split('/'));mkdirSync(dirname(path),{recursive:true});copyFileSync(join(source,...name.split('/')),path);}
if(platform==='win32')renameSync(join(destination,'electron.exe'),join(destination,'Siglum.exe'));else for(const p of ['electron','chrome_crashpad_handler','chrome-sandbox'])if(existsSync(join(destination,p)))chmodSync(join(destination,p),0o755);
const app=join(destination,'resources','app');mkdirSync(app,{recursive:true});
writeFileSync(join(app,'package.json'),JSON.stringify({name:'siglum-desktop',version,type:'module',private:true,main:'apps/desktop/main.mjs',license:'Apache-2.0'},null,2));
for(const f of ['LICENSE','NOTICE'])copyFileSync(join(root,f),join(app,f));
for(const sub of ['apps/desktop','apps/cli/dist']){const to=join(app,sub);mkdirSync(dirname(to),{recursive:true});cpSync(join(root,sub),to,{recursive:true,filter:src=>!['node_modules','test'].includes(src.split(/[\\/]/).at(-1))});}
const modules=join(app,'node_modules');mkdirSync(modules,{recursive:true});const copied=new Map();
function packageRoot(name,from){const req=createRequire(join(from,'package.json'));const paths=req.resolve.paths(name)||[];for(const base of [extra,...paths].filter(Boolean)){const path=join(base,name,'package.json');if(existsSync(path)&&JSON.parse(readFileSync(path,'utf8')).name===name)return realpathSync(dirname(path));}throw Error('Missing target-platform locked dependency: '+name);}
function copyDependency(name,from){if(copied.has(name))return;let dir;if(name.startsWith('@writer-agent/'))dir=join(root,'packages',name.split('/')[1]);else dir=packageRoot(name,from);const p=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));const dest=join(modules,name);mkdirSync(dirname(dest),{recursive:true});
 if(name.startsWith('@writer-agent/')){mkdirSync(dest);copyFileSync(join(dir,'package.json'),join(dest,'package.json'));cpSync(join(dir,'dist'),join(dest,'dist'),{recursive:true});}else cpSync(dir,dest,{recursive:true,filter:src=>!['node_modules','.git'].includes(src.split(/[\\/]/).at(-1))});copied.set(name,p.version);
 for(const dependency of Object.keys(p.dependencies||{}))copyDependency(dependency,dir);
 for(const dependency of Object.keys(p.peerDependencies||{})){if(!p.peerDependenciesMeta?.[dependency]?.optional)copyDependency(dependency,dir);}
 for(const dependency of Object.keys(p.optionalDependencies||{})){if(dependency.startsWith('@napi-rs/keyring-')&&dependency!==(platform==='win32'?'@napi-rs/keyring-win32-x64-msvc':'@napi-rs/keyring-linux-x64-gnu'))continue;copyDependency(dependency,dir);}
}
for(const name of ['@writer-agent/core','@writer-agent/storage','@writer-agent/models','@modelcontextprotocol/client','@napi-rs/keyring'])copyDependency(name,join(root,'apps/cli'));
const files=[];function scan(dir,prefix=''){for(const n of readdirSync(dir).sort()){const file=join(dir,n),path=prefix+n,st=lstatSync(file);if(st.isSymbolicLink())throw Error('A packaged link was found.');if(st.isDirectory())scan(file,path+'/');else{const bytes=readFileSync(file);files.push({path,bytes:bytes.length,sha256:sha(bytes)});}}}scan(destination);
writeFileSync(join(destination,'DESKTOP_MANIFEST.json'),JSON.stringify({format:1,kind:'siglum-desktop',appId:'org.siglum.writer',version,platform,arch:'x64',runtime:{version:lock.version,zipSha256:asset.sha256},modules:Object.fromEntries(copied),files},null,2));
console.log('DESKTOP_PACKAGED',destination,files.length+' files',JSON.stringify(Object.fromEntries(copied)));
