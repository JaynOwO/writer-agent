'use strict';
const $=id=>document.getElementById(id),token=location.hash.slice(1)||sessionStorage.getItem('siglum-updater-session')||'';if(/^[0-9a-f]{64}$/.test(token))sessionStorage.setItem('siglum-updater-session',token);history.replaceState(null,'',location.pathname);let language='zh',state=null,selected=null,configPreview=null,releaseProducts=[],polling=false;
const say=(zh,en)=>language==='zh'?zh:en;
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
function showError(e){$('error').hidden=false;$('error').textContent=(e.code?e.code+' · ':'')+(e.message||String(e));}
async function api(path,body,binary=false){const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':binary?'application/octet-stream':'application/json'})},body:body===undefined?undefined:binary?body:JSON.stringify(body),credentials:'omit',cache:'no-store'});const result=await r.json();if(!r.ok)throw Object.assign(new Error(result.error?.message||'Request failed'),result.error||{});return result;}
function button(zh,en,fn,cls){const b=node('button',say(zh,en),cls);b.addEventListener('click',async()=>{b.disabled=true;$('error').hidden=true;try{await fn();}catch(e){showError(e);}finally{b.disabled=false;}});return b;}
function describeState(t){return t.alreadyCurrent?say('远端内容已经一致','Remote tree already matches'):t.error?say('已暂停，结果保留','Paused; results retained'):t.active?say('正在执行','Running'):t.state;}
// Keep one state refresh in flight. Detail reads have independent selection epochs:
// a late response may never reopen a closed task or overwrite another selection.
let refreshFlight = null, refreshQueued = false, detailFlight = null;
let selectionEpoch = 0, detailTicket = 0, taskActionBusy = false;
let lastTasksKey = '', lastFactsKey = '', lastActionsKey = '';
const previewCache = new Map();
function setText(element, value, { follow = false } = {}) {
  const text = String(value ?? '');
  if (element.textContent === text) return;
  const top = element.scrollTop, left = element.scrollLeft;
  const atEnd = element.scrollHeight - element.clientHeight - top < 8;
  element.textContent = text;
  element.scrollTop = follow && atEnd ? element.scrollHeight : top;
  element.scrollLeft = left;
}
function resetDetail() {
  lastFactsKey = ''; lastActionsKey = '';
  setText($('details'), ''); setText($('output'), '');
  $('details').scrollTop = 0; $('output').scrollTop = 0;
  $('actions').replaceChildren(); $('facts').replaceChildren();
  setText($('task-status'), say('正在读取任务…', 'Loading task…'));
}
function statusText(t, active) {
  if (t.error) {
    if (t.error.code === 'PROCESS_FAILED' && t.state === 'applied') return say(
      '本地验证失败；尚未创建此次提交或 PR。请查看执行输出或导出故障详情，先不要重复执行。',
      'Local validation failed; this task has not created a commit or PR. Read the saved output or export a failure report before retrying.');
    return say('任务已暂停：', 'Task paused: ') + t.error.code + ' · ' + t.error.message;
  }
  if (!t.authorized) return say('待确认，尚未执行。阅读预览不会授权或运行任务。', 'Awaiting approval; not running. Reading a preview does not authorize or execute this task.');
  if (active) return say('正在执行，已保存的进度会保留。', 'Running; completed checkpoints are retained.');
  return say('当前阶段：', 'Current phase: ') + t.state;
}
function renderTaskList() {
  // Unchanged polling must retain button focus and DOM identity.
  const key = JSON.stringify([language, state.tasks.map(t => [t.id,t.revision,t.active,t.state,t.error?.code,t.alreadyCurrent])]);
  if (key === lastTasksKey) return;
  const list = $('tasks'), rows = [];
  if (!state.tasks.length) rows.push(node('p',say('尚无任务。先选择需要集成的 ZIP。','No tasks yet. Choose the source delivery ZIP.'),'muted'));
  for (const t of state.tasks) {
    const row=node('div',undefined,'task'),left=node('div');
    left.append(node('strong','Siglum v'+t.version),node('div',t.repositoryName+' · '+t.bundleHash.slice(0,12),'muted'));
    row.append(left,node('span',describeState(t),'tag'),button('查看','Open',()=>openTask(t.id)));
    rows.push(row);
  }
  list.replaceChildren(...rows); lastTasksKey = key;
}
function refresh(queue = true) {
  if (refreshFlight) { if (queue) refreshQueued = true; return refreshFlight; }
  refreshFlight = (async () => {
    do {
      refreshQueued = false;
      state = await api('state');
      $('setup').hidden=state.configured; $('connected').hidden=!state.configured;
      if (!state.configured && state.legacyHint && !$('repo').value) $('repo').value=state.legacyHint;
      if (state.config) {
        setText($('repository'),'GITHUB.COM · REPOSITORY ID '+state.config.identity.repositoryId);
        setText($('local-path'),state.config.repoPath);
      }
      renderTaskList();
      if (selected) await openTask(selected,false);
    } while (refreshQueued);
  })().finally(() => { refreshFlight = null; });
  return refreshFlight;
}
async function taskAction(id, fn) {
  if (taskActionBusy) return;
  taskActionBusy = true;
  for (const b of $('actions').querySelectorAll('button')) b.disabled = true;
  try { await fn(); }
  finally {
    taskActionBusy = false;
    for (const b of $('actions').querySelectorAll('button')) b.disabled = false;
  }
}
function renderActions(t, p, active) {
  const key = JSON.stringify([t.id,t.revision,language,t.authorized,active,t.state,t.error?.code,t.remoteMerged,t.localSynced,t.cleanupComplete,p?.fingerprint]);
  if (key === lastActionsKey) return;
  const id=t.id, actions=[];
  const taskButton = (zh,en,fn,cls) => button(zh,en,()=>taskAction(id,fn),cls);
  if (!t.authorized) {
    if (p) for (const mode of ['full','pr-only']) actions.push(taskButton(
      mode==='full'?'确认并全流程执行':'确认，仅创建 PR', mode==='full'?'Approve full integration':'Approve PR only', async()=>{
        if (!confirm(say('将执行此可信项目的测试并上传开发分支。全流程模式会在 CI 通过后合并。是否批准上述准确包？','This executes trusted project checks and pushes a feature branch. Full mode merges after CI. Approve the exact package?'))) return;
        await api('action',{id,action:'approve',fingerprint:p.fingerprint,mode,expectedRevision:t.revision});
        await api('action',{id,action:'run'}); await refresh();
      },mode==='full'?'primary':''));
  } else if (active) {
    actions.push(taskButton('暂停执行','Pause',async()=>{await api('action',{id,action:'pause'});await refresh();},'danger'));
  } else {
    actions.push(taskButton(t.state==='done'?'核对已完成结果':'继续／重试','Continue / reconcile',async()=>{
      let ackUnknown=false,recoverLock=false;
      if(t.error?.code==='OUTCOME_UNKNOWN'){
        ackUnknown=confirm(say('远端写入结果尚未确认。重新尝试可能重复外部操作；只有同意后才重试。','The remote outcome remains unconfirmed. A retry may repeat an external operation. Acknowledge retry?'));
        if(!ackUnknown)return;
      }
      if(t.error?.code==='REPOSITORY_LOCKED'){
        recoverLock=confirm(say('仅恢复此任务记录的已退出进程锁，不会抢占运行中的进程。继续？','Recover only this task’s dead-process lock; live locks will not be stolen. Continue?'));
        if(!recoverLock)return;
      }
      await api('action',{id,action:'run',ackUnknown,recoverLock,expectedRevision:t.revision});await refresh();
    },'primary'));
    if(t.remoteMerged&&(!t.localSynced||!t.cleanupComplete))actions.push(taskButton('只补同步与清理','Finish local steps',async()=>{await api('action',{id,action:'run',finishLocal:true,expectedRevision:t.revision});await refresh();}));
    if(t.state==='local-validated')actions.push(taskButton('重新本地验证','Revalidate',async()=>{await api('action',{id,action:'revalidate',expectedRevision:t.revision});await refresh();}));
  }
  for (const b of actions) b.disabled = taskActionBusy;
  // Build the complete next state before replacing: never clear controls then await.
  $('actions').replaceChildren(...actions); lastActionsKey=key;
}
function renderDetail(r,p) {
  const t=r.task; $('detail').hidden=false;
  setText($('detail-title'),'Siglum v'+t.version);
  setText($('task-status'),statusText(t,r.active));
  const detail = JSON.stringify({repository:t.repositoryName,repositoryId:t.repositoryId,phase:t.state,pendingAction:t.pendingAction,bundle:t.bundleHash,PR:t.prNumber,commit:t.commitSha,merge:t.mergeSha,error:t.error?{code:t.error.code,message:t.error.message,exitCode:t.error.details?.exitCode??null,signal:t.error.details?.signal??null}:null,warnings:t.historyWarnings},null,2);
  setText($('details'),detail+(p?'\n\n'+JSON.stringify(p,null,2):''));
  setText($('output'),r.output || '',{follow:true});
  setText($('log-notice'),r.logInfo?.truncated ? say('仅显示保存日志的末尾；导出故障详情会标明截取范围。','Showing the saved log tail only; exported reports disclose truncation.') : r.logInfo?.error ? say('保存日志暂不可读；错误摘要仍保留。','The saved log is unavailable; the error summary is retained.') : '');
  const factsKey=JSON.stringify([language,t.remoteMerged,t.alreadyCurrent,t.localSynced,t.cleanupComplete]);
  if(factsKey!==lastFactsKey){
    const facts=[];
    for(const[yes,zh,en]of[[t.remoteMerged||t.alreadyCurrent,'GitHub 远端','Remote GitHub'],[t.localSynced,'日常目录同步','Original checkout'],[t.cleanupComplete,'临时分支清理','Branch cleanup']]){
      const f=node('div',undefined,'fact');f.append(node('b',yes?say('已确认','Confirmed'):say('未完成／不适用','Pending / not applicable')),node('span',say(zh,en)));facts.push(f);
    }
    $('facts').replaceChildren(...facts);lastFactsKey=factsKey;
  }
  renderActions(t,p,r.active);
}
function openTask(id,scroll=true) {
  if(selected!==id){selected=id;selectionEpoch++;resetDetail();$('detail').hidden=false;}
  const epoch=selectionEpoch,lang=language;
  if(detailFlight?.id===id&&detailFlight.epoch===epoch&&detailFlight.lang===lang) return detailFlight.promise;
  const ticket=++detailTicket;
  const current=()=>selected===id&&selectionEpoch===epoch&&language===lang&&ticket===detailTicket;
  const promise=(async()=>{
    const r=await api('task?id='+encodeURIComponent(id));
    if(!current())return;
    let p=null,previewError=null;
    if(!r.task.authorized){
      const cacheKey=id+':'+r.task.revision;
      p=previewCache.get(cacheKey);
      if(!p){
        try {p=await api('preview?id='+encodeURIComponent(id));}
        catch(e){previewError=e;}
        if(p){previewCache.set(cacheKey,p);if(previewCache.size>200)previewCache.delete(previewCache.keys().next().value);}
      }
    }
    if(!current())return;
    renderDetail(r,p);
    if(previewError)showError(previewError);
    if(scroll)$('detail').scrollIntoView({behavior:'smooth'});
  })().finally(()=>{if(detailFlight?.ticket===ticket)detailFlight=null;});
  detailFlight={id,epoch,lang,ticket,promise};return promise;
}
async function upload(file){if(!file)return;insistFile(file);const result=await api('prepare',await file.arrayBuffer(),true);await refresh();await openTask(result.task.id);}
function insistFile(f){if(f.size>128000000)throw new Error(say('源码更新 ZIP 超过 128 MB 上限。请勿选择桌面安装包。','Source ZIP exceeds 128 MB. Do not select a desktop installer.'));}
$('zip').addEventListener('change',e=>upload(e.target.files[0]).catch(showError));$('drop').addEventListener('dragover',e=>{e.preventDefault();});$('drop').addEventListener('drop',e=>{e.preventDefault();upload(e.dataTransfer.files[0]).catch(showError);});
$('config-preview').onclick=async()=>{try{configPreview=await api('config/preview',{repoPath:$('repo').value});$('config-details').textContent=JSON.stringify(configPreview,null,2);$('config-confirm').hidden=false;}catch(e){showError(e);}};
$('config-confirm').onclick=async()=>{try{if(!configPreview||!confirm(say('确认按显示的仓库 ID 绑定，并复用现有 gh 登录？','Bind this exact repository ID and reuse existing gh login?')))return;await api('config/confirm',{fingerprint:configPreview.fingerprint});configPreview=null;await refresh();}catch(e){showError(e);}};
$('refresh').onclick=()=>refresh().catch(showError);$('close-detail').onclick=()=>{selected=null;selectionEpoch++;detailTicket++;$('detail').hidden=true;};
$('diagnostic').onclick=async()=>{try{const x=await api('diagnostic?id='+encodeURIComponent(selected)),url=URL.createObjectURL(new Blob([JSON.stringify(x,null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download='siglum-updater-diagnostic.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){showError(e);}};

$('failure-report').onclick=async()=>{
  const id=selected;if(!id)return;
  const b=$('failure-report');b.disabled=true;
  try{
    if(!confirm(say('导出此任务保存的执行日志末尾和命令错误。不执行任务、不连接 GitHub。日志可能包含本机路径和项目测试文本；导出后请检查再分享。继续？','Export this task’s saved log tail and process error. No task execution or GitHub connection. Logs may include local paths and project test text; review before sharing. Continue?')))return;
    const x=await api('failure-report',{id,confirm:true});
    const url=URL.createObjectURL(new Blob([JSON.stringify(x,null,2)],{type:'application/json'})),a=node('a');
    a.href=url;a.download='siglum-updater-failure-'+id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){showError(e);}finally{b.disabled=false;}
};
$('releases').onclick=async()=>{try{$('release-section').hidden=false;$('release-info').textContent=say('正在读取已绑定仓库的 Release 元数据…','Reading release metadata from the bound repository…');const c=await api('releases',{});releaseProducts=c.products;$('release-info').textContent=say('下载不等于执行或安装。缺少可识别产品清单的 Release 不会被猜测安装。','Downloading does not execute or install. Releases without a product descriptor are not guessed.');$('release-list').replaceChildren();if(!c.products.length)$('release-list').append(node('p',say('暂无带产品清单的可用资产。仍可使用本地 delivery ZIP。','No recognized release assets. Local delivery ZIPs remain available.')));for(const p of c.products){const row=node('div',undefined,'task');row.append(node('span',p.product+' '+p.version+' · '+p.kind+' · '+Math.round(p.size/1e6)+' MB'));row.append(button('确认下载','Download',async()=>{const d=await api('download',p);row.append(node('p',say('已校验，保存至：','Verified; saved to: ')+d.path,'muted'));if(p.kind==='source-delivery')row.append(button('预览源码集成','Preview integration',async()=>{const r=await api('prepare-downloaded',p);await refresh();await openTask(r.task.id);}));}));$('release-list').append(row);}}catch(e){showError(e);}};
$('lang').onclick=()=>{language=language==='zh'?'en':'zh';document.documentElement.lang=language==='zh'?'zh-CN':'en';$('lang').textContent=language==='zh'?'English':'简体中文';$('headline').textContent=say('更新代码，保留你的工作。','Update code. Preserve your work.');$('intro').textContent=say('独立目录集成 · 明确检查 · 可恢复的每一步','Isolated worktree · Explicit checks · Recoverable checkpoints');$('tasks-title').textContent=say('集成任务','Integration tasks');$('drop-text').textContent=say('选择或拖入完整更新 ZIP','Choose or drop a source delivery ZIP');$('footer').textContent=say('面板关闭不会自动停止宿主。使用「退出」停止当前任务；已经完成的结果会保留。','Closing the browser does not stop the host. Use Quit to pause and exit; saved results remain.');$('setup-title').textContent=say('一次性连接现有仓库','Connect your existing repository once');$('scope-warning').textContent=say('更新器会执行可信项目的构建与测试。独立 worktree 不是安全沙箱。','This runs trusted project builds and tests. A worktree is not an OS sandbox.');refresh().catch(showError);};
$('exit').onclick=async()=>{try{if(!confirm(say('停止当前执行并退出本地更新器？已经保存的进度会保留。','Pause execution and quit the local updater? Saved checkpoints remain.')))return;await api('exit',{confirm:true});$('headline').textContent=say('正在停止，可关闭页面。','Stopping. You may close this page.');clearInterval(timer);}catch(e){showError(e);}};
const timer=setInterval(async()=>{if(polling)return;polling=true;try{await refresh(false);}catch(e){showError(e);}finally{polling=false;}},3000);
if(!/^[0-9a-f]{64}$/.test(token))showError(new Error(say('请从 Siglum Updater 启动入口打开完整会话链接。','Open the complete session link from the Siglum Updater launcher.')));else refresh().catch(showError);
