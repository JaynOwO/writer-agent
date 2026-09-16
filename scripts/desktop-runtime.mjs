// SPDX-License-Identifier: Apache-2.0
/** Explicit public runtime acquisition; does not execute the downloaded program. */
import {readFileSync,mkdirSync,existsSync,writeFileSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readZip} from '../tools/updater/src/zip.mjs';
import {publicAssetBytes} from '../tools/updater/src/releases.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),lock=JSON.parse(readFileSync(join(root,'apps/desktop/runtime-lock.json'),'utf8'));
const platform=process.platform,arch=process.arch,key=platform+'-'+arch,asset=lock.assets[key];
if(!asset)throw Error('Only the locked Windows/Linux x64 runtimes are supported by this acquisition helper.');
const cache=join(root,'.cache','desktop');mkdirSync(cache,{recursive:true});const zip=join(cache,asset.name),hash=b=>createHash('sha256').update(b).digest('hex');let bytes;
if(existsSync(zip)){bytes=readFileSync(zip);if(bytes.length!==asset.bytes||hash(bytes)!==asset.sha256)throw Error('Existing runtime cache differs from the pinned checksum; retained for inspection.');}else{bytes=await publicAssetBytes(asset.url,{maxBytes:asset.bytes,timeoutMs:180000});if(bytes.length!==asset.bytes||hash(bytes)!==asset.sha256)throw Error('Runtime download checksum mismatch.');writeFileSync(zip,bytes,{flag:'wx'});}
const dest=join(cache,`electron-${lock.version}-${key}`);if(existsSync(dest))throw Error('Extraction directory already exists; use --runtime with it after verifying, rather than overwriting files.');
const entries=readZip(bytes,{compressed:200_000_000,total:600_000_000,file:400_000_000,entries:2000,ratio:500});mkdirSync(dest);
for(const [name,b]of entries){const file=join(dest,...name.split('/'));mkdirSync(resolve(file,'..'),{recursive:true});writeFileSync(file,b,{flag:'wx'});}
if(platform!=='win32')for(const name of ['electron','chrome-sandbox','chrome_crashpad_handler'])if(existsSync(join(dest,name)))chmodSync(join(dest,name),0o755);
console.log('RUNTIME_VERIFIED',dest);
