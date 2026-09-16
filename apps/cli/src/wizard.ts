// SPDX-License-Identifier: Apache-2.0
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { WriterError, validateIntentCard, validatePreferenceInput, validateWritingRule, checkWritingRules, renderMarkdown, validateProfileExport } from '@writer-agent/core';
import type { IntentCard, PreferenceInput, WritingRule, WritingLanguage, MemoryOptions, WritingTask, SourceSelection } from '@writer-agent/core';
import { Workspace, migrateWorkspace } from '@writer-agent/storage';
import { ProviderError } from '@writer-agent/models';
import type { OpenAICompatibleProvider, OllamaProvider } from '@writer-agent/models';
import { parseSuggestArgs, prepareSuggestion, submitSuggestion } from './suggest.js';
import { runAnalysis } from './analysis-command.js';
import { runMemoryTask, readMemoryJson, exportMemoryJson } from './memory-command.js';
import { WizardCancelled, openTerminal, terminalText } from './terminal.js';
import type { WizardIO } from './terminal.js';
export type MenuLanguage='zh-CN'|'en';
const PAGE=8;
export async function menuChoose<T>(io:WizardIO,title:string,items:readonly T[],label:(v:T)=>string,multiple=false):Promise<T[]>{
  if(!items.length){io.line(title+' — (empty)');return [];}
  let page=0;
  for(;;){
    if(io.signal?.aborted)throw new WizardCancelled();
    io.line('\n'+title);items.slice(page*PAGE,(page+1)*PAGE).forEach((v,i)=>io.line(`${page*PAGE+i+1}. ${terminalText(label(v))}`));
    io.line(`0: Back / 返回  |  n: Next / 下一页  |  p: Previous / 上一页  (${page+1}/${Math.ceil(items.length/PAGE)})`);
    const raw=(await io.ask(multiple?'Numbers, comma separated / 编号（逗号分隔）: ':'Number / 编号: ')).trim();
    if(raw===''||raw==='0')return [];
    if(raw==='n'){page=Math.min(page+1,Math.ceil(items.length/PAGE)-1);continue;}
    if(raw==='p'){page=Math.max(page-1,0);continue;}
    if(raw==='q')throw new WizardCancelled();
    const parts=raw.split(',');if(!multiple&&parts.length!==1){io.line('Choose one / 请选择一个');continue;}
    const nums=parts.map(s=>Number(s.trim()));if(parts.some(s=>!/^\d+$/.test(s.trim()))||nums.some(n=>n<1||n>items.length)||new Set(nums).size!==nums.length){io.line('Invalid selection / 编号无效');continue;}
    return nums.map(n=>items[n-1]!);
  }
}
async function yes(io:WizardIO,prompt:string):Promise<boolean>{const answer=(await io.ask(prompt+' [y/N]: ')).trim().toLowerCase();if(answer==='q')throw new WizardCancelled();return ['y','yes','是'].includes(answer);}
function show(io:WizardIO,value:unknown){io.line(terminalText(JSON.stringify(value,null,2)));}
export async function runWizard(w:Workspace,io:WizardIO,lang:MenuLanguage='zh-CN'):Promise<void>{
  const tr=(zh:string,en:string)=>lang==='zh-CN'?zh:en;
  let documentId:string|null=null;
  let lastProvider:OpenAICompatibleProvider|OllamaProvider|null=null;
  async function pickDocument(){const docs=w.listDocuments();const [d]=await menuChoose(io,tr('选择文稿','Choose document'),docs,d=>d.title);if(d)documentId=d.id;}
  async function doc(){if(!documentId)await pickDocument();if(!documentId)throw new WriterError('INVALID_INPUT',tr('尚未选择文稿。','No document selected.'));return documentId;}
  async function language():Promise<WritingLanguage>{const [l]=await menuChoose(io,tr('规则适用语言（不是菜单语言）','Writing language (not menu language)'),['zh-CN','en','any'] as const,x=>x);if(!l)throw new WizardCancelled();return l;}
  async function profile(){const id=await doc(),current=w.memory.attachedProfile(id);if(current)return current;
    await chooseProfile();const p=w.memory.attachedProfile(id);if(!p)throw new WriterError('INVALID_INPUT',tr('请先选择一个写作档案。','Choose a writing profile first.'));return p;}
  async function chooseProfile(){
    const id=await doc(),profiles=w.memory.profiles();
    const [action]=await menuChoose(io,tr('写作档案','Writing profile'),['choose','create','detach'] as const,x=>({choose:tr('选择已有档案','Select existing'),create:tr('新建档案','Create profile'),detach:tr('不使用档案','Detach profile')}[x]));
    if(action==='create'){const name=(await io.ask(tr('档案名称: ','Profile name: '))).trim();if(!name)return;if(await yes(io,tr(`新建并使用“${name}”？`,`Create and attach "${name}"?`))){const p=w.memory.createProfile(name);w.memory.attach(id,p.id);}}
    else if(action==='choose'){const [p]=await menuChoose(io,tr('选择档案','Choose profile'),profiles,p=>p.name);if(p&&await yes(io,tr('将这个档案用于当前文章？','Use this profile for this article?')))w.memory.attach(id,p.id);}
    else if(action==='detach'&&await yes(io,tr('取消当前文章的档案关联？','Detach the current profile?')))w.memory.attach(id,null);
  }
  async function rule():Promise<WritingRule|null>{
    const keys=['guidance','tone','sentence-style','avoid-phrase','max-characters'] as const;
    const names:Record<typeof keys[number],string>={guidance:tr('自由文字要求（语义检查）','Free-text guidance (semantic)'),tone:tr('语气（语义检查）','Tone (semantic)'), 'sentence-style':tr('句式风格（语义检查）','Sentence style (semantic)'), 'avoid-phrase':tr('固定禁用短语（区分大小写）','Avoid literal phrase (case-sensitive)'), 'max-characters':tr('最长字数（Unicode码点，含空白）','Max characters (Unicode code points incl. whitespace)')};
    const [key]=await menuChoose(io,tr('选择规则类型','Choose rule type'),keys,x=>names[x]);if(!key)return null;
    const value=await io.ask(tr('规则内容／数值: ','Rule text/value: '));
    const required=await yes(io,tr('设为重要约束？仍不代表模型能保证遵守','Mark required? This is not a guarantee of model compliance'));
    const r:WritingRule={key,value,strength:required?'required':'preferred'};validateWritingRule(r);return r;
  }
  async function provider():Promise<OpenAICompatibleProvider|OllamaProvider>{
    if(lastProvider&&await yes(io,tr('沿用本次会话刚选择的模型？','Reuse the model selected in this guide session?')))return lastProvider;
    const [kind]=await menuChoose(io,tr('选择模型接口','Choose provider'),['ollama','openai-compatible'] as const,x=>x);if(!kind)throw new WizardCancelled();
    const model=await io.ask(tr('模型 ID（需自行已有访问权限）: ','Model ID (must already be available): '));
    const base=await io.ask(tr('API 基址（留空用该接口默认地址）: ','API base (empty for provider default): '));
    const keyEnv=await io.ask(tr('密钥环境变量名（不是密钥本身，留空用默认）: ','Key environment variable NAME, not the key (empty for default): '));
    const allow=await yes(io,tr('允许连接远端／云端？稍后发送前还会显示完整范围与目标','Allow remote/cloud endpoint? The final request still needs explicit send confirmation'));
    const args=[w.root,await doc(),'--provider',kind,'--model',model,'--instruction','Preview configuration',...(base?['--base-url',base]:[]),...(keyEnv?['--key-env',keyEnv]:[]),...(allow?['--allow-remote']:[])];
    if(kind==='openai-compatible'){const [f]=await menuChoose(io,tr('返回格式（不自动降级）','Response format (no automatic fallback)'),['json-schema','json','prompt'] as const,x=>x);if(!f)throw new WizardCancelled();args.push('--response-format',f);}
    lastProvider=parseSuggestArgs(args).provider;return lastProvider;
  }
  async function intent(){const id=await doc();
    const [action]=await menuChoose(io,tr('文章意图卡','Article intent'),['manual','model','drafts','current'] as const,x=>({manual:tr('手工填写／套用模板','Fill manually / use template'),model:tr('AI 将说明整理成草案','Ask AI to draft from your brief'),drafts:tr('查看／确认已有草案','Inspect / confirm a draft'),current:tr('查看当前意图','Inspect current intent')}[x]));
    if(action==='current'){show(io,w.memory.activeIntent(id));return;}
    if(action==='drafts'){const [v]=await menuChoose(io,tr('意图版本','Intent versions'),w.memory.intents(id),v=>`${v.status}: ${v.card.purpose||v.card.audience||v.id}`);if(!v)return;show(io,v);if(v.runId)show(io,w.memory.taskRun(v.runId).output);if(v.status==='draft'&&await yes(io,tr('确认这张卡片准确表达你的要求并启用？','Confirm this expresses your requirements and activate it?')))w.memory.confirmIntent(v.id);return;}
    if(action==='model'){
      const brief=await io.ask(tr('用几句话说明你的目标和要求: ','Describe your purpose and requirements: ')),l=await language(),p=await provider();
      const request=w.memory.prepareTask(id,'intent-draft',{brief,language:l});show(io,{provider:p.describe(),request});
      if(!await yes(io,tr('发送以上说明进行一次模型整理？可能产生费用','Send the displayed brief for one model call? It may cost money')))return;
      const result=await runMemoryTask(w,request,p,io.signal);show(io,result.run.output);
      if(result.intent&&await yes(io,tr('确认以上意图卡并启用？否则只保留草案','Confirm and activate this intent? Otherwise keep only a draft')))w.memory.confirmIntent(result.intent.id);return;
    }
    if(action!=='manual')return;
    const l=await language();
    const [template]=await menuChoose(io,tr('模板（仅草案，不预设事实或立场）','Template (draft only; no facts or stance)'),['blank','explain','script','current'] as const,x=>({blank:tr('空白','Blank'),explain:tr('说明文','Explanation'),script:tr('视频脚本','Video script'),current:tr('复制当前文章意图','Copy current intent')}[x]));if(!template)return;
    const old=template==='current'?w.memory.activeIntent(id)?.card:null;
    const audience=await io.ask(tr('受众（可留空）: ','Audience (optional): '));
    const purpose=await io.ask(tr('目的（可留空）: ','Purpose (optional): '));
    const thesis=await io.ask(tr('你的主张（不确定就留空）: ','Your thesis (leave empty if undecided): '));
    const rules:WritingRule[]=[...(old?.rules??[])];
    if(template==='explain')rules.push({key:'guidance',value:tr('区分已知信息与推断。','Distinguish established information from inference.'),strength:'preferred'});
    if(template==='script')rules.push({key:'sentence-style',value:tr('适合口头表达。','Suitable for spoken delivery.'),strength:'preferred'});
    while(rules.length<20&&await yes(io,tr('添加一条本篇要求？','Add an article-specific requirement?'))){const r=await rule();if(r)rules.push(r);else break;}
    const claims=w.analysis.list(id).filter(c=>c.annotation==='confirmed'&&c.state==='current');
    let importantOccurrenceIds=old?.importantOccurrenceIds??[];
    if(claims.length&&await yes(io,tr('明确选择必须保留的现有论断？','Select existing important claim occurrences?')))importantOccurrenceIds=(await menuChoose(io,tr('选择重要论断','Important claims'),claims,c=>c.statement,true)).map(c=>c.id);
    const card:IntentCard={language:l,audience:audience||old?.audience||'',purpose:purpose||old?.purpose||'',thesis:thesis||old?.thesis||'',rules,importantOccurrenceIds};
    validateIntentCard(card);show(io,card);if(await yes(io,tr('保存并启用这张意图卡？','Save and activate this intent card?')))w.memory.saveIntent(id,card);
  }
  async function preferences(){const p=await profile();
    const [action]=await menuChoose(io,tr('管理偏好','Preferences'),['list','add','confirm','edit','disable','dismiss','export','import'] as const,x=>({list:tr('查看规则','List rules'),add:tr('明确添加一条规则','Add an explicit rule'),confirm:tr('选择候选／停用规则并启用','Select candidates/disabled rules to activate'),edit:tr('编辑并确认','Edit and confirm'),disable:tr('停用，不删除历史','Disable; retain history'),dismiss:tr('驳回候选','Dismiss candidates'),export:tr('导出档案','Export profile'),import:tr('导入为新档案候选','Import as new profile candidates')}[x]));
    const all=w.memory.preferences(p.id);
    if(action==='list'){show(io,all);return;}
    if(action==='add'||action==='edit'){
      const old=action==='edit'?(await menuChoose(io,tr('选择要纠正的版本','Choose version to correct'),all,x=>`${x.status}: ${x.rule.value}`))[0]:null;if(action==='edit'&&!old)return;
      const r=await rule();if(!r)return;const l=await language();const tasks=await menuChoose(io,tr('适用任务','Applicable tasks'),['revise','review','title'] as const,x=>x,true);if(!tasks.length)return;
      let example=null;if(await yes(io,tr('添加一个最小对照示例？默认不会发送到模型','Add a small contrast example? Not sent to models by default'))){example={before:await io.ask(tr('旧写法: ','Before: ')),after:await io.ask(tr('不喜欢／被拒绝的写法: ','Rejected/undesired after: ')),reason:await io.ask(tr('原因: ','Reason: '))};}
      const input:PreferenceInput={rule:r,language:l,tasks,priority:old?.priority??0,example};validatePreferenceInput(input);show(io,input);
      if(await yes(io,tr('明确保存并启用这条规则？','Explicitly save and activate this rule?'))){if(old)w.memory.correctPreference(old.id,input);else w.memory.addPreference(p.id,input);}return;
    }
    if(action==='confirm'||action==='disable'||action==='dismiss'){
      const items=all.filter(x=>action==='confirm'?['candidate','disabled'].includes(x.status):action==='disable'?x.status==='active':x.status==='candidate');
      const selected=await menuChoose(io,tr('只对选中的编号操作','Act only on the selected numbers'),items,x=>`${x.status} / ${x.language} / ${x.tasks.join(',')}: ${x.rule.value}`,true);if(!selected.length)return;
      show(io,selected);if(await yes(io,tr('对以上选中规则执行操作？停用不会清除历史或远端已发送内容','Apply this action? Disabling does not erase history or remotely sent data')))w.memory.decidePreferences(selected.map(x=>x.id),action==='confirm'?'activate':action==='disable'?'disable':'dismiss');return;
    }
    if(action==='export'){
      let exampleIds:string[]=[];const withExamples=all.filter(x=>x.status==='active'&&x.example);
      if(withExamples.length&&await yes(io,tr('导出私人示例？默认不导出','Export private examples? Default is no')))exampleIds=(await menuChoose(io,tr('选择示例','Choose examples'),withExamples,x=>x.rule.value,true)).map(x=>x.preferenceId);
      const data=w.memory.exportProfile(p.id,exampleIds),path=await io.ask(tr('新导出文件完整路径（不覆盖已有文件）: ','New export path (will not overwrite): '));show(io,data);
      if(await yes(io,tr('导出以上内容？','Export the displayed content?')))exportMemoryJson(path,data);return;
    }
    if(action==='import'){
      const path=await io.ask(tr('要导入的档案 JSON 路径: ','Profile JSON path: ')),data=readMemoryJson(path);validateProfileExport(data);show(io,data);
      if(await yes(io,tr('导入为新档案候选？不会自动启用或关联','Import as a new candidate-only profile? No auto-activation/attachment')))show(io,w.memory.importProfile(data));
    }
  }
  async function selections(task:WritingTask):Promise<{memoryOptions:MemoryOptions;selection:SourceSelection}>{
    const id=await doc(),initial=w.memory.plan(id,task);let memoryOptions:MemoryOptions={};
    if(initial.capture.packet.language==='any'&&!w.memory.activeIntent(id))memoryOptions={language:await language()};
    const p=w.memory.attachedProfile(id),all=p?w.memory.preferences(p.id):[];
    const languageValue=memoryOptions.language??initial.capture.packet.language;
    const active=all.filter(x=>x.status==='active'&&(x.language==='any'||x.language===languageValue)&&x.tasks.includes(task));
    if(active.some(x=>x.example)&&await yes(io,tr('本次允许发送少量私人示例？默认不发送','Authorize some private examples for THIS request? Default no')))memoryOptions={...memoryOptions,examplePreferenceIds:(await menuChoose(io,tr('选择最多三个示例','Choose up to 3 examples'),active.filter(x=>x.example),x=>x.rule.value,true)).map(x=>x.preferenceId)};
    if(await yes(io,tr('给本次请求添加临时例外？不改变档案','Add a one-request exception? It will not change the profile'))){const r=await rule();if(r)memoryOptions={...memoryOptions,exceptions:[r]};}
    let plan=w.memory.plan(id,task,memoryOptions);const requiredConflicts=plan.conflicts.filter(c=>c.reason==='explicit-required-override-needed');
    if(requiredConflicts.length){show(io,requiredConflicts);if(await yes(io,tr('本次明确允许覆盖这些重要规则？','Explicitly allow these required-rule overrides for this request?')))memoryOptions={...memoryOptions,waiveRequiredRefs:[...new Set(requiredConflicts.map(c=>c.refs[0]!))]};plan=w.memory.plan(id,task,memoryOptions);}
    if(plan.conflicts.length){show(io,plan.conflicts);throw new WriterError('GUIDANCE_CONFLICT',tr('请修改冲突规则后重试；没有发送请求。','Resolve the conflicting rules and retry; nothing was sent.'));}
    let selection:SourceSelection={};if(w.sources.list().length&&await yes(io,tr('选择本次提供的来源快照／片段？','Select source snapshots/excerpts for this request?'))){
      const items=w.sources.list().flatMap(x=>{if(!x.latestSnapshotId)return [];const s=w.sources.snapshot(x.latestSnapshotId);return [{kind:'snapshot',id:s.id,label:`${s.metadata.title??x.source.locator} (snapshot)`},...w.sources.excerpts(s.id).map(e=>({kind:'excerpt',id:e.id,label:`${x.source.locator}: ${e.quote.slice(0,160)}`}))];});
      const chosen=await menuChoose(io,tr('最多八项；不选则不发送资料','Up to 8 items; blank sends no sources'),items,x=>x.label,true);selection={snapshots:chosen.filter(x=>x.kind==='snapshot').map(x=>x.id),excerpts:chosen.filter(x=>x.kind==='excerpt').map(x=>x.id)};
    }
    show(io,{writingMemory:plan,sourceSelection:selection});return {memoryOptions,selection};
  }
  async function writing(review=false){const id=await doc(),instruction=await io.ask(tr(review?'审稿要求: ':'改稿要求: ',review?'Review instruction: ':'Editing instruction: '));
    const {memoryOptions,selection}=await selections(review?'review':'revise'),p=await provider();
    if(review){const changes=await menuChoose(io,tr('选择本次审查的待审核修改','Choose pending changes to review'),w.listChanges(id).filter(c=>c.status==='pending'),c=>c.summary,true);if(!changes.length)return;
      const documentScope=await yes(io,tr('检查全文？否则只检查选中段落','Inspect full document? Otherwise selected blocks only'));
      const request=w.analysis.prepare(id,'semantic-review',{instruction,changeIds:changes.map(c=>c.id),documentScope,selection,memoryOptions});show(io,{provider:p.describe(),scope:request.scope,bytes:Buffer.byteLength(JSON.stringify(request)),request});
      if(!await yes(io,tr('发送以上内容审稿一次？可能产生费用，不改正文','Send this content for one review? May cost money; text stays unchanged')))return;
      const result=await runAnalysis(w,request,p,io.signal);show(io,result);return;
    }
    const capture=prepareSuggestion(w,id,instruction,selection,memoryOptions);show(io,{provider:p.describe(),request:capture.request,bytes:Buffer.byteLength(JSON.stringify(capture.request))});
    if(await yes(io,tr('发送以上内容改稿一次？可能产生费用，结果只作为待审核提案','Send this content for one editing call? May cost money; only pending proposals are saved')))show(io,await submitSuggestion(w,capture,p,io.signal));
  }
  async function changes(){const id=await doc(),[c]=await menuChoose(io,tr('选择修改','Select a change'),w.listChanges(id),c=>`${c.status}: ${c.summary}`);if(!c)return;show(io,{before:c.before,after:c.after,summary:c.summary,hints:c.hints,guidance:w.memory.forChange(c.id)});
    const actions=c.status==='pending'?['accept','reject']:c.status==='accepted'?['revert']:[];
    const [a]=await menuChoose(io,tr('选择操作（不等于事实确认）','Action (not factual certification)'),actions,x=>({accept:tr('接受','Accept'),reject:tr('拒绝','Reject'),revert:tr('撤回','Revert')}[x]??x));if(!a)return;
    if(a==='reject'){
      const categories=['meaning','certainty','voice','unnecessary','content','other'] as const;
      const labels={meaning:tr('改变原意','Meaning changed'),certainty:tr('语气太满','Too certain'),voice:tr('不像我的表达','Not my voice'),unnecessary:tr('没必要修改','Unnecessary'),content:tr('内容或依据问题','Content/evidence issue'),other:tr('其他','Other')};
      const [category]=await menuChoose(io,tr('原因可选；0直接跳过，不推断动机','Optional reason; 0 skips without inferring motives'),categories,c=>labels[c]);
      const reason=category?await io.ask(tr('补充理由（可直接回车）: ','Additional reason (optional): ')):'';
      w.reject(c.id,reason,category);io.line(tr('已拒绝；没有自动生成偏好。','Rejected; no preference was inferred.'));return;
    }
    const reason=await io.ask(tr('理由（可留空）: ','Reason (optional): '));if(a==='accept')w.accept(c.id,reason);else w.revert(c.id,reason);io.line(tr('已完成。','Done.'));
  }
  async function distill(){const id=await doc(),p=await profile();const available=w.memory.feedbackChoices(id).filter(d=>d.reason.trim()||d.category);
    const selected=await menuChoose(io,tr('选择有理由的反馈；不自动使用全部历史','Select reasoned feedback, not all history'),available,d=>`${d.category??''} ${d.reason}`,true);if(!selected.length)return;
    let examples:string[]=[];if(await yes(io,tr('本次也发送选中反馈的前后原文？默认只发理由','Also send before/after text this time? Default reasons only')))examples=(await menuChoose(io,tr('明确授权最多三个对照','Authorize up to 3 contrasts'),selected,d=>d.reason||String(d.category),true)).map(d=>d.id);
    const l=await language(),tasks=await menuChoose(io,tr('候选适用任务','Candidate tasks'),['revise','review','title'] as const,x=>x,true);if(!tasks.length)return;
    const brief=await io.ask(tr('整理要求（可留空）: ','Additional distillation brief (optional): '));
    const request=w.memory.prepareTask(id,'preference-draft',{brief,language:l,tasks,profileId:p.id,decisionIds:selected.map(d=>d.id),exampleDecisionIds:examples}),model=await provider();
    show(io,{provider:model.describe(),bytes:Buffer.byteLength(JSON.stringify(request)),request});if(!await yes(io,tr('只发送以上反馈归纳候选一次？不会启用偏好','Send only this feedback for one candidate-drafting call? No auto-activation')))return;
    const result=await runMemoryTask(w,request,model,io.signal);show(io,result.run.output);
    const chosen=await menuChoose(io,tr('选择要确认的候选；留空全部保留为候选','Select candidates to confirm; blank keeps all pending'),result.preferences,x=>x.rule.value,true);
    if(chosen.length&&await yes(io,tr('启用以上选中的候选？','Activate only the selected candidates?')))w.memory.decidePreferences(chosen.map(x=>x.id),'activate');
  }
  io.line(tr('Siglum 写作向导：0返回，q退出。没有默认批准、自动推理或学习。','Siglum writing guide: 0 back, q exit. No default approval, inference or learning.'));
  for(;;){
    const title=documentId?w.getDocument(documentId).title:tr('未选文稿','No document');
    const actions=['document','import','profile','intent','preferences','suggest','review','changes','distill','uses','reports','check','workflow','extensions'] as const;
    const names={extensions:tr('Skill／MCP与研究增强','Skills/MCP and research tools'),workflow:tr('写作任务与恢复（阶段授权）','Writing workflows / resume (stage consent)'),document:tr('选择文稿','Choose document'),import:tr('导入 Markdown 文稿','Import Markdown'),profile:tr('选择／创建档案','Select/create profile'),intent:tr('文章意图卡','Article intent'),preferences:tr('管理／确认偏好','Manage/confirm preferences'),suggest:tr('请求改稿','Request edits'),review:tr('请求语义审稿','Request semantic review'),changes:tr('查看／接受／拒绝／撤回修改','Inspect/accept/reject/revert edits'),distill:tr('主动整理偏好候选','Draft preference candidates'),uses:tr('这次为什么这样写：使用快照','Why it wrote this way: usage history'),reports:tr('查看报告／反馈','Inspect reports / feedback'),check:tr('只运行机械规则检查','Run mechanical checks only')};
    const [action]=await menuChoose(io,`Siglum — ${title}`,actions,x=>names[x]);if(!action)return;
    try{
      if(action==='extensions'){if(w.info().schemaVersion<6)throw new WriterError('MIGRATION_REQUIRED','Use extensions guide to explicitly back up and migrate.');const {runExtensionsGuide}=await import('./extensions-guide.js');await runExtensionsGuide(w,io,lang);}
      else if(action==='workflow'){if(w.info().schemaVersion<5)throw new WriterError('MIGRATION_REQUIRED','Workflow requires schema v5; close this guide and use workflow guide for explicit backed-up migration.');const {runWorkflowGuide}=await import('./workflow-guide.js');await runWorkflowGuide(w,io,lang);}
      else if(action==='document')await pickDocument();else if(action==='profile')await chooseProfile();else if(action==='intent')await intent();else if(action==='preferences')await preferences();
      else if(action==='suggest')await writing();else if(action==='review')await writing(true);else if(action==='changes')await changes();else if(action==='distill')await distill();
      else if(action==='import'){const path=await io.ask(tr('Markdown 文件路径: ','Markdown file path: '));const stat=statSync(path);if(!stat.isFile()||stat.size>2000000)throw new WriterError('INVALID_INPUT','File must be <=2000000 bytes.');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(readFileSync(path));const title=await io.ask(tr('文章标题（留空用文件名）: ','Title (empty uses filename): '));if(await yes(io,tr('将该文件导入为新文稿？','Import as a new document?')))documentId=w.createDocument(title||basename(path),text).id;}
      else if(action==='uses'){const id=await doc(),[u]=await menuChoose(io,tr('使用历史','Usage history'),w.memory.uses(id),u=>`${u.createdAt} ${u.providerId}`);if(u)show(io,w.memory.use(u.id));}
      else if(action==='reports'){const id=await doc(),[run]=await menuChoose(io,tr('审稿记录','Analysis runs'),w.analysis.runs(id),r=>`${r.createdAt} ${r.task}`);if(run){const report=w.analysis.report(run.id);show(io,report);if(report.output.task==='semantic-review'){const [f]=await menuChoose(io,tr('选择要反馈的问题','Choose finding for feedback'),report.output.findings,f=>`${f.category}: ${f.explanation}`);if(f){const [a]=await menuChoose(io,tr('你的判断','Your assessment'),['agree','disagree','needs-review','correct'] as const,x=>x);if(a){const reason=await io.ask(tr('理由: ','Reason: ')),correction=a==='correct'?await io.ask(tr('纠正内容: ','Correction: ')):null;w.analysis.feedback(run.id,f.ref,a,reason,correction);}}}}}
      else if(action==='check'){const id=await doc(),plan=w.memory.plan(id,'revise');show(io,{plan,result:checkWritingRules(renderMarkdown(w.currentRevision(id).snapshot),plan.capture.packet)});}
    }catch(error){if(error instanceof WizardCancelled||io.signal?.aborted)throw new WizardCancelled();io.line(terminalText(error instanceof WriterError||error instanceof ProviderError?`${error.code}: ${error.message}`:'Operation failed; nothing was implicitly approved. Inspect input or use the explicit CLI command for diagnostics.'));}
  }
}
export async function wizardCommand(args:string[]){
  if(args.length!==1&&args.length!==3)throw new WriterError('INVALID_INPUT','Usage: writer guide <workspace> [--lang zh-CN|en]');
  const lang=args[2]??'zh-CN';if(args.length===3&&(args[1]!=='--lang'||!['zh-CN','en'].includes(lang)))throw new WriterError('INVALID_INPUT','Choose --lang zh-CN or en.');
  const terminal=openTerminal();let w:Workspace|undefined;
  try{
    w=Workspace.open(args[0]!);
    if(w.info().schemaVersion<4){const directory=w.root;show(terminal.io,{migration:migrateWorkspace(directory),notice:'Existing manuscript/source rows are preserved; a private backup is retained. Close other sessions.'});
      if(!await yes(terminal.io,lang==='zh-CN'?'明确允许先备份并升级这个工作区？':'Explicitly authorize backup and migration of this workspace?'))return;
      w.close();w=undefined;show(terminal.io,migrateWorkspace(directory,true));w=Workspace.open(directory);
    }
    await runWizard(w,terminal.io,lang as MenuLanguage);
  }catch(error){if(error instanceof WizardCancelled)terminal.io.line('GUIDE_CANCELLED — no implicit send/approval.');else throw error;}
  finally{w?.close();terminal.close();}
}
