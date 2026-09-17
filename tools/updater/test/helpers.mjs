// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { crc32,parseDelivery } from '../src/zip.mjs';
import { sha256,blobHash,sourceTreeHash } from '../src/common.mjs';
import { DEFAULT_POLICY,verifiedIdentity } from '../src/identity.mjs';
import { UpdateStore } from '../src/state.mjs';
import { gitAdapter, findExecutable } from '../src/process.mjs';
import { UpdateEngine } from '../src/engine.mjs';
export function zip(entries){
 const locals=[],central=[];let offset=0;
 for(const item of entries){const [name,raw,attrs=0x81a40000]=item,b=Buffer.isBuffer(raw)?raw:Buffer.from(raw),n=Buffer.from(name),crc=crc32(b);const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(0x800,6);l.writeUInt32LE(crc,14);l.writeUInt32LE(b.length,18);l.writeUInt32LE(b.length,22);l.writeUInt16LE(n.length,26);locals.push(l,n,b);
 const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x0314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt32LE(crc,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(attrs>>>0,38);c.writeUInt32LE(offset,42);central.push(c,n);offset+=l.length+n.length+b.length;
 }
 const dir=Buffer.concat(central),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50);e.writeUInt16LE(entries.length,8);e.writeUInt16LE(entries.length,10);e.writeUInt32LE(dir.length,12);e.writeUInt32LE(offset,16);return Buffer.concat([...locals,dir,e]);
}
export function git(root,...args){return execFileSync('git',['-c','core.autocrlf=false','-c','core.eol=lf','-C',root,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();}
export function temporary(t,beforeRemove=()=>{}){const p=mkdtempSync(join(tmpdir(),'siglum-updater-test-'));t.after(()=>{beforeRemove();rmSync(p,{recursive:true,force:true,maxRetries:3,retryDelay:50});});return p;}
export function delivery(baseFiles,files,baseSha,baseTree,override={}){
 const m={format:1,version:'0.0.9',repository:'JaynOwO/writer-agent',identity:{host:'github.com',repositoryId:'1370967185'},product:'siglum',kind:'source-delivery',baseCommit:baseSha,baseTree,files:[...files].map(([path,b])=>({path,bytes:b.length,sha256:sha256(b)})),changes:[...files].filter(([p,b])=>!baseFiles.has(p)||!b.equals(baseFiles.get(p))).map(([path])=>({path,baseBlob:baseFiles.has(path)?blobHash(baseFiles.get(path)):null})),...override};
 return {bytes:zip([['delivery/UPDATE_MANIFEST.json',JSON.stringify(m)],...files.entries().map(([p,b])=>['delivery/source/'+p,b])]),manifest:m};
}
/** Fake GitHub API backed by an actual local bare Git remote. No network or authentication. */
export class FakeGitHub {
 constructor(remote,policy){this.remote=remote;this.policy=policy;this.name='JaynOwO/writer-agent';this.ownerId=policy.ownerId;this.repositoryId=policy.repositoryId;this.prs=[];this.createCount=0;this.mergeCount=0;this.ciState='passed';this.failAfter=null;this.onResolve=null;this.resolves=0;}
 fault(action){if(this.failAfter===action){this.failAfter=null;throw new Error('simulated reply lost after '+action);}}
 async resolve(){this.resolves++;this.onResolve?.(this);return {...verifiedIdentity({id:this.repositoryId,node_id:this.policy.nodeId,owner:{id:this.ownerId,login:this.name.split('/')[0]},full_name:this.name,default_branch:'main',permissions:{push:true}},this.policy),cloneUrl:this.remote};}
 async base(){return {repo:await this.resolve(),sha:git(this.remote,'rev-parse','main'),tree:git(this.remote,'rev-parse','main^{tree}')};}
 async branch(name){await this.resolve();try{return git(this.remote,'rev-parse','--verify','refs/heads/'+name);}catch{return null;}}
 refresh(p){const q=structuredClone(p);if(!p.merged){q.head.sha=git(this.remote,'rev-parse','refs/heads/'+q.head.ref);q.base.sha=git(this.remote,'rev-parse','main');}return q;}
 async findPull(branch,id){await this.resolve();const p=this.prs.find(p=>p.head.ref===branch&&p.body.includes('Siglum-Updater-Task: '+id));return p?this.refresh(p):null;}
 async createPull(t){await this.resolve();this.createCount++;const p={number:this.prs.length+1,id:1001+this.prs.length,merged:false,state:'open',merge_commit_sha:null,head:{ref:t.branch,sha:t.commitSha,repo:{id:Number(t.repositoryId)}},base:{ref:'main',sha:t.baseSha,repo:{id:Number(t.repositoryId)}},body:`Siglum-Updater-Task: ${t.id}`};this.prs.push(p);this.fault('create-pr');return this.refresh(p);}
 async pull(number){await this.resolve();return this.refresh(this.prs.find(p=>p.number===number));}
 async ci(t){await this.resolve();return {state:this.ciState,head:t.commitSha,checks:this.policy.expectedChecks.map(name=>({name,status:'completed',conclusion:this.ciState==='passed'?'success':this.ciState==='waiting'?null:'failure'}))};}
 async commit(sha){await this.resolve();return {sha,tree:{sha:git(this.remote,'rev-parse',sha+'^{tree}')}};}
 async merge(t){await this.resolve();this.mergeCount++;const p=this.prs.find(p=>p.number===t.prNumber),base=git(this.remote,'rev-parse','main');if(base!==t.baseSha)throw new Error('base moved');const tree=git(this.remote,'rev-parse',t.commitSha+'^{tree}');const sha=git(this.remote,'commit-tree',tree,'-p',base,'-m','Synthetic reviewed merge');git(this.remote,'update-ref','refs/heads/main',sha,base);p.merged=true;p.state='closed';p.merge_commit_sha=sha;this.fault('merge');}
 async deleteBranch(t){const ref=await this.branch(t.branch);if(ref&&ref!==t.commitSha)throw new Error('changed remote branch');if(ref)git(this.remote,'update-ref','-d','refs/heads/'+t.branch,t.commitSha);}
}
export async function fixture(t,{validate}={}){
 let store;const root=temporary(t,()=>store?.close()),repo=join(root,'original 文稿 repository'),remote=join(root,'bare-remote');mkdirSync(repo);git(repo,'init','-b','main');git(repo,'config','user.name','Test User');git(repo,'config','user.email','test@example.invalid');
 const baseFiles=new Map([['.gitignore',Buffer.from('node_modules/\ndist/\n')],['README.md',Buffer.from('Original')],['package.json',Buffer.from('{"version":"0.0.8"}\n')]]);for(const [p,b]of baseFiles)writeFileSync(join(repo,p),b);git(repo,'add','.');git(repo,'commit','-m','synthetic baseline');const baseSha=git(repo,'rev-parse','HEAD'),baseTree=git(repo,'rev-parse','HEAD^{tree}');
 git(root,'clone','--bare',repo,remote);git(remote,'config','user.name','Test Merger');git(remote,'config','user.email','merge@example.invalid');git(repo,'remote','add','origin',remote);
 const files=new Map(baseFiles);files.set('README.md',Buffer.from('Updated\n'));files.set('package.json',Buffer.from('{"version":"0.0.9"}\n'));files.set('new.txt',Buffer.from('new content\n'));
 const bundle=delivery(baseFiles,files,baseSha,baseTree),policy=structuredClone(DEFAULT_POLICY),config={format:1,repoPath:repo,policy},tools={git:findExecutable('git'),gh:'/unused/gh',node:process.execPath,pnpm:'/unused/pnpm',version:'10.11.0'},adapter=gitAdapter(tools),gh=new FakeGitHub(remote,policy);store=new UpdateStore(join(root,'state'));let validates=0;
 const engine=new UpdateEngine({store,git:adapter,github:gh,tools,config,validate:async(...args)=>{validates++;await validate?.(...args);}});
 return {root,repo,remote,baseFiles,files,baseSha,baseTree,...bundle,config,store,tools,git:adapter,gh,engine,validates:()=>validates,parsed:parseDelivery(bundle.bytes,policy)};
}
