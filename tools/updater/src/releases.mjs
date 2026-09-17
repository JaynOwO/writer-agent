// SPDX-License-Identifier: Apache-2.0
import { strictJson } from './json.mjs';
import { openSync, closeSync, writeSync, fsyncSync, existsSync, linkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { insist, newId, parseVersion, exactKeys, sha256, ordinary } from './common.mjs';
const ALLOWED_HOSTS=new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
/** Public Release assets only. No GitHub token is acquired or forwarded to redirects. */
export async function publicAssetBytes(url,{maxBytes=1_000_000,timeoutMs=30000,fetcher=fetch,signal}={}){
  let current=new URL(url);insist(current.protocol==='https:'&&ALLOWED_HOSTS.has(current.hostname)&&!current.username&&!current.password&&!current.port,'DOWNLOAD_TARGET','Asset download target is not approved.');
  const timeout=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
  for(let hops=0;hops<=5;hops++){
    const r=await fetcher(current,{method:'GET',redirect:'manual',credentials:'omit',headers:{Accept:'application/octet-stream'},signal:combined});
    if([301,302,303,307,308].includes(r.status)){await r.body?.cancel();const loc=r.headers.get('location');insist(loc&&hops<5,'DOWNLOAD_REDIRECT','Invalid or excessive download redirects.');const next=new URL(loc,current);insist(next.protocol==='https:'&&ALLOWED_HOSTS.has(next.hostname)&&!next.username&&!next.password&&!next.port,'DOWNLOAD_TARGET','Redirect target is not allowed.');current=next;continue;}
    insist(r.status===200&&r.body,'DOWNLOAD_FAILED','Release download did not succeed.');
    const n=Number(r.headers.get('content-length'));insist(!Number.isFinite(n)||n<=maxBytes,'DOWNLOAD_SIZE','Release asset exceeds download limit.');
    const parts=[];let total=0;const reader=r.body.getReader();try{for(;;){const x=await reader.read();if(x.done)break;total+=x.value.byteLength;insist(total<=maxBytes,'DOWNLOAD_SIZE','Release asset exceeds download limit.');parts.push(Buffer.from(x.value));}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
    return Buffer.concat(parts);
  }
}
export function validateReleaseIndex(raw,repo,release){
  exactKeys(raw,['format','repositoryId','products'],['format','repositoryId','products']);insist(raw.format===1&&String(raw.repositoryId)===repo.repositoryId&&Array.isArray(raw.products)&&raw.products.length<=30,'RELEASE_INDEX','Invalid release descriptor.');const ids=new Set();
  return raw.products.map(p=>{
    exactKeys(p,['product','kind','version','assetId','sha256','platform','arch'],['product','kind','version','assetId','sha256']);parseVersion(p.version);
    insist(['siglum','siglum-updater'].includes(p.product)&&['source-delivery','updater-bootstrap','desktop-portable','desktop-installer'].includes(p.kind)&&/^[0-9a-f]{64}$/.test(p.sha256)&&Number.isSafeInteger(p.assetId)&&!ids.has(p.assetId),'RELEASE_INDEX','Invalid or duplicate release product.');ids.add(p.assetId);
    insist((p.kind==='updater-bootstrap')===(p.product==='siglum-updater'),'RELEASE_INDEX','Release type and product disagree.');
    const asset=release.assets.find(a=>a.id===p.assetId);insist(asset&&asset.name!=='siglum-release.json'&&asset.size>0&&asset.size<=(p.kind.startsWith('desktop-')?512_000_000:128_000_000),'RELEASE_ASSET','Missing or oversized declared asset.');
    if(asset.digest)insist(asset.digest==='sha256:'+p.sha256,'RELEASE_DIGEST','GitHub digest and release descriptor disagree.');
    return {...p,repositoryId:repo.repositoryId,repositoryName:repo.fullName,releaseId:release.id,prerelease:release.prerelease,name:asset.name,size:asset.size,url:asset.url,updatedAt:asset.updatedAt};
  });
}
export async function releaseCatalogue(github,{prerelease=false,download=publicAssetBytes}={}){
  const {repo,releases}=await github.releases();insist(!repo.private,'PRIVATE_RELEASE_UNSUPPORTED','Authenticated private asset download is not enabled in this release.');const products=[],unrecognized=[];
  for(const release of releases){if(release.prerelease&&!prerelease)continue;const descriptors=release.assets.filter(a=>a.name==='siglum-release.json');if(descriptors.length!==1){unrecognized.push({releaseId:release.id,tag:release.tag,reason:'no-single-product-descriptor'});continue;}
    const a=descriptors[0];insist(a.size<=256000&&a.digest?.startsWith('sha256:'),'RELEASE_INDEX','Release descriptor requires a bounded GitHub asset digest.');const b=await download(a.url,{maxBytes:256000});insist('sha256:'+sha256(b)===a.digest,'RELEASE_DIGEST','Release descriptor digest mismatch.');let data;try{data=strictJson(b,{bytes:256000});}catch{insist(false,'RELEASE_INDEX','Invalid release descriptor JSON.');}products.push(...validateReleaseIndex(data,repo,release));
  }return {repo,products,unrecognized};
}
export async function downloadReleaseProduct(github,selection,directory,{download=publicAssetBytes}={}){
  // Re-read the exact release/asset identities. A tag or filename is not an immutable identity.
  const current=await releaseCatalogue(github,{prerelease:true,download});const p=current.products.find(p=>p.releaseId===selection.releaseId&&p.assetId===selection.assetId);
  insist(p&&p.repositoryId===selection.repositoryId&&p.sha256===selection.sha256&&p.size===selection.size&&p.updatedAt===selection.updatedAt,'RELEASE_CHANGED','The selected asset changed. Preview and approve the new revision.');
  const data=await download(p.url,{maxBytes:p.size,timeoutMs:120000});insist(data.length===p.size&&sha256(data)===p.sha256,'RELEASE_DIGEST','Downloaded release asset checksum failed.');
  ordinary(directory,'directory');const extension=p.kind==='desktop-installer'&&/\.exe$/i.test(p.name)?'.exe':'.zip';const destination=join(directory,`${p.sha256}${extension}`);if(existsSync(destination)){insist(sha256((await import('node:fs')).readFileSync(destination))===p.sha256,'CACHE_CHANGED','A downloaded asset in the cache changed.');}else{const temp=destination+'.tmp-'+newId(),fd=openSync(temp,'wx',0o600);try{let off=0;while(off<data.length)off+=writeSync(fd,data,off,data.length-off);fsyncSync(fd);}finally{closeSync(fd);}try{linkSync(temp,destination);}finally{unlinkSync(temp);}}
  return {path:destination,product:p,data};
}
