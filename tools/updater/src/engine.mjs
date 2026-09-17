// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, readdirSync } from 'node:fs';
import { basename, join, resolve, dirname } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { insist, sha256, fingerprint, now, newId, ordinary, sourceTreeHash, readBounded, errorRecord, UpdateError, samePath } from './common.mjs';
import { parseDelivery } from './zip.mjs';
import { acquireRepositoryLock } from './state.mjs';
import { ensureNoGitOperation, applyBundle, assertTarget } from './importer.mjs';
import { runProcess } from './process.mjs';

export const VALIDATION_RECIPE = Object.freeze(['check','demo','demo:provider','demo:sources','demo:review','demo:memory','demo:workflow','demo:extensions','demo:product']);
export class UpdateEngine {
  constructor({store,git,github,tools,config,validate,clock=Date.now}){Object.assign(this,{store,git,github,tools,config,clock});this.validateHook=validate;this.active=new Map();}
  bundle(task){const b=readBounded(join(this.store.root,'cache',task.bundleHash+'.zip'),128_000_000);insist(sha256(b)===task.bundleHash,'CACHE_CHANGED','The approved cached bundle changed.');const parsed=parseDelivery(b,this.config.policy);insist(sourceTreeHash(parsed.files)===task.targetTree,'CACHE_CHANGED','Cached target tree changed.');return parsed;}
  async prepare(bytes,label='Selected delivery'){
    const bundle=parseDelivery(bytes,this.config.policy),repo=await this.github.resolve();const duplicate=this.store.list().find(t=>t.bundleHash===bundle.hash&&t.repositoryId===repo.repositoryId);
    if(duplicate)return {task:duplicate,duplicate:true};
    const root=resolve(this.config.repoPath);ordinary(root,'directory');insist(samePath(await this.git.text(root,'rev-parse','--show-toplevel'),root),'REPOSITORY_ROOT','Choose the repository root.');
    const common=resolve(root,await this.git.text(root,'rev-parse','--git-common-dir'));ordinary(common,'directory');
    const remote=await this.github.base(),targetTree=sourceTreeHash(bundle.files);
    const already=remote.tree===targetTree;
    insist(already||(remote.sha===bundle.manifest.baseCommit&&remote.tree===bundle.manifest.baseTree),'BASE_CHANGED','The delivery base is not current main. Obtain a reconciled bundle; no reset/rebase was attempted.',{expected:bundle.manifest.baseCommit,actual:remote.sha});
    // Prove the selected local repository contains this exact base tree; never trust only a folder name.
    let localBase;try{localBase=await this.git.text(root,'rev-parse',bundle.manifest.baseCommit+'^{tree}');}catch{throw new UpdateError('LOCAL_BASE_MISSING','The local repository lacks the delivery baseline. Sync it through GitHub Desktop first; local work was not changed.');}
    insist(localBase===bundle.manifest.baseTree,'REPOSITORY_MISMATCH','Local baseline does not match the approved repository.');
    const path=join(this.store.root,'cache',bundle.hash+'.zip');if(!existsSync(path)){const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}}else insist(sha256(readFileSync(path))===bundle.hash,'CACHE_CHANGED','Cache collision.');
    const task=this.store.create({version:bundle.manifest.version,bundleHash:bundle.hash,label:String(label).slice(0,200),repositoryId:repo.repositoryId,ownerId:repo.ownerId,repositoryName:repo.fullName,repoPath:root,commonDir:common,baseSha:bundle.manifest.baseCommit,baseTree:bundle.manifest.baseTree,targetTree,authorized:false,mode:null,branch:null,worktree:null,commitSha:null,prNumber:null,prId:null,mergeSha:null,validation:null,ci:null,observedAlreadyCurrent:already,observedMain:remote.sha});
    return {task,duplicate:false};
  }
  preview(task){return {taskId:task.id,repositoryId:task.repositoryId,repositoryName:task.repositoryName,version:task.version,bundleHash:task.bundleHash,baseSha:task.baseSha,targetTree:task.targetTree,recipe:VALIDATION_RECIPE,permissions:['managed-worktree','execute-trusted-project-tests','push-feature-branch','create-pull-request','wait-exact-CI','merge-only-in-full-mode','safe-local-fast-forward'],alreadyCurrent:task.observedAlreadyCurrent};}
  authorize(id,previewHash,mode){const t=this.store.get(id);insist(!t.authorized&&t.state==='prepared','INVALID_TRANSITION','This task is already authorized.');insist(['full','pr-only'].includes(mode),'INVALID_INPUT','Choose full or PR-only mode.');insist(fingerprint(this.preview(t))===previewHash,'PREVIEW_CHANGED','Review the current task before authorizing.');return this.store.change(id,t.revision,{authorized:true,mode,branch:`siglum-update/${t.version}/${t.id}`,worktree:join(this.store.root,'worktrees',t.id),error:null},'authorized');}
  update(id,patch,kind){const t=this.store.get(id);return this.store.change(id,t.revision,patch,kind);}
  async identity(id){const repo=await this.github.resolve(),t=this.store.get(id);insist(repo.repositoryId===t.repositoryId&&repo.ownerId===t.ownerId,'REPOSITORY_MISMATCH','Task repository/owner identity changed.');if(repo.fullName!==t.repositoryName)this.update(id,{repositoryName:repo.fullName},'repository-renamed');return repo;}
  async checkBase(t){const b=await this.github.base();insist(b.sha===t.baseSha&&b.tree===t.baseTree,'BASE_CHANGED','main changed after approval. Stop and prepare a newly reconciled update.',{expected:t.baseSha,actual:b.sha});return b;}
  async observeMerged(id,pr){const t=this.store.get(id);insist(pr.merged===true&&pr.merge_commit_sha,'MERGE_UNCONFIRMED','GitHub did not confirm a merge.');const commit=await this.github.commit(pr.merge_commit_sha);const matched=commit.tree.sha===t.targetTree;
    this.update(id,{remoteMerged:true,mergeSha:pr.merge_commit_sha,pendingAction:null,state:'merged',error:null,mergeTreeMatched:matched},'remote-merge-confirmed');
    insist(matched,'MERGED_TREE_DIFFERENT','The PR was merged, but its merge tree differs from this exact package. Remote merge is recorded; no reset or silent rollback was attempted.');
  }
  async reconcile(id,{ackUnknown=false}={}){
    let t=this.store.get(id);
    if(t.prNumber){const pr=await this.github.pull(t.prNumber);insist(pr.id===t.prId&&pr.head.sha===t.commitSha&&pr.base.ref===this.config.policy.targetBranch,'PR_CHANGED','The tracked PR no longer matches this task.');if(pr.merged){if(!t.remoteMerged)await this.observeMerged(id,pr);return;}insist(pr.state==='open','PR_CLOSED','The PR was closed without merging.');}
    if(!t.pendingAction||t.pendingAction==='worktree')return;
    if(t.pendingAction==='commit'&&existsSync(t.worktree)){
      const head=await this.git.text(t.worktree,'rev-parse','HEAD');if(head!==t.baseSha){const tree=await this.git.text(t.worktree,'rev-parse','HEAD^{tree}'),parent=await this.git.text(t.worktree,'rev-parse','HEAD^'),message=await this.git.text(t.worktree,'log','-1','--format=%B');insist(tree===t.targetTree&&parent===t.baseSha&&message.includes(`Siglum-Updater-Task: ${t.id}`)&&message.includes(t.bundleHash),'COMMIT_CHANGED','Unknown commit was preserved.');this.update(id,{commitSha:head,pendingAction:null,state:'committed'},'commit-reconciled');return;}}
    if(t.pendingAction==='push'){
      const head=await this.github.branch(t.branch);if(head===t.commitSha){this.update(id,{pendingAction:null,state:'pushed'},'push-reconciled');return;}insist(head===null,'REMOTE_BRANCH_CHANGED','Remote branch changed; no force push attempted.');
    }
    if(t.pendingAction==='create-pr'){
      const pr=await this.github.findPull(t.branch,t.id);if(pr){insist(pr.head.sha===t.commitSha,'PR_CHANGED','Existing PR head differs.');this.update(id,{prNumber:pr.number,prId:pr.id,pendingAction:null,state:'pr-created'},'pr-reconciled');return;}
    }
    if(['push','create-pr','merge'].includes(t.pendingAction))insist(ackUnknown,'OUTCOME_UNKNOWN','The previous remote write has no confirmed result. Recheck or explicitly acknowledge a retry.');
    this.update(id,{pendingAction:null},'retry-authorized');
  }
  async run(id,{signal,ackUnknown=false,recoverLock=false,maxWaitMs=120000,finishLocal=false,onOutput}={}){
    insist(!this.active.has(id),'TASK_RUNNING','This task is already running.');const controller=new AbortController();this.active.set(id,controller);const externalAbort=()=>controller.abort();signal?.addEventListener('abort',externalAbort,{once:true});if(signal?.aborted)controller.abort();let release;
    try{
      let t=this.store.get(id);insist(t.authorized,'AUTHORIZATION_REQUIRED','Approve the exact package and operation scope first.');
      await this.identity(id);
      if(t.observedAlreadyCurrent&&!t.commitSha){const current=await this.github.base();insist(current.tree===t.targetTree,'BASE_CHANGED','main no longer matches the previously observed package.');return this.update(id,{state:'done',observedMain:current.sha,error:null,alreadyCurrent:true},'already-current-no-integration');}
      if(t.state==='done'){if(t.prNumber){const p=await this.github.pull(t.prNumber);insist(p.id===t.prId&&p.merged,'MERGE_UNCONFIRMED','Historical merge could not be reconfirmed.');}const main=await this.github.base();t=this.update(id,{currentMain:main.sha,exactTreeStillCurrent:main.tree===t.targetTree},'completion-rechecked');if(!finishLocal||!t.remoteMerged)return t;t=this.update(id,{state:'merged'},'finish-local-requested');}
      release=acquireRepositoryLock(t.commonDir,t.id,recoverLock);
      await this.reconcile(id,{ackUnknown});t=this.store.get(id);
      const bundle=this.bundle(t),logPath=join(this.store.root,'logs',id+'.log');
      const stop=()=>insist(!controller.signal.aborted,'CANCELLED','Execution paused. Completed results were retained.');
      const processOpts={cwd:t.worktree,signal:controller.signal,onOutput,logPath,timeoutMs:600000};
      stop();
      if(t.state==='prepared'){
        await this.checkBase(t);await ensureNoGitOperation(this.git,t.repoPath);
        if(!existsSync(t.worktree)){
          let branch=null;try{branch=await this.git.text(t.repoPath,'rev-parse','--verify','refs/heads/'+t.branch);}catch{}
          insist(branch===null||(branch===t.baseSha&&t.pendingAction==='worktree'),'BRANCH_EXISTS','An unowned or changed integration branch was retained.');
          this.update(id,{pendingAction:'worktree'},'worktree-intent');
          if(branch===null)await this.git.text(t.repoPath,'-c','core.hooksPath='+join(this.store.root,'hooks'),'worktree','add','-b',t.branch,t.worktree,t.baseSha);
          else await this.git.text(t.repoPath,'-c','core.hooksPath='+join(this.store.root,'hooks'),'worktree','add',t.worktree,t.branch);
        }
        insist(await this.git.text(t.worktree,'branch','--show-current')===t.branch&&samePath(resolve(t.worktree,await this.git.text(t.worktree,'rev-parse','--git-common-dir')),t.commonDir),'WORKTREE_CHANGED','Managed worktree identity changed.');
        await applyBundle(this.git,t.worktree,bundle,id,{onFile:p=>onOutput?.('Applied '+p+'\n','stdout')});t=this.update(id,{state:'applied',pendingAction:null,error:null},'applied');
      }
      stop();
      if(t.state==='applied'){
        await assertTarget(this.git,t.worktree,bundle);this.update(id,{pendingAction:'validate'},'validation-started');
        if(this.validateHook)await this.validateHook(t,bundle,controller.signal);
        else{
          await runProcess(this.tools.node,[this.tools.pnpm,'install','--frozen-lockfile','--ignore-scripts'],processOpts);
          for(const script of VALIDATION_RECIPE){stop();await runProcess(this.tools.node,[this.tools.pnpm,script],processOpts);}
        }
        await assertTarget(this.git,t.worktree,bundle);
        t=this.update(id,{state:'local-validated',pendingAction:null,error:null,validation:{tree:t.targetTree,recipe:VALIDATION_RECIPE,node:process.version,platform:process.platform,pnpm:this.tools.version,at:now()}},'local-validated');
      }
      stop();
      if(t.state==='local-validated'){
        insist(t.validation?.node===process.version&&t.validation?.platform===process.platform&&t.validation?.pnpm===this.tools.version&&fingerprint(t.validation?.recipe)===fingerprint(VALIDATION_RECIPE),'VALIDATION_STALE','Validation environment changed. Revalidate in the managed worktree before committing.');
        await assertTarget(this.git,t.worktree,bundle);
        await this.git.text(t.worktree,'add','--',...bundle.manifest.changes.map(c=>c.path));
        insist(await this.git.text(t.worktree,'write-tree')===t.targetTree,'TREE_CHANGED','Staged tree differs from the approved package.');
        this.update(id,{pendingAction:'commit'},'commit-intent');
        await this.git.text(t.worktree,'-c','core.hooksPath='+join(this.store.root,'hooks'),'commit','-m',`feat: integrate Siglum v${t.version}\n\nSiglum-Updater-Task: ${id}\nBundle-SHA256: ${t.bundleHash}\nRepository-ID: ${t.repositoryId}`);
        t=this.update(id,{state:'committed',commitSha:await this.git.text(t.worktree,'rev-parse','HEAD'),pendingAction:null,error:null},'committed');
      }
      stop();
      if(t.state==='committed'){
        await this.checkBase(t);await this.verifyCommit(t,bundle);const repo=await this.identity(id);const existing=await this.github.branch(t.branch);
        insist(existing===null||existing===t.commitSha,'REMOTE_BRANCH_CHANGED','A different remote head exists; no force push attempted.');
        if(existing===null){this.update(id,{pendingAction:'push'},'push-intent');await this.git.run(t.worktree,['push',repo.cloneUrl,`${t.commitSha}:refs/heads/${t.branch}`],{signal:controller.signal,timeoutMs:120000});}
        insist(await this.github.branch(t.branch)===t.commitSha,'PUSH_UNCONFIRMED','Push has not been confirmed.');t=this.update(id,{state:'pushed',pendingAction:null,error:null},'pushed');
      }
      stop();
      if(t.state==='pushed'){
        await this.checkBase(t);await this.identity(id);let pr=await this.github.findPull(t.branch,id);
        if(!pr){this.update(id,{pendingAction:'create-pr'},'pr-intent');pr=await this.github.createPull(t);}
        insist(pr.head.sha===t.commitSha&&pr.base.ref===this.config.policy.targetBranch,'PR_CHANGED','PR identity differs.');t=this.update(id,{state:'pr-created',prNumber:pr.number,prId:pr.id,pendingAction:null,error:null},'pr-created');
      }
      if(t.mode==='pr-only'&&!t.remoteMerged&&['pr-created','ci-waiting'].includes(t.state))return t;
      if(['pr-created','ci-waiting','merge-requested'].includes(t.state)){
        const deadline=this.clock()+maxWaitMs;do{
          stop();const pr=await this.github.pull(t.prNumber);insist(pr.id===t.prId&&pr.head.sha===t.commitSha,'PR_CHANGED','PR head changed after validation.');
          if(pr.merged){await this.observeMerged(id,pr);break;}
          insist(pr.state==='open','PR_CLOSED','The PR was closed without merge.');await this.checkBase(t);
          const ci=await this.github.ci(t);t=this.update(id,{state:'ci-waiting',ci,error:null},'ci-observed');
          insist(ci.state!=='failed','CI_FAILED','At least one mandatory CI check did not succeed. No merge attempted.',{checks:ci.checks});
          if(ci.state==='passed'){
            await this.verifyCommit(t,bundle);await this.checkBase(t);const latest=await this.github.pull(t.prNumber);insist(latest.head.sha===t.commitSha&&latest.base.sha===t.baseSha,'PR_CHANGED','PR head or base drifted before merge.');
            await this.identity(id);this.update(id,{state:'merge-requested',pendingAction:'merge'},'merge-intent');await this.github.merge(t);
            await this.observeMerged(id,await this.github.pull(t.prNumber));break;
          }
          if(this.clock()>=deadline)return t;
          await wait(Math.min(5000,Math.max(0,deadline-this.clock())),undefined,{signal:controller.signal});
        }while(this.clock()<=deadline);
        t=this.store.get(id);if(!t.remoteMerged)return t;
      }
      t=this.store.get(id);stop();
      if(t.remoteMerged){
        insist(t.mergeTreeMatched,'MERGED_TREE_DIFFERENT','Merge tree needs inspection before local synchronization.');
        const warnings=[...t.historyWarnings];let localSynced=false;
        try{localSynced=await this.syncLocal(t);}catch(e){warnings.push({code:'LOCAL_SYNC_PENDING',message:errorRecord(e).message});}
        t=this.update(id,{state:'local-sync',localSynced,error:null,historyWarnings:warnings},'local-sync-observed');
        let cleanup=true;try{await this.cleanup(t);}catch(e){cleanup=false;warnings.push({code:'CLEANUP_PENDING',message:errorRecord(e).message});}
        return this.update(id,{state:'done',cleanupComplete:cleanup,historyWarnings:warnings,error:null},'done');
      }
      return t;
    }catch(e){const t=this.store.get(id);const error=errorRecord(e);this.store.change(id,t.revision,{error},'paused-on-error');return this.store.get(id);}
    finally{release?.();signal?.removeEventListener('abort',externalAbort);this.active.delete(id);}
  }
  revalidate(id){const t=this.store.get(id);insist(t.state==='local-validated'&&!t.pendingAction,'INVALID_TRANSITION','Only an uncommitted validation checkpoint can be reset for another test.');return this.update(id,{state:'applied',validation:null,error:null},'revalidation-requested');}
  pause(id){this.active.get(id)?.abort();return this.store.get(id);}
  async verifyCommit(t,bundle){await assertTarget(this.git,t.worktree,bundle);insist(await this.git.text(t.worktree,'rev-parse','HEAD')===t.commitSha&&await this.git.text(t.worktree,'rev-parse','HEAD^{tree}')===t.targetTree&&!await this.git.text(t.worktree,'status','--porcelain','--untracked-files=all'),'COMMIT_CHANGED','The validated integration commit/worktree changed.');}
  async syncLocal(t){
    if(await this.git.text(t.repoPath,'branch','--show-current')!==this.config.policy.targetBranch || await this.git.text(t.repoPath,'status','--porcelain','--untracked-files=all'))return false;
    await ensureNoGitOperation(this.git,t.repoPath);const head=await this.git.text(t.repoPath,'rev-parse','HEAD');if(head===t.mergeSha)return true;
    const repo=await this.identity(t.id);await this.git.text(t.repoPath,'fetch','--no-tags',repo.cloneUrl,t.mergeSha);
    try{await this.git.text(t.repoPath,'merge-base','--is-ancestor',head,t.mergeSha);}catch{return false;}
    // Recheck all conditions immediately before the sole allowed fast-forward mutation.
    if(await this.git.text(t.repoPath,'branch','--show-current')!==this.config.policy.targetBranch||await this.git.text(t.repoPath,'status','--porcelain','--untracked-files=all')||await this.git.text(t.repoPath,'rev-parse','HEAD')!==head)return false;
    await this.git.text(t.repoPath,'-c','core.hooksPath='+join(this.store.root,'hooks'),'merge','--ff-only',t.mergeSha);return await this.git.text(t.repoPath,'rev-parse','HEAD')===t.mergeSha;
  }
  async cleanup(t){
    if(existsSync(t.worktree)){
      insist(await this.git.text(t.worktree,'branch','--show-current')===t.branch&&await this.git.text(t.worktree,'rev-parse','HEAD')===t.commitSha&&!await this.git.text(t.worktree,'status','--porcelain','--untracked-files=all'),'CLEANUP_CHANGED','Managed branch has new work; it was retained.');
      // Git may refuse ignored build output without --force. Retention is safer than recursively deleting it.
      await this.git.text(t.repoPath,'worktree','remove',t.worktree);
    }
    let ref;try{ref=await this.git.text(t.repoPath,'rev-parse','--verify','refs/heads/'+t.branch);}catch{ref=null;}
    if(ref){const list=await this.git.text(t.repoPath,'worktree','list','--porcelain');insist(!list.split('\n').includes('branch refs/heads/'+t.branch),'CLEANUP_CHANGED','The integration branch remains checked out; it was retained.');insist(ref===t.commitSha,'CLEANUP_CHANGED','Integration branch was changed and retained.');await this.git.text(t.repoPath,'update-ref','-d','refs/heads/'+t.branch,t.commitSha);}
    await this.github.deleteBranch(t);
  }
}
