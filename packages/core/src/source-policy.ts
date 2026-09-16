// SPDX-License-Identifier: Apache-2.0
import { BlockList, isIP } from 'node:net';
import { WriterError } from './errors.js';
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
