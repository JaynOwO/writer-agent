// SPDX-License-Identifier: Apache-2.0
import { Workspace, migrateWorkspace } from '@writer-agent/storage';
import { WriterError, lineCount, validateMcpConnection, validateWorkflowExtensions } from '@writer-agent/core';
import type { WorkflowExtensions, McpConnection, McpSelection, SkillSelection } from '@writer-agent/core';
import type { WizardIO } from './terminal.js';
import { openTerminal, WizardCancelled } from './terminal.js';
import { menuChoose } from './wizard.js';
import { readSkillDirectory } from './skill-import.js';
import { mcpLaunchHash } from './mcp-client.js';
import { discoverMcp } from './extensions-command.js';
import { parseAnalysisJson } from '@writer-agent/models';
const show=(io:WizardIO,v:unknown)=>io.line(JSON.stringify(v,null,2));
async function yes(io:WizardIO,text:string){const a=(await io.ask(text+' [y/N]: ')).trim().toLowerCase();if(a==='q')throw new WizardCancelled();return ['y','yes','是'].includes(a);}
export async function selectWorkflowExtensions(w:Workspace,io:WizardIO,lang:'zh-CN'|'en',newArticle:boolean):Promise<WorkflowExtensions>{
  const tr=(zh:string,en:string)=>lang==='zh-CN'?zh:en;
  const selected=await menuChoose(io,tr('选择已启用 Skill（0 不选，最多3个）','Choose enabled skills (0 none, max3)'),w.extensions.skills().filter(s=>s.enabled),s=>`${s.package.metadata.name}: ${s.package.metadata.description}`,true);
  const skills:SkillSelection[]=[];
  for(const value of selected){
    const refs=value.package.files.filter(f=>f.path!=='SKILL.md');
    const chosen=refs.length?await menuChoose(io,tr('选择要加载的参考文件（0 不选）','Reference files to load (0 none)'),refs,f=>`${f.path} (${lineCount(f.text)} lines)`,true):[];
    const references=[];
    for(const f of chosen){const start=Number((await io.ask(`${f.path} start line [1]: `))||'1'),end=Number((await io.ask(`${f.path} end line [${lineCount(f.text)}]: `))||String(lineCount(f.text)));references.push({path:f.path,startLine:start,endLine:end});}
    skills.push({id:value.id,references});
  }
  const calls:McpSelection[]=[];
  if(newArticle&&await yes(io,tr('为本阶段加入已信任 MCP 的读取／计算调用？','Add read/compute calls from trusted MCP servers?'))){
    const servers=await menuChoose(io,tr('选择服务（没有列表时先到扩展管理连接与发现）','Choose servers (connect/discover in extensions first)'),w.extensions.servers().filter(s=>s.trusted&&w.extensions.latestCatalog(s.id)),s=>s.config.name,true);
    for(const s of servers){
      const c=w.extensions.latestCatalog(s.id)!;
      const descriptors=[...c.catalog.tools.map(t=>({kind:'tool' as const,name:t.name,description:t.description})),...c.catalog.resources.map(r=>({kind:'resource' as const,name:r.uri,description:r.description}))];
      for(const d of await menuChoose(io,tr('选择允许的方法（readOnly 注解不等于安全证明）','Select methods (readOnly annotations are not a safety proof)'),descriptors,d=>`${d.kind} ${d.name}: ${d.description}`,true)){
        show(io,d.kind==='tool'?c.catalog.tools.find(t=>t.name===d.name):c.catalog.resources.find(r=>r.uri===d.name));
        const args=d.kind==='resource'?{}:parseAnalysisJson((await io.ask(tr('参数 JSON（空为 {}；这些确切参数会发送到该服务）: ','Arguments JSON (empty {}; exact parameters go to this service): ')))||'{}');
        const [permission]=await menuChoose(io,tr('你确认的用途（服务声明不是证明）','Author-checked purpose (server claim is not proof)'),['read','compute'] as const,x=>x);
        if(permission)calls.push({serverId:s.id,catalogId:c.id,kind:d.kind,name:d.name,arguments:args as Record<string,unknown>,permission});
      }
    }
  }
  const chapterDrafting=newArticle&&await yes(io,tr('按已确认的大纲逐章生成？每章分别计入模型次数','Draft by approved outline chapters? Each chapter uses a model attempt'));
  const options={skills,calls,chapterDrafting};validateWorkflowExtensions(options);show(io,{selected:w.extensions.capture(options),notice:tr('保存选项不执行；运行阶段还需批准准确摘要。MCP不是系统沙箱。','Saving selections does not execute; approve exact stage preview before running. MCP is not an OS sandbox.')});return options;
}
export async function runExtensionsGuide(w:Workspace,io:WizardIO,lang:'zh-CN'|'en'='zh-CN'){
  const tr=(zh:string,en:string)=>lang==='zh-CN'?zh:en;
  for(;;){
    const actions=['skills','import-skill','register','servers','evidence','citations'] as const;
    const names={skills:tr('查看／启停 Skill','Inspect/enable/disable skills'),'import-skill':tr('导入一个本地 Skill 文件夹','Import a local skill directory'),register:tr('配置 MCP 连接（不自动启动）','Register MCP (does not start)'),servers:tr('信任／撤销／发现 MCP','Trust/revoke/discover MCP'),evidence:tr('在已保存长文中检索证据','Retrieve evidence from saved text'),citations:tr('查看候选／文稿的引用关系','Inspect candidate/manuscript citations')};
    const [action]=await menuChoose(io,tr('Siglum 工具与研究','Siglum tools and research'),actions,x=>names[x]);if(!action)return;
    try{
      if(action==='import-skill'){
        const path=await io.ask(tr('本地 Skill 文件夹完整路径: ','Local skill directory path: '));if(!path.trim())continue;const pkg=readSkillDirectory(path);show(io,pkg);
        if(await yes(io,tr('只导入以上文本？不运行脚本，启用另行决定','Import these texts only? Scripts are not run; enable separately')))show(io,w.extensions.importSkill(pkg));
      }else if(action==='skills'){
        const [s]=await menuChoose(io,tr('选择包版本','Select package version'),w.extensions.skills(),s=>`${s.package.metadata.name} (${s.enabled?'enabled':'disabled'}) ${s.package.hash.slice(0,10)}`);if(!s)continue;show(io,s.package);
        if(await yes(io,s.enabled?tr('停用这个版本？相关任务需重新确认','Disable this version? Affected tasks require refresh'):tr('启用以上文本版本？不授权任何程序或工具','Enable this text version? Does not approve executables/tools')))w.extensions.setSkill(s.id,!s.enabled);
      }else if(action==='register'){
        const [transport]=await menuChoose(io,tr('连接方式','Transport'),['stdio','http'] as const,x=>x);if(!transport)continue;
        const name=await io.ask(tr('服务名称: ','Server label: '));const [protocol]=await menuChoose(io,tr('明确协议版本（不自动降级）','Explicit protocol (no automatic fallback)'),['2026-07-28','2025-11-25'] as const,x=>x);if(!protocol)continue;
        let c:McpConnection;
        if(transport==='stdio'){
          const command=await io.ask(tr('已安装可执行文件的完整路径（不是cmd或npx）: ','Absolute installed executable path (not cmd/npx): '));
          const args=parseAnalysisJson((await io.ask(tr('参数 JSON 数组（例如 ["C:\\\\tools\\\\server.mjs"]）: ','Arguments JSON array (absolute script path recommended): ')))||'[]');
          const cwd=await io.ask(tr('工作文件夹完整路径: ','Absolute working directory: '));
          const env=(await io.ask(tr('明确允许继承的环境变量名（逗号分隔；不是密钥值）: ','Allowed environment NAMES (comma-separated, not key values): '))).split(',').map(s=>s.trim()).filter(Boolean);
          c={name,protocol,transport,command,args:args as string[],cwd,env,timeoutMs:20000};
        }else{
          const url=await io.ask(tr('Streamable HTTP 地址: ','Streamable HTTP URL: '));const tokenEnv=(await io.ask(tr('Bearer token 环境变量名（不认证则空）: ','Bearer token environment NAME (empty unauthenticated): ')))||null;
          const allowRemote=await yes(io,tr('明确允许远端 HTTPS 连接？','Explicitly allow remote HTTPS?'));c={name,protocol,transport,url,tokenEnv,allowRemote,timeoutMs:20000};
        }
        validateMcpConnection(c);const launchHash=await mcpLaunchHash(c);show(io,{config:c,launchHash});if(await yes(io,tr('保存连接？尚不启动／连接，也不授权工具','Save connection? Does not start/connect or approve tools')))show(io,w.extensions.registerServer(c,launchHash));
      }else if(action==='servers'){
        const [s]=await menuChoose(io,tr('选择服务','Choose server'),w.extensions.servers(),s=>`${s.config.name} (${s.trusted?'trusted':'untrusted'})`);if(!s)continue;show(io,s);
        const [op]=await menuChoose(io,tr('操作','Operation'),['trust','revoke','discover','catalog'] as const,x=>({trust:tr('明确信任这个程序／连接','Explicitly trust launch/connection'),revoke:tr('撤销信任','Revoke trust'),discover:tr('启动／连接并发现工具和资源','Start/connect and discover tools/resources'),catalog:tr('查看上次保存的列表，不连接','Inspect saved catalogue without connecting')}[x]));
        if(op==='trust'){const actual=await mcpLaunchHash(s.config);if(actual!==s.launchHash)throw new WriterError('EXTENSION_PERMISSION','Executable changed. Register actual version first.');show(io,{config:s.config,launchHash:actual,warning:tr('本地程序拥有当前用户的文件／网络权限。这里不是系统沙箱；工具用途还需单独核对。','Local program has user file/network privileges. NOT an OS sandbox; tool purposes still need review.')});if(await yes(io,tr('信任并允许之后明确连接这个版本？','Trust this version for subsequent explicit connections?')))w.extensions.setTrust(s.id,true);}
        if(op==='revoke')w.extensions.setTrust(s.id,false);
        if(op==='catalog')show(io,w.extensions.latestCatalog(s.id));
        if(op==='discover'&&await yes(io,tr('现在启动／连接并查询列表？可能访问网络，但不调用工具','Start/connect and list capabilities now? May contact network, but no tool execution')))show(io,await discoverMcp(w,s.id,io.signal));
      }else if(action==='evidence'){
        const [s]=await menuChoose(io,tr('选择来源','Choose source'),w.sources.list(),s=>s.source.locator);if(!s?.latestSnapshotId)continue;
        const q=await io.ask(tr('要找的问题或关键词: ','Question or keywords: '));if(q.trim())show(io,w.extensions.evidence(s.latestSnapshotId,q));
      }else if(action==='citations'){
        const [kind]=await menuChoose(io,tr('查看哪里','Inspect'),['document','candidate'] as const,x=>x);if(kind==='document'){const [d]=await menuChoose(io,tr('文章','Document'),w.listDocuments(),d=>d.title);if(d)show(io,w.extensions.citations(d.id));}
        if(kind==='candidate'){const [r]=await menuChoose(io,tr('任务','Task'),w.workflows.list(),r=>r.config.title);if(r){const [a]=await menuChoose(io,tr('候选','Candidate'),w.workflows.artifacts(r.id).filter(a=>['draft','draft-revision'].includes(a.type)),a=>`${a.type} ${a.createdAt}`);if(a)show(io,w.extensions.citations(a.id));}}
      }
    }catch(e){if(e instanceof WizardCancelled||io.signal?.aborted)throw new WizardCancelled();io.line(e instanceof Error?e.message:'Extension action failed.');}
  }
}
export async function extensionsGuideCommand(args:string[]){
  if(args.length!==1&&!(args.length===3&&args[1]==='--lang'&&['zh-CN','en'].includes(args[2]!)))throw new WriterError('INVALID_INPUT','Usage: siglum extensions guide <workspace> [--lang zh-CN|en]');
  const terminal=openTerminal();let w:Workspace|null=null;
  try{w=Workspace.open(args[0]!);if(w.info().schemaVersion<6){w.close();w=null;show(terminal.io,migrateWorkspace(args[0]!));if(!await yes(terminal.io,'Back up and migrate for extensions? / 备份并升级以启用扩展？'))return;show(terminal.io,migrateWorkspace(args[0]!,true));w=Workspace.open(args[0]!);}await runExtensionsGuide(w,terminal.io,args[2]==='en'?'en':'zh-CN');}
  catch(e){if(e instanceof WizardCancelled)terminal.io.line('Cancelled / 已取消，没有默认批准。');else throw e;}
  finally{w?.close();terminal.close();}
}
