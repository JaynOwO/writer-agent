// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync, lstatSync, linkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { insist, contained, ordinary, sha256, blobHash, newId } from './common.mjs';

export async function ensureNoGitOperation(git,root){
  for(const name of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply','index.lock']){
    const p=await git.text(root,'rev-parse','--git-path',name);insist(!existsSync(resolve(root,p)),'GIT_IN_PROGRESS','Finish the existing Git operation; the updater will not change it.',{operation:name});
  }
}
export async function verifyBase(git,root,bundle){
  const m=bundle.manifest;
  insist(await git.text(root,'rev-parse','HEAD')===m.baseCommit,'BASE_CHANGED','Worktree is not at the approved base commit.');
  insist(await git.text(root,'rev-parse','HEAD^{tree}')===m.baseTree,'BASE_CHANGED','Base tree differs from the approved delivery.');
  const records=(await git.bytes(root,'ls-tree','-r','-z','HEAD')).toString('utf8').split('\0').filter(Boolean);const base=new Map();
  for(const row of records){const tab=row.indexOf('\t'),[mode,type,hash]=row.slice(0,tab).split(' '),path=row.slice(tab+1);insist(type==='blob'&&mode==='100644','BASE_UNSUPPORTED','Symlinks, executable bits and submodules need explicit format support.');base.set(path,hash);}
  const changes=new Map(m.changes.map(c=>[c.path,c.baseBlob]));
  for(const [path,hash]of base){insist(bundle.files.has(path),'MANIFEST_INVALID','This format does not support deleting baseline files.');const target=blobHash(bundle.files.get(path));insist(target===hash||changes.get(path)===hash,'MANIFEST_INVALID','Changed content lacks its exact baseline record.',{path});}
  for(const [path,data]of bundle.files){if(!base.has(path))insist(changes.has(path)&&changes.get(path)===null,'MANIFEST_INVALID','New content lacks an ADD record.',{path});}
  for(const c of m.changes)insist(c.baseBlob===null?!base.has(c.path):base.get(c.path)===c.baseBlob,'MANIFEST_INVALID','Base blob mismatch in change list.',{path:c.path});
  return base;
}
export async function applyBundle(git,root,bundle,taskId,{onFile}={}){
  await ensureNoGitOperation(git,root);
  // Finish only a provably owned interrupted link publication. Never clean arbitrary work.
  for(const [path,data]of bundle.files){const temp=join(dirname(root),`.import-${taskId}-${sha256(Buffer.from(path))}`);if(!existsSync(temp))continue;
    const st=lstatSync(temp);insist(st.isFile()&&!st.isSymbolicLink()&&st.nlink<=2&&readFileSync(temp).equals(data),'IMPORT_TEMP_CONFLICT','Unknown interrupted import file.');
    if(st.nlink===2){const dest=join(root,path);const d=lstatSync(dest);insist(d.isFile()&&!d.isSymbolicLink()&&d.ino===st.ino&&d.dev===st.dev,'IMPORT_TEMP_CONFLICT','Interrupted publication does not match its target.');unlinkSync(temp);}
  }
  const base=await verifyBase(git,root,bundle),changed=new Set(bundle.manifest.changes.map(c=>c.path));
  const tracked=(await git.bytes(root,'diff','--name-only','-z','HEAD')).toString('utf8').split('\0').filter(Boolean);
  const untracked=(await git.bytes(root,'ls-files','--others','--exclude-standard','-z')).toString('utf8').split('\0').filter(Boolean);
  for(const path of [...tracked,...untracked])insist(changed.has(path),'UNKNOWN_WORKTREE_CHANGE','Unexpected work in the managed worktree was preserved.',{path});
  // Validate every file BEFORE writing any file. A known partial apply is resumable; unknown bytes are not.
  const plan=[];
  for(const [path,data]of bundle.files){const dest=contained(root,path,true),st=ordinary(dest,'file',true);if(st){const current=readFileSync(dest);if(current.equals(data))continue;
      insist(base.has(path)&&blobHash(current)===base.get(path),'FILE_CONFLICT','File is neither the exact baseline nor the approved target. Nothing was overwritten.',{path});
      insist(changed.has(path),'FILE_CONFLICT','An unchanged baseline file differs.',{path});plan.push({path,dest,data,old:sha256(current)});
    }else{insist(!base.has(path),'FILE_CONFLICT','A baseline file was deleted outside this task.',{path});plan.push({path,dest,data,old:null});}}
  for(const item of plan){
    mkdirSync(dirname(item.dest),{recursive:true,mode:0o700});contained(root,item.path,true);
    if(item.old===null)insist(!existsSync(item.dest),'FILE_CONFLICT','New file appeared during import.',{path:item.path});else insist(sha256(readFileSync(item.dest))===item.old,'FILE_CONFLICT','File changed during import.',{path:item.path});
    // Recoverable temp file lives in the updater-owned cache, not as untracked repository work.
    const temp=join(dirname(root),`.import-${taskId}-${sha256(Buffer.from(item.path))}`);
    if(!existsSync(temp)){const fd=openSync(temp,'wx',0o644);try{writeFileSync(fd,item.data);fsyncSync(fd);}finally{closeSync(fd);}}
    else insist(readFileSync(temp).equals(item.data),'IMPORT_TEMP_CONFLICT','Interrupted temp differs from target.');
    try{if(item.old===null){linkSync(temp,item.dest);unlinkSync(temp);}else renameSync(temp,item.dest);}
    catch(e){try{unlinkSync(temp);}catch{}throw e;}
    onFile?.(item.path);
  }
  for(const [path,data]of bundle.files)insist(readFileSync(contained(root,path)).equals(data),'SOURCE_CHECKSUM','Post-import file changed.',{path});
  await git.text(root,'diff','--check');return {files:bundle.files.size,changed:changed.size};
}
export async function assertTarget(git,root,bundle,{allowIgnored=true}={}){
  const listed=(await git.bytes(root,'ls-files','-z')).toString('utf8').split('\0').filter(Boolean);
  const untracked=(await git.bytes(root,'ls-files','--others','--exclude-standard','-z')).toString('utf8').split('\0').filter(Boolean);
  insist(new Set([...listed,...untracked]).size===bundle.files.size&&[...listed,...untracked].every(p=>bundle.files.has(p)),'UNKNOWN_WORKTREE_CHANGE','Unexpected file set in integration tree.');
  for(const [path,data]of bundle.files)insist(readFileSync(contained(root,path)).equals(data),'FILE_CONFLICT','A source file changed after package application.',{path});
  await git.text(root,'diff','--check');
}
