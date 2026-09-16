// SPDX-License-Identifier: Apache-2.0
import { writeFileSync } from 'node:fs';
import { Workspace, migrateWorkspace } from '@writer-agent/storage';
import { DEFAULT_WORKFLOW_BUDGET, validateWorkflowConfig, renderWorkflowDraft, WriterError } from '@writer-agent/core';
import type { WorkflowConfig, WorkflowModel, WorkflowContentRequest, OutlineOutput, DraftOutput } from '@writer-agent/core';
import { openTerminal, WizardCancelled } from './terminal.js';
import type { WizardIO } from './terminal.js';
import { menuChoose } from './wizard.js';
import { executeWorkflow, makeWorkflowModel } from './workflow-runtime.js';
const show=(io:WizardIO,v:unknown)=>io.line(JSON.stringify(v,null,2));
async function yes(io:WizardIO,prompt:string){const a=(await io.ask(prompt+' [y/N]: ')).trim().toLowerCase();if(a==='q')throw new WizardCancelled();return ['y','yes','是'].includes(a);}
export async function runWorkflowGuide(w:Workspace,io:WizardIO,lang:'zh-CN'|'en'='zh-CN'):Promise<void>{
  const tr=(zh:string,en:string)=>lang==='zh-CN'?zh:en,s=w.workflows;
  async function create(){
    const [template]=await menuChoose(io,tr('选择工作流','Workflow template'),['new-article','revise-article','review-changes'] as const,x=>({ 'new-article':tr('根据资料写新稿','New article from sources'),'revise-article':tr('修改已有文章','Revise existing article'),'review-changes':tr('只审查待采用修改','Review pending changes only')}[x]));if(!template)return;
    let documentId:string|null=null,changeIds:string[]=[];
    if(template!=='new-article'){const [d]=await menuChoose(io,tr('选择文稿','Choose document'),w.listDocuments(),d=>d.title);if(!d)return;documentId=d.id;
      if(template==='review-changes'){changeIds=(await menuChoose(io,tr('选择待审修改','Choose pending changes'),w.listChanges(d.id).filter(c=>c.status==='pending'),c=>c.summary,true)).map(c=>c.id);if(!changeIds.length)return;}}
    const title=await io.ask(tr('任务名称: ','Task title: ')),goal=await io.ask(tr('任务目标（私人内容不会自动用于搜索）: ','Goal (not automatically sent to search): '));
    const [language]=await menuChoose(io,tr('正文语言','Writing language'),['zh-CN','en'] as const,x=>x);if(!language)return;
    let research:'web'|'selected'='selected',publicBrief='';
    if(template==='new-article'){const [mode]=await menuChoose(io,tr('资料模式','Research mode'),['web','selected'] as const,x=>x==='web'?tr('Tavily 真实联网搜索（需要自己的 Key）','Real Tavily web search (your own key required)'):tr('只使用明确选择的已保存资料','Use selected saved sources only'));if(!mode)return;research=mode;if(mode==='web')publicBrief=await io.ask(tr('可以公开交给搜索规划与搜索服务的问题: ','PUBLIC brief approved for query planning and search: '));}
    let profileId:string|null=null;if(template==='new-article'&&w.memory.profiles().length){const [p]=await menuChoose(io,tr('写作档案（0 表示不用）','Profile (0 for none)'),w.memory.profiles(),p=>p.name);profileId=p?.id??null;}
    const items=w.sources.list().filter(x=>x.latestSnapshotId!==null);const selected=items.length?await menuChoose(io,tr('选定已保存来源（0 表示不选；完整内容超限会停止）','Select saved sources (0 for none; oversized full text is refused)'),items,x=>x.source.locator,true):[];
    const [provider]=await menuChoose(io,tr('模型接口','Model provider'),['ollama','openai-compatible'] as const,x=>x);if(!provider)return;
    const model=await io.ask(tr('模型 ID: ','Model ID: '));
    const baseURL=(await io.ask(tr('API 基址（空用默认）: ','API base (empty for default): ')))||(provider==='ollama'?'http://127.0.0.1:11434':'https://api.openai.com/v1');
    const apiKeyEnv=(await io.ask(tr('模型密钥环境变量名（不是密钥，空用默认）: ','Model key environment NAME, not value (empty default): ')))||null;
    const allowRemote=await yes(io,tr('允许这个模型连接远端／云端？','Permit this model endpoint to access remote/cloud inference?'));
    let responseFormat:WorkflowModel['responseFormat']='json-schema';if(provider==='openai-compatible'){const [f]=await menuChoose(io,tr('返回格式，不自动降级','Response mode; no automatic fallback'),['json-schema','json','prompt'] as const,x=>x);if(!f)return;responseFormat=f;}
    const c:WorkflowConfig={template,title,goal,publicBrief,language,research,documentId,changeIds,selection:{snapshots:selected.map(x=>x.latestSnapshotId!)},profileId,intent:null,memoryOptions:{language},model:{provider,model,baseURL,apiKeyEnv,allowRemote,responseFormat,tokenParameter:'max_completion_tokens',timeoutMs:120000,maxOutputTokens:8192},searchKeyEnv:'TAVILY_API_KEY',domains:[],timeRange:null,autoRevision:template==='review-changes'?false:await yes(io,tr('预先允许最多一轮修订？保留原候选，不自动采用','Permit at most one revision? Preserve originals; no auto-adoption')),budget:{...DEFAULT_WORKFLOW_BUDGET}};
    if(research==='web'){const domains=(await io.ask(tr('域名限制（逗号分隔；留空不限公共域名）: ','Domain allowlist (comma separated, empty any public domain): '))).trim();c.domains=domains?domains.split(',').map(s=>s.trim()):[];const name=await io.ask(tr('搜索 Key 环境变量名（留空 TAVILY_API_KEY）: ','Search key environment NAME (empty TAVILY_API_KEY): '));if(name)c.searchKeyEnv=name;}
    if(await yes(io,tr('调整默认次数／活跃时间预算？','Adjust default attempt/time budgets?'))){for(const key of ['models','searches','fetches','activeMs'] as const){const raw=await io.ask(`${key} [${c.budget[key]}]: `);if(raw.trim())c.budget[key]=Number(raw);}}
    validateWorkflowConfig(c);makeWorkflowModel(c.model);show(io,c);
    if(await yes(io,tr('保存这个任务？尚不调用任何外部服务','Save this task? No external service is called yet')))show(io,s.create(c));
  }
  async function manage(id:string){
    for(;;){const run=s.run(id);io.line(`${run.config.title} — ${run.state} / ${run.stage}`);io.line(run.notice);
      const actions=['show','authorize','continue','outline','amend','reply','artifacts','adopt','changes','recover','retry','refresh','revoke','cancel','finish','compare','budget'] as const;
      const names={compare:tr('比较新稿 A／B 的准确文字差异','Compare draft A/B exact text'),budget:tr('调整任务总预算并重新授权','Adjust task budgets and reauthorize'),show:tr('查看任务／预算','Inspect task / budgets'),authorize:tr('预览并批准本阶段','Preview and authorize stage'),continue:tr('继续已经批准的阶段','Continue approved stage'),outline:tr('查看并批准大纲','Inspect/approve outline'),amend:tr('手工修改大纲','Amend outline manually'),reply:tr('回复问题／修改方向后重做大纲','Reply / change direction; regenerate outline'),artifacts:tr('查看／导出产物','Inspect/export artifacts'),adopt:tr('采用一个最终候选为正式稿','Adopt a final candidate'),changes:tr('逐项决定旧稿修改','Decide individual existing-article edits'),recover:tr('恢复已退出的工作进程（非重试）','Recover exited worker (not retry)'),retry:tr('明确重试失败／结果未知请求','Explicitly retry failed/unknown request'),refresh:tr('重新捕获当前文章／意图／资料','Refresh captured document/guidance'),revoke:tr('撤销阶段授权','Revoke stage consent'),cancel:tr('取消任务，保留历史','Cancel task, retain history'),finish:tr('结束旧稿／审稿任务，不批准正文','Close revision/review task without approving text')};
      const [action]=await menuChoose(io,tr('任务操作','Task actions'),actions,x=>names[x]);if(!action)return;
      try{
        if(action==='compare'){const items=s.artifacts(id).filter(a=>['draft','draft-revision'].includes(a.type));const [a]=await menuChoose(io,tr('原候选','Before candidate'),items,a=>a.type+' '+a.createdAt);if(!a)continue;const [b]=await menuChoose(io,tr('新候选','After candidate'),items.filter(b=>b.id!==a.id),a=>a.type+' '+a.createdAt);if(b)show(io,s.compare(id,a.id,b.id));}
        else if(action==='budget'){const budget={...run.config.budget};for(const k of ['models','searches','fetches','activeMs'] as const){const raw=await io.ask(`${k} [${budget[k]}]: `);if(raw.trim())budget[k]=Number(raw);}show(io,{spent:s.usage(id),proposed:budget});if(await yes(io,tr('保存新预算并撤销旧阶段许可？已用次数不清零','Save budget and revoke old stage consent? Spent attempts stay counted')))show(io,s.setBudget(id,budget));}
        else if(action==='show')show(io,{run,attemptBudget:s.usage(id),monetaryCost:'unknown'});
        else if(action==='authorize'){const p=s.preview(id);show(io,p);if(await yes(io,tr('批准以上阶段权限与次数上限？可能产生模型／搜索费用','Approve EXACT stage scope and attempt limits? Model/search fees may apply'))){s.authorize(id,p.fingerprint,p.limits);if(await yes(io,tr('现在执行到下一个检查点？','Execute to the next checkpoint now?')))show(io,await executeWorkflow(w,id,undefined,io.signal));}}
        else if(action==='continue'){show(io,{stage:run.stage,grant:run.grantId?s.grant(run.grantId):null,attemptBudget:s.usage(id)});if(await yes(io,tr('按原有有效授权继续？不会静默重试失败请求','Continue under valid saved consent? Failed requests are not silently retried')))show(io,await executeWorkflow(w,id,undefined,io.signal));}
        else if(action==='outline'){if(!run.outlineId){io.line(tr('尚无大纲。','No outline yet.'));continue;}show(io,s.artifact(run.outlineId));if(await yes(io,tr('批准这个确切版本的大纲？写作阶段另行确认','Approve this exact outline? Composition requires its own stage consent')))show(io,s.chooseOutline(id,run.outlineId));}
        else if(action==='amend'){if(!run.outlineId)continue;const a=s.artifact(run.outlineId),v=a.value as {output:OutlineOutput;request:WorkflowContentRequest};const out=structuredClone(v.output);show(io,out);const direction=await io.ask(tr('新方向（留空保留）: ','Direction (empty keep): '));if(direction)out.direction=direction;const [section]=await menuChoose(io,tr('要改哪一节（0 跳过）','Section to edit (0 skip)'),out.sections,x=>x.heading);if(section){const heading=await io.ask(tr('节标题（留空保留）: ','Heading (empty keep): '));if(heading)section.heading=heading;const points=await io.ask(tr('要点（用 | 分隔，留空保留）: ','Points (separate with |; empty keep): '));if(points)section.points=points.split('|').map(s=>s.trim());}show(io,out);if(await yes(io,tr('保存人工改版？旧候选会保留但不再作为当前候选','Save author amendment? Old candidates remain historical')))show(io,s.amendOutline(id,a.id,out));}
        else if(action==='reply'){const feedback=await io.ask(tr('补充讨论／修改要求（不进入公开搜索 brief）: ','Discussion / changed direction (not added to public search brief): '));if(!feedback.trim())continue;const c={...run.config,goal:run.config.goal+'\nAuthor follow-up: '+feedback};show(io,c);if(await yes(io,tr('重新批准研究阶段后生成新大纲？次数不清零，匹配的搜索／采集结果复用','Refresh direction? Reauthorize to regenerate; attempts stay counted, matching public research is reused')))show(io,s.refresh(id,c));}
        else if(action==='artifacts'){const [a]=await menuChoose(io,tr('保存的产物','Saved artifacts'),s.artifacts(id),a=>`${a.type} / epoch ${a.epoch} / ${a.createdAt}`);if(!a)continue;show(io,a);if(await yes(io,tr('将此产物导出到新文件？内含私人材料','Export to a new file? Includes private material'))){const path=await io.ask(tr('新文件路径: ','New file path: '));writeFileSync(path,JSON.stringify(a,null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});}}
        else if(action==='adopt'){const [a]=await menuChoose(io,tr('选择最终候选（A／B 都需人工审查）','Choose final candidate (A/B require author review)'),run.candidateIds.map(x=>s.artifact(x)),a=>a.type+' '+a.createdAt);if(!a)continue;const v=a.value as {output:DraftOutput;request:WorkflowContentRequest};if(!['draft','draft-revision'].includes(a.type)){io.line(tr('这是旧稿提案，使用逐项修改菜单。','Use individual edit decisions for proposal artifacts.'));continue;}io.line(renderWorkflowDraft(v.output,v.request.sources));if(await yes(io,tr('采用以上候选，建立一篇正式文稿？不会发布到外网','Adopt this exact candidate into a new manuscript? Not external publication')))show(io,{documentId:s.adopt(id,a.id)});}
        else if(action==='changes'){if(!run.config.documentId)continue;const ids=run.candidateIds.flatMap(a=>(s.artifact(a).value as {changeIds:string[]}).changeIds);const changes=ids.map(x=>w.getChange(x));const [c]=await menuChoose(io,tr('选择一项修改','Choose an edit'),changes,c=>`${c.status}: ${c.summary}`);if(!c)continue;show(io,c);const [choice]=await menuChoose(io,tr('明确的正文操作','Explicit text decision'),['accept','reject','revert'] as const,x=>x);if(!choice)continue;const reason=await io.ask(tr('理由（可留空）: ','Reason (optional): '));if(await yes(io,tr('执行此正文操作？','Perform this text operation?')))show(io,w[choice](c.id,reason));}
        else if(action==='recover'){if(await yes(io,tr('仅恢复已结束／过期的执行租约？不重新发送请求','Recover only an expired/exited worker? No request will be resent'))){s.recover(id);show(io,s.attempts(id));}}
        else if(action==='retry'){const [a]=await menuChoose(io,tr('选择失败／未知尝试','Failed/unknown attempts'),s.attempts(id).filter(a=>['failed','outcome-unknown'].includes(a.status)),a=>`${a.task}: ${a.status} (${a.errorCode})`);if(a&&await yes(io,tr('允许再次尝试？服务可能已处理／扣费，重试可能重复','Allow a new attempt? Service may already have processed/charged it; retry can duplicate')))s.retry(id,a.id,true);}
        else if(action==='refresh'){if(await yes(io,tr('刷新相关输入并撤销旧授权？不重置预算','Refresh related inputs and revoke old consent? Budget is not reset')))show(io,s.refresh(id));}
        else if(action==='revoke'||action==='cancel'){if(await yes(io,tr('停止并撤销授权？保留历史','Stop and revoke consent? Keep history')))s.pause(id,action==='cancel');}
        else if(action==='finish'){if(await yes(io,tr('只结束任务，不批准任何正文？','Close task only, without approving text?')))s.finish(id);}
      }catch(e){if(e instanceof WizardCancelled||io.signal?.aborted)throw new WizardCancelled();io.line((e instanceof Error?e.message:'Workflow action failed.')+'\n'+tr('操作停止；没有跳过安全检查。','Stopped; no guard was bypassed.'));}
    }
  }
  for(;;){const [action]=await menuChoose(io,tr('Siglum 写作工作流','Siglum writing workflows'),['create','list'] as const,x=>x==='create'?tr('创建任务','Create task'):tr('打开／恢复任务','Open / resume task'));if(!action)return;
    try{if(action==='create')await create();else{const [r]=await menuChoose(io,tr('选择任务','Choose task'),s.list(),r=>`${r.config.title} — ${r.state}`);if(r)await manage(r.id);}}
    catch(e){if(e instanceof WizardCancelled||io.signal?.aborted)throw new WizardCancelled();io.line(e instanceof Error?e.message:'Workflow guide action failed.');}
  }
}
export async function workflowGuideCommand(args:string[]):Promise<void>{
  if(args.length!==1&&!(args.length===3&&args[1]==='--lang'&&['zh-CN','en'].includes(args[2]!)))throw new WriterError('INVALID_INPUT','Usage: siglum workflow guide <workspace> [--lang zh-CN|en]');
  const terminal=openTerminal();let w:Workspace|null=null;
  try{w=Workspace.open(args[0]!);if(w.info().schemaVersion<5){w.close();w=null;show(terminal.io,migrateWorkspace(args[0]!));if(!await yes(terminal.io,'Back up and explicitly migrate workspace to schema v5? / 备份并升级工作区？'))return;show(terminal.io,migrateWorkspace(args[0]!,true));w=Workspace.open(args[0]!);}await runWorkflowGuide(w,terminal.io,args[2]==='en'?'en':'zh-CN');}
  catch(e){if(e instanceof WizardCancelled)terminal.io.line('Cancelled / 已取消。 No implicit approval.');else throw e;}
  finally{w?.close();terminal.close();}
}
