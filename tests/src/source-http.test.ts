// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TestContext } from 'node:test';
interface Body {raw:Uint8Array;mediaType:'text/plain'|'text/html'|'text/markdown'}
interface Deps {resolve:(host:string)=>Promise<readonly {address:string;family:number}[]>;transport:(url:URL,a:{address:string;family:4|6},signal:AbortSignal,max:number)=>Promise<Body>}
type Fetcher=(url:string,o?:{signal?:AbortSignal;timeoutMs?:number;maxBytes?:number})=>Promise<Body & {url:string}>;
const {normalizeSourceUrl,isPublicAddress,createSourceFetcher,requestPinned}=await import(new URL('../../apps/cli/dist/source-http.js',import.meta.url).href) as {
  normalizeSourceUrl:(u:string)=>URL;isPublicAddress:(a:string)=>boolean;createSourceFetcher:(d?:Deps)=>Fetcher;
  requestPinned:(u:URL,a:{address:string;family:4|6},s:AbortSignal,n:number)=>Promise<Body>;
};
for(const address of ['0.0.0.0','127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','198.18.0.1','192.0.2.1','224.0.0.1','255.255.255.255','::1','::','::ffff:127.0.0.1','fc00::1','fe80::1','ff02::1','2001:db8::1','2002:7f00:1::','invalid'])test('network policy refuses '+address,()=>assert.equal(isPublicAddress(address),false));
for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888'])test('network policy accepts public fixture '+address,()=>assert.equal(isPublicAddress(address),true));
for(const url of ['file:///secret','ftp://example.org','https://user:secret@example.org/a','https://127.1/a','https://2130706433/','https://0x7f000001/','https://[::ffff:7f00:1]/','https://example.org:444/a','https://localhost/','https://server.local/','https://intranet/','https://example.org\\@other.test/','https://example.org/\nsecret'])test('URL policy refuses '+JSON.stringify(url),()=>assert.throws(()=>normalizeSourceUrl(url),{code:'SOURCE_BLOCKED'}));
test('URL normalization removes only the fragment, retaining identity-significant query data',()=>assert.equal(normalizeSourceUrl('https://EXAMPLE.org:443/report?a=2#section').href,'https://example.org/report?a=2'));
const body:Body={raw:Buffer.from('fixture'),mediaType:'text/plain'};
test('DNS with any private answer is refused before transport, not just its first answer',async()=>{
  let calls=0;const f=createSourceFetcher({resolve:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],transport:async()=>{calls++;return body;}});
  await assert.rejects(f('https://example.org/a'),{code:'SOURCE_BLOCKED'});assert.equal(calls,0);
});
test('DNS is resolved once and the approved address is passed to the transport',async()=>{
  let resolved=0;const f=createSourceFetcher({resolve:async()=>{resolved++;return[{address:resolved===1?'8.8.8.8':'127.0.0.1',family:4}];},transport:async(url,address)=>{assert.equal(url.hostname,'example.org');assert.equal(address.address,'8.8.8.8');return body;}});
  const r=await f('https://example.org/a');assert.equal(r.url,'https://example.org/a');assert.equal(resolved,1);
});
test('DNS timeout does not start a later request',async()=>{
  let calls=0;const f=createSourceFetcher({resolve:()=>new Promise(r=>setTimeout(()=>r([{address:'8.8.8.8',family:4}]),40)),transport:async()=>{calls++;return body;}});
  await assert.rejects(f('https://example.org/',{timeoutMs:5}),{code:'SOURCE_TIMEOUT'});await new Promise(r=>setTimeout(r,60));assert.equal(calls,0);
});
test('pre-cancelled source fetch invokes neither DNS nor transport',async()=>{
  const c=new AbortController();c.abort();let calls=0;const f=createSourceFetcher({resolve:async()=>{calls++;return[];},transport:async()=>{calls++;return body;}});
  await assert.rejects(f('https://example.org/',{signal:c.signal}),{code:'SOURCE_CANCELLED'});assert.equal(calls,0);
});
test('transport stalls obey the same total deadline and sanitize error text',async()=>{
  const f=createSourceFetcher({resolve:async()=>[{address:'8.8.8.8',family:4}],transport:()=>new Promise(()=>{})});
  await assert.rejects(f('https://example.org/',{timeoutMs:5}),{code:'SOURCE_TIMEOUT'});
  const bad=createSourceFetcher({resolve:async()=>{throw new Error('SECRET');},transport:async()=>body});
  await assert.rejects(bad('https://example.org/'),(e:Error)=>!/SECRET/.test(e.message));
});
async function server(t:TestContext,handler:(q:IncomingMessage,s:ServerResponse)=>void) {
  const srv=createServer(handler);await new Promise<void>(r=>srv.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>{srv.closeAllConnections();srv.close(()=>r());}));
  const a=srv.address();assert.ok(a&&typeof a==='object');return {url:new URL(`http://127.0.0.1:${a.port}/fixture`),port:a.port};
}
const local=(u:URL,max=2_000_000,signal=new AbortController().signal)=>requestPinned(u,{address:'127.0.0.1',family:4},signal,max);
test('real HTTP transport reads a synthetic UTF-8 response without credentials/cookies/subrequests',async t=>{
  let requests=0;const s=await server(t,(req,res)=>{requests++;assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.cookie,undefined);assert.equal(req.headers['accept-encoding'],'identity');res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<p>source</p><img src="http://private/">');});
  const result=await local(s.url);assert.equal(result.mediaType,'text/html');assert.match(Buffer.from(result.raw).toString(),/source/);assert.equal(requests,1);
});
test('real pinned lookup connects to selected address while retaining the URL Host header',async t=>{
  const s=await server(t,(req,res)=>{assert.equal(req.headers.host,`pinning.example.org:${s.port}`);res.writeHead(200,{'content-type':'text/plain'});res.end('pinned');});
  const u=new URL(`http://pinning.example.org:${s.port}/`);const r=await local(u);assert.equal(Buffer.from(r.raw).toString(),'pinned');
});
for(const [name,status,headers,expected] of [
  ['redirect',302,{'location':'http://169.254.169.254/'},'SOURCE_REDIRECT'],['HTTP error',403,{},'SOURCE_NETWORK'],
  ['PDF',200,{'content-type':'application/pdf'},'SOURCE_UNSUPPORTED'],['wrong charset',200,{'content-type':'text/html; charset=gbk'},'SOURCE_UNSUPPORTED'],
  ['gzip',200,{'content-type':'text/html','content-encoding':'gzip'},'SOURCE_UNSUPPORTED'],
  ['declared giant body',200,{'content-type':'text/plain','content-length':'999999999'},'SOURCE_TOO_LARGE'],
] as const)test('HTTP response refuses '+name,async t=>{
  const s=await server(t,(_req,res)=>{res.writeHead(status,headers);res.end('never use this');});await assert.rejects(local(s.url),{code:expected});
});
test('streaming byte cap refuses oversized response without content-length',async t=>{
  const s=await server(t,(_q,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.write('x'.repeat(1024));res.end('x'.repeat(1024));});await assert.rejects(local(s.url,1000),{code:'SOURCE_TOO_LARGE'});
});
test('interrupted response cannot become a snapshot',async t=>{
  const s=await server(t,(_q,res)=>{res.writeHead(200,{'content-type':'text/plain','content-length':'1000'});res.write('partial');setTimeout(()=>res.destroy(),10);});await assert.rejects(local(s.url),{code:'SOURCE_NETWORK'});
});
test('cancelled HTTP body releases the request instead of hanging',async t=>{
  const s=await server(t,(_q,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.write('partial');});const c=new AbortController();const p=local(s.url,20000,c.signal);setTimeout(()=>c.abort(),20);await assert.rejects(p,{code:'SOURCE_CANCELLED'});
});
