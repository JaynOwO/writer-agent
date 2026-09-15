// SPDX-License-Identifier: Apache-2.0
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { RequestOptions } from 'node:https';
import type { LookupFunction } from 'node:net';
import { WriterError, MAX_SOURCE_BYTES } from '@writer-agent/core';
import type { SourceMediaType } from '@writer-agent/core';

const denied4 = new BlockList();
for (const [ip,bits] of [ ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
  ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],
  ['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4] ] as const) denied4.addSubnet(ip,bits,'ipv4');
const global6=new BlockList();global6.addSubnet('2000::',3,'ipv6');
const denied6=new BlockList();
for(const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const)denied6.addSubnet(ip,bits,'ipv6');
/** Conservative address policy, not a substitute for host/network egress controls. IPv4-mapped IPv6 is refused. */
export function isPublicAddress(address:string):boolean {
  const family=isIP(address);
  return family===4?!denied4.check(address,'ipv4'):family===6&&global6.check(address,'ipv6')&&!denied6.check(address,'ipv6');
}
export function normalizeSourceUrl(raw:string):URL {
  if(typeof raw!=='string'||raw.length>4096||!raw||/[\\\u0000-\u0020\u007f]/.test(raw))throw new WriterError('SOURCE_BLOCKED','Use an absolute public HTTP(S) URL without credentials, spaces or control characters.');
  let u:URL;try{u=new URL(raw);}catch{throw new WriterError('SOURCE_BLOCKED','Invalid source URL.');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port)throw new WriterError('SOURCE_BLOCKED','Only HTTP(S) on default ports is allowed. Credentials and custom ports are refused.');
  const host=u.hostname.replace(/^\[|\]$/g,'');
  if(isIP(host)) {if(!isPublicAddress(host))throw new WriterError('SOURCE_BLOCKED','Private, local and special-use address refused.');}
  else if(!host.includes('.')||host.endsWith('.')||/(?:^|\.)(?:localhost|local|internal|lan|home|onion)$/.test(host)||!host.split('.').every(part=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)))throw new WriterError('SOURCE_BLOCKED','Local or invalid hostname refused.');
  u.hash='';return u;
}
interface Address {address:string;family:4|6}
export interface SourceHttpResponse {raw:Uint8Array;mediaType:SourceMediaType}
export interface SourceFetchDependencies {
  resolve(host:string):Promise<readonly {address:string;family:number}[]>;
  transport(url:URL,address:Address,signal:AbortSignal,maxBytes:number):Promise<SourceHttpResponse>;
}
/** Internal transport accepts an already approved address. Tests use loopback here, never a CLI bypass flag. */
export function requestPinned(url:URL,address:Address,signal:AbortSignal,maxBytes:number):Promise<SourceHttpResponse> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new WriterError('SOURCE_CANCELLED','Source request cancelled.'));return;}
    let done=false;
    const settle=(error:Error|null,value?:SourceHttpResponse)=>{
      if(done)return;done=true;signal.removeEventListener('abort',cancel);
      if(error)reject(error);else resolve(value!);
    };
    const pinnedLookup:LookupFunction=(_host,options,cb)=>{
      if(options.all) cb(null,[address]);else cb(null,address.address,address.family);
    };
    const options:RequestOptions & {autoSelectFamily:boolean}={method:'GET',agent:false,rejectUnauthorized:true,family:address.family,autoSelectFamily:false,lookup:pinnedLookup,
      maxHeaderSize:16*1024,headers:{'User-Agent':'Siglum/0.0.3 (explicit single-page source capture)','Accept':'text/html, text/plain, text/markdown','Accept-Encoding':'identity'}};
    const start=url.protocol==='https:'?httpsRequest:httpRequest;
    const req=start(url,options,res=>{
      const stop=(error:WriterError)=>{settle(error);res.destroy();req.destroy();};
      const status=res.statusCode??0;
      if(status>=300&&status<400){stop(new WriterError('SOURCE_REDIRECT','Redirect refused. Review the destination yourself and provide its final public URL.'));return;}
      if(status!==200){stop(new WriterError('SOURCE_NETWORK',`Source server returned HTTP ${status}; no source was saved.`));return;}
      const encoding=res.headers['content-encoding'];
      if(encoding&&encoding!=='identity'){stop(new WriterError('SOURCE_UNSUPPORTED','Compressed responses are not supported in this preview. No decompression was attempted.'));return;}
      const type=res.headers['content-type']??'';
      const mediaType=type.split(';')[0]!.trim().toLowerCase();
      if(!['text/html','text/plain','text/markdown'].includes(mediaType)){stop(new WriterError('SOURCE_UNSUPPORTED','Source must be HTML, plain text or Markdown; PDFs and binary files are not supported.'));return;}
      const charset=/charset\s*=\s*["']?([^;"'\s]+)/i.exec(type)?.[1];
      if(charset&&!/^utf-?8$/i.test(charset)){stop(new WriterError('SOURCE_UNSUPPORTED','Only UTF-8 sources are accepted.'));return;}
      const length=res.headers['content-length'];
      if(length&&(!/^\d+$/.test(length)||Number(length)>maxBytes)){stop(new WriterError('SOURCE_TOO_LARGE','Source exceeds the response byte limit.'));return;}
      let size=0;const buffers:Buffer[]=[];
      res.on('data',(chunk:Buffer)=>{
        size+=chunk.length;
        if(size>maxBytes){stop(new WriterError('SOURCE_TOO_LARGE','Source exceeded the streaming byte limit.'));return;}
        buffers.push(chunk);
      });
      res.on('error',()=>settle(new WriterError('SOURCE_NETWORK','Source connection failed while reading.')));
      res.on('end',()=>{
        if(!res.complete||(length!==undefined&&Number(length)!==size)){stop(new WriterError('SOURCE_NETWORK','Source response was incomplete.'));return;}
        settle(null,{raw:Buffer.concat(buffers),mediaType:mediaType as SourceMediaType});
      });
      res.on('close',()=>{if(!res.complete)settle(new WriterError('SOURCE_NETWORK','Source connection closed before a complete response.'));});
    });
    const cancel=()=>{settle(new WriterError('SOURCE_CANCELLED','Source request cancelled.'));req.destroy();};
    req.on('error',()=>settle(new WriterError('SOURCE_NETWORK','Could not retrieve source; check connectivity, TLS and the selected URL.')));
    signal.addEventListener('abort',cancel,{once:true});
    if(signal.aborted)cancel();else req.end();
  });
}
const defaultDependencies:SourceFetchDependencies={
  resolve:host=>dnsLookup(host,{all:true,verbatim:true}),transport:requestPinned,
};
/** Injection is for trusted tests/hosts only; URLs, source text and CLI flags cannot replace these dependencies. */
export function createSourceFetcher(deps:SourceFetchDependencies=defaultDependencies) {
  return async (rawUrl:string,options:{signal?:AbortSignal;timeoutMs?:number;maxBytes?:number}={})=>{
    const url=normalizeSourceUrl(rawUrl),timeout=options.timeoutMs??20000,maxBytes=options.maxBytes??MAX_SOURCE_BYTES;
    if(!Number.isSafeInteger(timeout)||timeout<1||timeout>60000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_SOURCE_BYTES)throw new WriterError('INVALID_INPUT','Invalid source fetch limits.');
    const controller=new AbortController();let timedOut=false;
    const cancel=()=>controller.abort();options.signal?.addEventListener('abort',cancel,{once:true});
    if(options.signal?.aborted)cancel();
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);
    const stopped=()=>new WriterError(timedOut?'SOURCE_TIMEOUT':'SOURCE_CANCELLED',timedOut?'Source fetch deadline exceeded.':'Source fetch cancelled.');
    // The deadline covers DNS as well as headers and body. Late DNS cannot start an HTTP request.
    const bounded=async <T>(promise:Promise<T>):Promise<T>=>{
      if(controller.signal.aborted)throw stopped();
      let listener:()=>void=()=>{};
      try{return await Promise.race([promise,new Promise<never>((_r,reject)=>{listener=()=>reject(stopped());controller.signal.addEventListener('abort',listener,{once:true});})]);}
      finally{controller.signal.removeEventListener('abort',listener);}
    };
    try {
      if(controller.signal.aborted)throw stopped();
      const host=url.hostname.replace(/^\[|\]$/g,''),family=isIP(host);
      const addresses=family?[{address:host,family}]:await bounded(deps.resolve(host));
      if(controller.signal.aborted)throw stopped();
      if(!addresses.length||addresses.length>32||addresses.some(a=>isIP(a.address)!==a.family||!isPublicAddress(a.address)))throw new WriterError('SOURCE_BLOCKED','DNS returned a local, private, invalid or special-use address. No HTTP request sent.');
      const selected=addresses[0]!;
      const result=await bounded(deps.transport(url,{address:selected.address,family:selected.family as 4|6},controller.signal,maxBytes));
      if(controller.signal.aborted)throw stopped();
      if(result.raw.byteLength>maxBytes)throw new WriterError('SOURCE_TOO_LARGE','Source exceeded the byte limit.');
      return {url:url.href,...result};
    }catch(error){
      if(controller.signal.aborted)throw stopped();
      if(error instanceof WriterError)throw error;
      throw new WriterError('SOURCE_NETWORK','Source retrieval failed. No source was saved.');
    }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
  };
}
export const fetchSource = createSourceFetcher();
