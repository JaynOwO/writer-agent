// SPDX-License-Identifier: Apache-2.0
import { createServer } from 'node:http';
import type { ServerResponse, IncomingHttpHeaders } from 'node:http';
import type { TestContext } from 'node:test';
import { importMarkdown } from '@writer-agent/core';
import type { ModelRequest } from '@writer-agent/models';
export const request = (text='甲可能成立。\n\n乙。'): ModelRequest => ({documentId:'doc_test',baseRevisionId:'rev_test',snapshot:importMarkdown(text),instruction:'精简，不要增强事实强度。'});
export function wire(r: ModelRequest) {
  const first=r.snapshot.blocks[0];if(!first)throw new Error('fixture');
  return {protocolVersion:1,documentId:r.documentId,baseRevisionId:r.baseRevisionId,
    edits:[{blockId:first.id,before:first.text,after:'甲或许成立。',summary:'测试修改'}],notes:['Synthetic fixture; not actual inference.']};
}
export function chatEnvelope(proposal: unknown) {
  return {choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(proposal)}}]};
}
export function ollamaEnvelope(proposal: unknown) {
  return {done:true,done_reason:'stop',message:{role:'assistant',content:JSON.stringify(proposal)}};
}
export interface CapturedRequest {path:string;headers:IncomingHttpHeaders;body:Record<string,unknown>}
export function requestFromBody(body: Record<string,unknown>): ModelRequest {
  const messages=body.messages as {role:string;content:string}[];
  const user=messages.find(m=>m.role==='user');if(!user)throw new Error('No user message');
  const data=JSON.parse(user.content) as {documentId:string;baseRevisionId:string;instruction:string;manuscript:ModelRequest['snapshot']};
  return {documentId:data.documentId,baseRevisionId:data.baseRevisionId,instruction:data.instruction,snapshot:data.manuscript};
}
export function json(res:ServerResponse,body:unknown,status=200): void {res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));}
export async function fakeServer(t:TestContext,handler:(req:CapturedRequest,res:ServerResponse)=>void|Promise<void>) {
  const requests:CapturedRequest[]=[];
  const server=createServer((req,res)=>{
    void (async()=>{
      const chunks:Buffer[]=[];let size=0;
      for await(const chunk of req) {const b=Buffer.from(chunk as Uint8Array);size+=b.length;if(size>9*1024*1024)throw new Error('fixture limit');chunks.push(b);}
      const captured={path:req.url??'',headers:req.headers,body:JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>};
      requests.push(captured);await handler(captured,res);
    })().catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  t.after(()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));
  const address=server.address();if(!address||typeof address==='string')throw new Error('fixture address');
  return {base:`http://127.0.0.1:${address.port}`,requests,server};
}
