// SPDX-License-Identifier: Apache-2.0
// Owned, synthetic service implemented with the independent official SERVER library.
// This is SDK-to-SDK interoperability, not a third-party business service certification.
import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {z} from 'zod';
serveStdio(()=>{
const server=new McpServer({name:'siglum-official-sdk-fixture',version:'1.0.0'});
server.registerTool('echo',{description:'Return synthetic input as text.',inputSchema:z.object({text:z.string()})},async({text})=>({content:[{type:'text',text:'SDK fixture: '+text}]}));
server.registerResource('reference','fixture://reference',{mimeType:'text/plain'},async uri=>({contents:[{uri:uri.href,text:'Synthetic reference, not real research.'}]}));
return server;
});
