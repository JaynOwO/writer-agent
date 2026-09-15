// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OllamaProvider,OpenAICompatibleProvider } from '@writer-agent/models';
import type { ModelRequest } from '@writer-agent/models';
import { Workspace } from '@writer-agent/storage';
import { suggestChanges } from './suggest.js';

/** Only a synthetic HTTP service on loopback, never a real inference engine. */
async function main():Promise<void> {
  const root=join(mkdtempSync(join(tmpdir(),'writer-agent-http-demo-')),'workspace');
  const workspace=Workspace.create(root,'Synthetic provider demo');
  const server=createServer((req,res)=>{
    void(async()=>{
      let text='';for await(const part of req){text+=String(part);if(text.length>100000)throw new Error('demo input limit');}
      const body=JSON.parse(text) as {messages:{role:string;content:string}[]};
      const user=body.messages.find(m=>m.role==='user');if(!user)throw new Error('demo fixture');
      const context=JSON.parse(user.content) as {documentId:string;baseRevisionId:string;manuscript:ModelRequest['snapshot']};
      const block=context.manuscript.blocks[0];if(!block)throw new Error('demo fixture');
      const proposal={protocolVersion:1,documentId:context.documentId,baseRevisionId:context.baseRevisionId,
        edits:[{blockId:block.id,before:block.text,after:'这是一段说明。',summary:'预设 HTTP 测试修改，不是 AI 生成'}],notes:['Synthetic response; not real inference.']};
      const message={role:'assistant',content:JSON.stringify(proposal)};
      const response=req.url==='/api/chat'?{done:true,done_reason:'stop',message}:{choices:[{finish_reason:'stop',message}]};
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response));
    })().catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
  });
  try {
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
    const address=server.address();if(!address||typeof address==='string')throw new Error('demo address');
    for(const Provider of [OllamaProvider,OpenAICompatibleProvider]) {
      const original='这是一段很长很长的说明。\n\n证据不足时保留限定。';
      const document=workspace.createDocument('虚构测试稿',original);
      const result=await suggestChanges(workspace,document.id,'缩短说明',new Provider({model:'synthetic-test',baseURL:`http://127.0.0.1:${address.port}`}));
      assert.equal(workspace.markdown(document.id),original);
      assert.equal(workspace.history(document.id).length,1);
      const change=result.changes[0];assert.ok(change);
      workspace.accept(change.id,'Explicit demo-only approval of a known fixture');
      assert.match(workspace.markdown(document.id),/^这是一段说明。/);
      workspace.revert(change.id,'Demo revert');assert.equal(workspace.markdown(document.id),original);
      console.log(`${change.providerId}: HTTP → validation → pending (original unchanged) → explicit accept → revert: OK`);
    }
    console.log(`Synthetic test workspace: ${root}`);
    console.log('PROVIDER_DEMO_OK — fake HTTP only; no real AI or external API was used.');
  } finally {
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));workspace.close();
  }
}
main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:'Provider demo failed.');process.exitCode=1;});
