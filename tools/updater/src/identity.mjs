// SPDX-License-Identifier: Apache-2.0
import { insist, exactKeys, text } from './common.mjs';
export const SIGLUM_IDENTITY = Object.freeze({host:'github.com',repositoryId:'1370967185',nodeId:'R_kgDOUbdMkQ',ownerId:'255999131',targetBranch:'main'});
export const DEFAULT_POLICY = Object.freeze({...SIGLUM_IDENTITY,legacyApproved:false,legacyNames:['JaynOwO/writer-agent'],expectedChecks:['check (ubuntu-latest, 22)','check (ubuntu-latest, 24)','check (windows-latest, 22)','check (windows-latest, 24)'],workflowPath:'.github/workflows/ci.yml'});
export function verifiedIdentity(raw, policy) {
  insist(raw && String(raw.id)===policy.repositoryId && raw.node_id===policy.nodeId,'REPOSITORY_MISMATCH','Repository identity differs; a rename is not a new repository.');
  insist(String(raw.owner?.id)===policy.ownerId,'OWNER_CHANGED','Repository ownership changed. Rebind explicitly before continuing.');
  insist(!raw.archived&&!raw.disabled,'REPOSITORY_UNAVAILABLE','Repository is archived or unavailable.');
  insist(raw.permissions?.push===true || ['WRITE','MAINTAIN','ADMIN'].includes(raw.viewerPermission),'PERMISSION_REQUIRED','Repository write access was not confirmed.');
  const fullName=text(raw.full_name,'canonical repository',201);insist(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName),'REPOSITORY_MISMATCH','Unsafe canonical repository name.');
  return {host:policy.host,repositoryId:policy.repositoryId,nodeId:policy.nodeId,ownerId:policy.ownerId,ownerLogin:raw.owner.login,fullName,url:`https://${policy.host}/${fullName}`,cloneUrl:`https://${policy.host}/${fullName}.git`,targetBranch:policy.targetBranch,defaultBranch:raw.default_branch,private:!!raw.private};
}
export function validPolicy(p) {
  exactKeys(p,['host','repositoryId','nodeId','ownerId','targetBranch','legacyApproved','legacyNames','expectedChecks','workflowPath'],['host','repositoryId','nodeId','ownerId','targetBranch','legacyApproved','legacyNames','expectedChecks','workflowPath']);
  insist(p.host==='github.com'&&/^\d+$/.test(p.repositoryId)&&/^\d+$/.test(p.ownerId)&&/^R_[A-Za-z0-9_-]+$/.test(p.nodeId),'POLICY_INVALID','Only explicitly bound public GitHub identities are supported.');
  insist(p.targetBranch==='main' && p.workflowPath==='.github/workflows/ci.yml','POLICY_INVALID','This release is configured for the Siglum main integration policy.');
  insist(JSON.stringify([...p.expectedChecks].sort())===JSON.stringify([...DEFAULT_POLICY.expectedChecks].sort()),'POLICY_INVALID','The expected validation matrix cannot be weakened.');
  insist(Array.isArray(p.legacyNames)&&p.legacyNames.length<=20&&p.legacyNames.every(n=>/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(n))&&typeof p.legacyApproved==='boolean','POLICY_INVALID','Invalid legacy identity mapping.');return p;
}
export function checkRemoteName(url){
  const match=/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url);
  insist(match,'REMOTE_UNSUPPORTED','A custom host, push URL or SSH alias needs explicit configuration; it was not rewritten.');return match[1];
}
