// SPDX-License-Identifier: Apache-2.0
import { createServer, type IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { dirname } from 'node:path';
import { hashBytes, makeSkillPackage } from '@writer-agent/core';
import type { McpConnection, ApprovedMcpCall, McpCatalog } from '@writer-agent/core';
export const { McpClient, mcpLaunchHash }=await import(new URL('../../apps/cli/dist/mcp-client.js',import.meta.url).href) as typeof import('../../apps/cli/src/mcp-client.js');
export const { discoverMcp }=await import(new URL('../../apps/cli/dist/extensions-command.js',import.meta.url).href) as typeof import('../../apps/cli/src/extensions-command.js');
export const {readSkillDirectory}=await import(new URL('../../apps/cli/dist/skill-import.js',import.meta.url).href) as typeof import('../../apps/cli/src/skill-import.js');
export const {runExtensionsGuide,selectWorkflowExtensions}=await import(new URL('../../apps/cli/dist/extensions-guide.js',import.meta.url).href) as typeof import('../../apps/cli/src/extensions-guide.js');
export const fixturePath=fileURLToPath(new URL('../../examples/mcp/fictional-server.mjs',import.meta.url));
export const {responseFor,fictionalText}=await import(new URL('../../examples/mcp/fictional-server.mjs',import.meta.url).href) as {responseFor:(message:Record<string,unknown>,mode?:string)=>unknown;fictionalText:string};
export function skillPackage(name='source-check',body='Preserve limitations and check exact evidence.'){const text=`---\nname: ${name}\ndescription: A synthetic writing skill\nlicense: Apache-2.0\nmetadata:\n  version: "1"\n---\n${body}\n`;return makeSkillPackage(name,[{path:'SKILL.md',text,hash:hashBytes(text)},{path:'references/check.md',text:'Line one\r\nKeep uncertainty 😀\r\nLine three',hash:hashBytes('Line one\r\nKeep uncertainty 😀\r\nLine three')}]);}
export function stdioConfig(mode='normal',protocol:'2026-07-28'|'2025-11-25'='2026-07-28'):McpConnection{return {name:'Test-only installed fixture',transport:'stdio',protocol,command:process.execPath,args:[fixturePath,mode],cwd:dirname(fixturePath),env:[],timeoutMs:5000};}
export function approved(config:McpConnection,launchHash:string,catalog:McpCatalog,resource=false):ApprovedMcpCall{return {serverId:'test-server',catalogId:'test-catalog',kind:resource?'resource':'tool',name:resource?'memory://fiction/reference':'lookup',arguments:resource?{}:{query:'battery endurance'},permission:'read',config,serverHash:launchHash,trustId:'test-trust',descriptor:resource?catalog.resources[0]!:catalog.tools.find(t=>t.name==='lookup')!};}
export async function httpFixture(options:{mode?:string;sse?:boolean;status?:number;mutate?:(result:unknown,message:Record<string,unknown>)=>unknown;raw?:string}={}){
  const calls:{message:Record<string,unknown>;headers:IncomingMessage['headers']}[]=[];
  const server=createServer(async(req,res)=>{
    if(req.method==='DELETE'){res.writeHead(204);res.end();return;}
    let text='';for await(const b of req)text+=String(b);const message=JSON.parse(text) as Record<string,unknown>;calls.push({message,headers:req.headers});
    if(options.status){res.writeHead(options.status,{'Location':'http://127.0.0.1:1/never','Content-Type':'application/json'});res.end('{}');return;}
    if(options.mode==='timeout'&&message.method==='tools/call')return;
    let result=responseFor(message,options.mode);if(result===null){res.writeHead(202);res.end();return;}if(options.mutate)result=options.mutate(result,message);
    const raw=options.raw??JSON.stringify(result);
    const mime=options.sse?'text/event-stream':'application/json';res.writeHead(200,{'Content-Type':mime,'Mcp-Session-Id':'synthetic-session'});
    if(options.sse){res.write(': synthetic heartbeat\r\n\r\n');res.write('event: message\r\ndata: '+raw+'\r\n\r\n');res.end();}else res.end(raw);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('No loopback address');
  const config:McpConnection={name:'Loopback-only test',transport:'http',protocol:'2026-07-28',url:`http://127.0.0.1:${address.port}/mcp`,tokenEnv:null,allowRemote:false,timeoutMs:2000};
  return {server,calls,config,close:async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}
