// SPDX-License-Identifier: Apache-2.0
// Build a version-pinned bootstrap directory. No installation or Git/network actions.
import {readdirSync,lstatSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {verifyPackage} from './bootstrap.mjs';
const root=dirname(fileURLToPath(import.meta.url)),at=process.argv.indexOf('--out');
if(at<0||!process.argv[at+1])throw Error('Usage: node tools/updater/package.mjs --out NEW_DIRECTORY');
const out=resolve(process.argv[at+1]);if(existsSync(out))throw Error('Output already exists; nothing overwritten.');
mkdirSync(out,{recursive:false});const files=[];
function copy(path){const source=join(root,path),stat=lstatSync(source);if(stat.isSymbolicLink())throw Error('Refusing a linked program file.');if(stat.isDirectory()){mkdirSync(join(out,path));for(const name of readdirSync(source).sort())copy(path+'/'+name);return;}if(!stat.isFile()||stat.size>2_000_000)throw Error('Unsupported program file.');const bytes=readFileSync(source);copyFileSync(source,join(out,path));files.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
for(const path of ['LICENSE','README.md','README.zh-CN.md','package.json','launch.mjs','bootstrap.mjs','src','public'])copy(path);
files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
writeFileSync(join(out,'UPDATER_MANIFEST.json'),JSON.stringify({format:1,kind:'updater-bootstrap',version:'0.2.0',files},null,2)+'\n',{flag:'wx'});
const verified=await verifyPackage(out);console.log('UPDATER_BOOTSTRAP_PACKAGED',files.length,verified.hash,out);
