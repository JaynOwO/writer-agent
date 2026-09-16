// SPDX-License-Identifier: Apache-2.0
// Synthetic MCP fixture authored for Siglum testing. No external I/O, real evidence or credentials.
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export const fictionalText = [
  '# Fictional laboratory report — synthetic fixture, not real-world research',
  ...Array.from({length:95},(_,i)=>`Background record ${i+1}: routine setup and unrelated observations.\n`),
  '## Battery endurance and limitations',
  'In this fictional experiment, battery endurance increased by 12 percent.',
  'However, only six samples were observed, and no causal conclusion is justified.',
  'A separate fictional repetition found no increase under colder conditions.',
  'These synthetic lines exist only to test citation and retrieval behavior.'
].join('\n');
export function responseFor(message, mode='normal'){
  const modern=message.params?._meta?.['io.modelcontextprotocol/protocolVersion']==='2026-07-28';
  const protocol=modern?'2026-07-28':'2025-11-25';
  const tools=[{name:'lookup',description:'Read synthetic battery research. Returns fixture text only.',inputSchema:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:200,'x-mcp-header':'query'},limit:{type:'integer',minimum:1,maximum:5}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:true,openWorldHint:false}}];
  const resource={uri:'memory://fiction/reference',name:'Fictional reference',description:'Synthetic text, not a network URL.',mimeType:'text/plain'};
  let result;
  switch(message.method){
    case 'server/discover':result={supportedVersions:[protocol],capabilities:{tools:{},resources:{}},_meta:{'io.modelcontextprotocol/serverInfo':{name:'siglum-synthetic-mcp',version:'1.0.0'}},ttlMs:0,cacheScope:'private'};break;
    case 'initialize':result={protocolVersion:protocol,capabilities:{tools:{},resources:{}},serverInfo:{name:'siglum-synthetic-mcp',version:'1.0.0'}};break;
    case 'notifications/initialized':case 'notifications/cancelled':return null;
    case 'tools/list':result={tools:mode==='changed'?tools.map(t=>({...t,description:'CHANGED descriptor'})):tools};
      if(mode==='unsupported-schema')result.tools=[{...tools[0],inputSchema:{type:'object',patternProperties:{'.*':{type:'string'}}}}];
      if(mode==='pagination')result=message.params?.cursor?{tools:[{name:'second',description:'Second read tool',inputSchema:{type:'object',additionalProperties:false}}]}:{tools,nextCursor:'page2'};
      if(mode==='repeat-cursor')result={tools:[],nextCursor:'same'};
      if(mode==='too-many')result={tools:Array.from({length:101},(_,i)=>({...tools[0],name:'tool'+i}))};
      break;
    case 'resources/list':result={resources:[resource]};break;
    case 'tools/call':
      if(mode==='error')return {jsonrpc:'2.0',id:message.id,error:{code:-32602,message:'PRIVATE_REMOTE_ERROR_BODY'}};
      if(mode==='interaction')return {jsonrpc:'2.0',id:message.id,result:{resultType:'input_required',inputRequests:[{method:'sampling/createMessage'}]}};
      result={content:[{type:mode==='binary'?'image':'text',text:mode==='environment'?JSON.stringify({unapproved:process.env.SIGLUM_PRIVATE_TEST_KEY??null,approved:process.env.SIGLUM_APPROVED_TEST_ENV??null}):fictionalText}]};
      if(mode==='tool-error')result.isError=true;
      break;
    case 'resources/read':result={contents:[{uri:resource.uri,mimeType:'text/plain',text:fictionalText}]};break;
    default:return {jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Unknown method'}};
  }
  return {jsonrpc:'2.0',id:message.id,...(mode==='wrong-id'?{id:999999}:{}),result:{...(modern?{resultType:'complete',...(['tools/list','resources/list','resources/read'].includes(message.method)?{ttlMs:0,cacheScope:'private'}:{})}:{}),...result}};
}
function serve(){
  const mode=process.argv[2]??'normal';const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
  rl.on('line',line=>{
    let m;try{m=JSON.parse(line);}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',error:{code:-32700,message:'Malformed JSON'}})+'\n');return;}
    if(mode==='timeout'&&m.method==='tools/call')return;
    if(mode==='exit'&&m.method==='tools/call'){process.exitCode=2;rl.close();process.stdin.destroy();return;}
    if(mode==='callback'&&m.method==='tools/call'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:'server-request',method:'roots/list',params:{}})+'\n');return;}
    if(mode==='oversize'&&m.method==='tools/call'){process.stdout.write('x'.repeat(2_000_100)+'\n');return;}
    const r=responseFor(m,mode);if(!r)return;
    const text=JSON.stringify(r)+'\n';
    if(mode==='fragmented'){const half=Math.floor(text.length/2);process.stdout.write(text.slice(0,half));setTimeout(()=>process.stdout.write(text.slice(half)),2);}else process.stdout.write(text);
  });
  rl.on('close',()=>process.stdin.destroy());
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)serve();
