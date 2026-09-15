// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspect } from 'node:util';
import { OpenAICompatibleProvider,OllamaProvider } from '@writer-agent/models';
import {request,wire,chatEnvelope,ollamaEnvelope,fakeServer,json} from './provider-helpers.js';

for(const mode of ['json-schema','json','prompt'] as const)test(`Chat Completions ${mode} sends the selected contract and returns validated edits`,async t=>{
  const r=request();const s=await fakeServer(t,(_req,res)=>json(res,chatEnvelope(wire(r))));
  const provider=new OpenAICompatibleProvider({model:'test/model',baseURL:s.base+'/v1',responseFormat:mode});
  const result=await provider.propose(r);assert.equal(result.edits.length,1);assert.equal(s.requests[0]?.path,'/v1/chat/completions');
  const b=s.requests[0]!.body;assert.equal(b.stream,false);assert.equal(b.max_completion_tokens,4096);assert.equal(b.tools,undefined);
  if(mode==='prompt')assert.equal(b.response_format,undefined);
  else assert.equal((b.response_format as {type:string}).type,mode==='json'?'json_object':'json_schema');
  assert.equal(s.requests[0]!.headers.authorization,undefined);
});
test('legacy token option is explicit, with no second request',async t=>{const r=request();const s=await fakeServer(t,(_req,res)=>json(res,chatEnvelope(wire(r))));await new OpenAICompatibleProvider({model:'test',baseURL:s.base,tokenParameter:'max_tokens',maxOutputTokens:500}).propose(r);assert.equal(s.requests[0]!.body.max_tokens,500);assert.equal(s.requests[0]!.body.max_completion_tokens,undefined);assert.equal(s.requests.length,1);});
test('Ollama uses native API, schema format, a bounded generation and no key by default',async t=>{
  const r=request();const s=await fakeServer(t,(_req,res)=>json(res,ollamaEnvelope(wire(r))));
  await new OllamaProvider({model:'test:small',baseURL:s.base}).propose(r);
  const hit=s.requests[0]!;assert.equal(hit.path,'/api/chat');assert.equal(hit.body.stream,false);assert.equal(hit.headers.authorization,undefined);
  assert.equal((hit.body.format as {type:string}).type,'object');assert.equal((hit.body.options as {num_predict:number}).num_predict,4096);
});
for(const [status,code]of [[400,'PROVIDER_HTTP'],[401,'PROVIDER_AUTH'],[403,'PROVIDER_AUTH'],[404,'PROVIDER_HTTP'],[429,'PROVIDER_RATE_LIMIT'],[500,'PROVIDER_HTTP'],[503,'PROVIDER_HTTP']] as const)test(`HTTP ${status} is safe and never automatically retried`,async t=>{
  const s=await fakeServer(t,(_req,res)=>json(res,{error:'PRIVATE_RESPONSE_SECRET'},status));
  const p=new OpenAICompatibleProvider({model:'test',baseURL:s.base});
  await assert.rejects(p.propose(request()),(e:unknown)=>{assert.equal((e as {code:string}).code,code);assert.doesNotMatch(inspect(e),/PRIVATE_RESPONSE_SECRET/);return true;});assert.equal(s.requests.length,1);
});
test('redirect is refused without following it or forwarding credentials',async t=>{
  const target=await fakeServer(t,(_req,res)=>json(res,{}));
  const s=await fakeServer(t,(_req,res)=>{res.writeHead(307,{Location:target.base});res.end();});
  await assert.rejects(new OllamaProvider({model:'test',baseURL:s.base}).propose(request()),{code:'PROVIDER_REDIRECT'});
  assert.equal(target.requests.length,0);
});
test('keys are read only from the configured env at send time, never in settings or errors',async t=>{
  const name='WRITER_UNIT_TEST_SECRET';const original=process.env[name];delete process.env[name];
  t.after(()=>{if(original===undefined)delete process.env[name];else process.env[name]=original;});
  const r=request();const s=await fakeServer(t,(_req,res)=>json(res,chatEnvelope(wire(r))));
  const p=new OpenAICompatibleProvider({model:'test',baseURL:s.base,apiKeyEnv:name});
  assert.doesNotThrow(()=>p.describe());await assert.rejects(p.propose(r),{code:'PROVIDER_AUTH'});assert.equal(s.requests.length,0);
  process.env[name]='synthetic-unit-test-key-NOT-A-REAL-KEY';await p.propose(r);
  assert.equal(s.requests[0]!.headers.authorization,'Bearer '+process.env[name]);
  assert.doesNotMatch(JSON.stringify(p.describe())+inspect(p),/synthetic-unit-test-key/);
  process.env[name]='bad\nheader';await assert.rejects(p.propose(r),{code:'PROVIDER_AUTH'});assert.equal(s.requests.length,1);
});
for(const[url,allow]of [['http://example.invalid',true],['https://example.invalid',false],['http://user:pass@127.0.0.1',false],['http://127.0.0.1?key=secret',false],['http://127.0.0.1#secret',false],['file:///tmp/test',false],['http://127.0.0.1/api/chat',false]] as const)test(`endpoint policy rejects unsafe base ${url.split(/[?#]/)[0]}`,()=>{assert.throws(()=>new OllamaProvider({model:'test',baseURL:url,allowRemote:allow}),{code:'PROVIDER_CONFIG'});});
test('remote HTTPS needs explicit permission; no discovery call is made',()=>{
  const p=new OpenAICompatibleProvider({model:'test',baseURL:'https://example.invalid/v1',allowRemote:true});assert.equal(p.describe().remote,true);assert.equal(p.describe().apiKeyEnv,'WRITER_AGENT_API_KEY');
});
test('localhost is pinned to numeric loopback, including IPv6 loopback support',()=>{
  assert.equal(new OllamaProvider({model:'test',baseURL:'http://localhost:1234'}).describe().endpoint,'http://127.0.0.1:1234/api/chat');
  assert.equal(new OllamaProvider({model:'test',baseURL:'http://[::1]:1234'}).describe().remote,false);
});
test('cloud-tagged local models require explicit permission',()=>{assert.throws(()=>new OllamaProvider({model:'model:cloud'}),{code:'PROVIDER_CONFIG'});});
test('invalid model, byte, deadline, token and environment-name settings fail at configuration',()=>{
  for(const opt of [{model:''},{model:'a\nb'},{model:'x',timeoutMs:0},{model:'x',maxResponseBytes:9e6},{model:'x',maxOutputTokens:0},{model:'x',apiKeyEnv:'sk-secret-key'}])assert.throws(()=>new OllamaProvider(opt),{code:'PROVIDER_CONFIG'});
});
test('invalid protocol output preserves input and is refused by each adapter',async t=>{
  const r=request();const p={...wire(r),baseRevisionId:'wrong'};const s=await fakeServer(t,(req,res)=>json(res,req.path==='/api/chat'?ollamaEnvelope(p):chatEnvelope(p)));
  const before=JSON.stringify(r);for(const Provider of [OllamaProvider,OpenAICompatibleProvider])await assert.rejects(new Provider({model:'test',baseURL:s.base}).propose(r),{code:'PROVIDER_INVALID_PROPOSAL'});assert.equal(JSON.stringify(r),before);
});
for(const[reason,code]of [['length','PROVIDER_TRUNCATED'],['content_filter','PROVIDER_REFUSAL'],['tool_calls','PROVIDER_BAD_RESPONSE']] as const)test(`abnormal finish ${reason} is not accepted`,async t=>{
  const r=request();const e=chatEnvelope(wire(r));e.choices[0]!.finish_reason=reason;const s=await fakeServer(t,(_req,res)=>json(res,e));
  await assert.rejects(new OpenAICompatibleProvider({model:'test',baseURL:s.base}).propose(r),{code});
});
test('explicit refusal is recognized without printing refusal text',async t=>{const s=await fakeServer(t,(_req,res)=>json(res,{choices:[{finish_reason:'stop',message:{role:'assistant',content:null,refusal:'secret refusal'}}]}));await assert.rejects(new OpenAICompatibleProvider({model:'test',baseURL:s.base}).propose(request()),{code:'PROVIDER_REFUSAL'});});
test('tool calls cannot be smuggled alongside an otherwise valid proposal',async t=>{const r=request();const e=chatEnvelope(wire(r));Object.assign(e.choices[0]!.message,{tool_calls:[{function:{name:'shell'}}]});const s=await fakeServer(t,(_req,res)=>json(res,e));await assert.rejects(new OpenAICompatibleProvider({model:'test',baseURL:s.base}).propose(r),{code:'PROVIDER_BAD_RESPONSE'});});
test('Ollama incomplete and truncated envelopes are refused',async t=>{
  let truncated=false;const s=await fakeServer(t,(_req,res)=>json(res,{done:truncated,done_reason:'length',message:{role:'assistant',content:'{}'}}));
  const p=new OllamaProvider({model:'test',baseURL:s.base});await assert.rejects(p.propose(request()),{code:'PROVIDER_BAD_RESPONSE'});truncated=true;await assert.rejects(p.propose(request()),{code:'PROVIDER_TRUNCATED'});
});
test('bad HTTP JSON, invalid UTF-8 and wrong content-type are rejected',async t=>{
  let mode=0;const s=await fakeServer(t,(_req,res)=>{res.writeHead(200,{'content-type':mode===2?'text/html':'application/json'});res.end(mode===0?'{bad':mode===1?Buffer.from([0xff]):'{}');});
  for(mode=0;mode<3;mode++)await assert.rejects(new OllamaProvider({model:'test',baseURL:s.base}).propose(request()),{code:'PROVIDER_BAD_RESPONSE'});
});
test('declared and chunked oversized bodies are bounded',async t=>{
  let declared=true;const s=await fakeServer(t,(_req,res)=>{res.writeHead(200,{'content-type':'application/json',...(declared?{'content-length':'10000'}:{})});res.write('x'.repeat(2048));res.end();});
  for(const value of [true,false]){declared=value;await assert.rejects(new OllamaProvider({model:'test',baseURL:s.base,maxResponseBytes:1024}).propose(request()),{code:'PROVIDER_TOO_LARGE'});}
});
test('timeout covers missing headers and a stalled response body',async t=>{
  let body=false;const s=await fakeServer(t,(_req,res)=>{if(body){res.writeHead(200,{'content-type':'application/json'});res.write('{');}});
  for(const value of [false,true]){body=value;await assert.rejects(new OllamaProvider({model:'test',baseURL:s.base,timeoutMs:100}).propose(request()),{code:'PROVIDER_TIMEOUT'});}
});
test('pre-cancellation sends nothing; active cancellation interrupts body consumption',async t=>{
  const s=await fakeServer(t,(_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{');});
  const p=new OllamaProvider({model:'test',baseURL:s.base});const cancelled=new AbortController();cancelled.abort('private reason');
  await assert.rejects(p.propose(request(),cancelled.signal),{code:'PROVIDER_CANCELLED'});assert.equal(s.requests.length,0);
  const c=new AbortController();const timer=setTimeout(()=>c.abort('private reason'),100);
  try{await assert.rejects(p.propose(request(),c.signal),{code:'PROVIDER_CANCELLED'});}finally{clearTimeout(timer);}
});
test('mid-body connection loss has a sanitized network error',async t=>{const s=await fakeServer(t,(_req,res)=>{res.writeHead(200,{'content-type':'application/json','content-length':'1000'});res.write('{');res.destroy();});await assert.rejects(new OllamaProvider({model:'test',baseURL:s.base}).propose(request()),{code:'PROVIDER_NETWORK'});});
