// SPDX-License-Identifier: Apache-2.0
import { runProcess } from './process.mjs';
import { insist, UpdateError, now, text } from './common.mjs';
import { verifiedIdentity } from './identity.mjs';
const REPO_QUERY=`query($id:ID!){node(id:$id){... on Repository{id databaseId nameWithOwner url isArchived isDisabled isPrivate viewerPermission defaultBranchRef{name} owner{id login ... on User{databaseId} ... on Organization{databaseId}}}}}`;
const enc=s=>encodeURIComponent(s);
export class GitHubAdapter {
  constructor(tools,policy,options={}){this.tools=tools;this.policy=policy;this.options=options;}
  async cli(args,{read=true}={}){
    try{return await runProcess(this.tools.gh,args,{kind:'github',timeoutMs:60000,maxBytes:8_000_000,signal:this.options.signal});}
    catch(e){if(e instanceof UpdateError){e.details={...e.details,readOnly:read};}throw e;}
  }
  async api(path,method='GET',fields={}){
    const args=['api','--hostname',this.policy.host,'--method',method,path];for(const [k,v]of Object.entries(fields))args.push(typeof v==='boolean'||typeof v==='number'?'-F':'-f',`${k}=${v}`);
    const result=await this.cli(args,{read:method==='GET'});if(!result.stdout.length)return null;try{return JSON.parse(result.stdout.toString('utf8'));}catch{throw new UpdateError('GITHUB_RESPONSE','GitHub returned an invalid JSON response.');}
  }
  async resolve(){
    const result=await this.api('graphql','POST',{query:REPO_QUERY,id:this.policy.nodeId});
    insist(!result.errors,'GITHUB_IDENTITY_UNAVAILABLE','Could not resolve the approved repository identity.');const n=result.data?.node;
    insist(n,'GITHUB_IDENTITY_UNAVAILABLE','Repository could not be resolved. Check access; this does not prove it was deleted.');
    return verifiedIdentity({id:n.databaseId,node_id:n.id,full_name:n.nameWithOwner,owner:{id:n.owner?.databaseId,login:n.owner?.login},archived:n.isArchived,disabled:n.isDisabled,private:n.isPrivate,viewerPermission:n.viewerPermission,default_branch:n.defaultBranchRef?.name},this.policy);
  }
  async scoped(path,method='GET',fields={}){const repo=await this.resolve();return {repo,value:await this.api(`/repos/${repo.fullName}/${path}`,method,fields)};}
  async base(){const {repo,value}=await this.scoped(`branches/${enc(this.policy.targetBranch)}`);insist(value.name===this.policy.targetBranch&&/^[0-9a-f]{40}$/.test(value.commit?.sha),'GITHUB_RESPONSE','Invalid target branch.');return {repo,sha:value.commit.sha,tree:value.commit.commit?.tree?.sha};}
  async branch(branch){
    try{const {value}=await this.scoped(`git/ref/heads/${branch.split('/').map(enc).join('/')}`);insist(value.ref===`refs/heads/${branch}`&&value.object?.type==='commit','GITHUB_RESPONSE','Unexpected branch reference.');return value.object.sha;}
    catch(e){if(e instanceof UpdateError&&(/HTTP 404/.test(e.details.stderr||'')))return null;throw e;}
  }
  async pull(number){const {repo,value}=await this.scoped(`pulls/${number}`);insist(value.number===number&&String(value.base?.repo?.id)===repo.repositoryId,'GITHUB_RESPONSE','PR belongs to another repository.');return value;}
  async findPull(branch,taskId){const repo=await this.resolve();let found=[];
    for(let page=1;page<=5;page++){const values=await this.api(`/repos/${repo.fullName}/pulls?state=all&head=${enc(repo.ownerLogin+':'+branch)}&per_page=100&page=${page}`);insist(Array.isArray(values),'GITHUB_RESPONSE','Invalid PR collection.');found.push(...values.filter(p=>String(p.base?.repo?.id)===repo.repositoryId&&String(p.head?.repo?.id)===repo.repositoryId&&p.head.ref===branch&&p.body?.includes(`Siglum-Updater-Task: ${taskId}`)));if(values.length<100)break;insist(page<5,'GITHUB_PAGINATION','PR lookup exceeded bounded pages.');}
    insist(found.length<=1,'PR_AMBIGUOUS','More than one PR matches this task.');return found[0]||null;
  }
  async createPull(task){const {repo,value}=await this.scoped('pulls','POST',{
    title:`feat: integrate Siglum v${task.version}`,
    head:task.branch,base:this.policy.targetBranch,
    body:`## Verified source integration\n\nSiglum-Updater-Task: ${task.id}\nRepository-ID: ${this.policy.repositoryId}\nBundle-SHA256: ${task.bundleHash}\nExpected-Tree: ${task.targetTree}\n\nLocal validation passed in the updater-managed worktree. Required GitHub Actions must succeed for this exact head.\n\nNo direct push to main. No manuscript migration.`,
  });insist(String(value.base?.repo?.id)===repo.repositoryId&&value.head?.sha===task.commitSha,'GITHUB_RESPONSE','Created PR does not match the task.');return value;}
  async ci(task){
    const {repo,value}=await this.scoped(`actions/runs?event=pull_request&head_sha=${enc(task.commitSha)}&per_page=100`);
    insist(Array.isArray(value.workflow_runs),'GITHUB_RESPONSE','Invalid workflow runs.');
    const candidates=value.workflow_runs.filter(r=>r.path?.split('@')[0]===this.policy.workflowPath&&r.head_sha===task.commitSha&&r.event==='pull_request'&&String(r.repository?.id)===repo.repositoryId&&r.pull_requests?.some(p=>p.number===task.prNumber));
    candidates.sort((a,b)=>b.id-a.id);const run=candidates[0];if(!run)return {state:'waiting',reason:'checks-missing',checks:[]};
    const jobs=[];for(let page=1;page<=10;page++){const x=await this.api(`/repos/${repo.fullName}/actions/runs/${run.id}/jobs?filter=latest&per_page=100&page=${page}`);insist(Array.isArray(x.jobs),'GITHUB_RESPONSE','Invalid workflow jobs.');jobs.push(...x.jobs);if(x.jobs.length<100)break;insist(page<10,'GITHUB_PAGINATION','Too many workflow jobs.');}
    const checks=this.policy.expectedChecks.map(name=>{const match=jobs.filter(j=>j.name===name);insist(match.length<=1,'CI_AMBIGUOUS','Duplicate mandatory CI job.');return {name,status:match[0]?.status||'missing',conclusion:match[0]?.conclusion||null,id:match[0]?.id||null};});
    if(run.status!=='completed')return {state:'waiting',runId:run.id,attempt:run.run_attempt,checks};
    const ok=run.conclusion==='success'&&checks.every(c=>c.status==='completed'&&c.conclusion==='success');
    return {state:ok?'passed':'failed',runId:run.id,attempt:run.run_attempt,headSha:run.head_sha,checks,checkedAt:now()};
  }
  async commit(sha){const {value}=await this.scoped(`git/commits/${sha}`);insist(value.sha===sha&&/^[0-9a-f]{40}$/.test(value.tree?.sha),'GITHUB_RESPONSE','Invalid Git commit.');return value;}
  async merge(task){const repo=await this.resolve();await this.cli(['pr','merge',String(task.prNumber),'--repo',repo.fullName,'--squash','--match-head-commit',task.commitSha],{read:false});}
  async deleteBranch(task){const current=await this.branch(task.branch);if(current===null)return;insist(current===task.commitSha,'REMOTE_BRANCH_CHANGED','The integration branch changed. It was not deleted.');await this.scoped(`git/refs/heads/${task.branch.split('/').map(enc).join('/')}`,'DELETE');}
  async releases(){const {repo,value}=await this.scoped('releases?per_page=50');insist(Array.isArray(value),'GITHUB_RESPONSE','Invalid releases.');return {repo,releases:value.filter(r=>!r.draft).map(r=>({id:r.id,tag:r.tag_name,name:r.name,prerelease:r.prerelease,publishedAt:r.published_at,assets:(r.assets||[]).map(a=>({id:a.id,name:a.name,size:a.size,digest:a.digest||null,url:a.browser_download_url,updatedAt:a.updated_at}))}))};}
}
