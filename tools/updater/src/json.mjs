// SPDX-License-Identifier: Apache-2.0
import { insist } from './common.mjs';
/** Bounded JSON parse that rejects duplicate decoded object keys before JSON.parse. */
export function strictJson(input,{bytes=4_000_000,depth=32,nodes=100000}={}){
  const value=Buffer.isBuffer(input)?new TextDecoder('utf-8',{fatal:true}).decode(input):input;
  insist(typeof value==='string'&&Buffer.byteLength(value)<=bytes,'JSON_LIMIT','JSON input exceeds the size limit.');
  let i=0,count=0;
  const ws=()=>{while(i<value.length&&/[\x20\t\r\n]/.test(value[i]))i++;};
  const str=()=>{const start=i;insist(value[i++]==='"','JSON_INVALID','Expected JSON string.');let escaped=false;
    while(i<value.length){const ch=value[i++];if(escaped){escaped=false;continue;}if(ch==='\\'){escaped=true;continue;}if(ch==='"'){try{return JSON.parse(value.slice(start,i));}catch{insist(false,'JSON_INVALID','Invalid JSON string.');}}}
    insist(false,'JSON_INVALID','Unterminated JSON string.');};
  const scan=(level)=>{insist(level<=depth&&++count<=nodes,'JSON_LIMIT','JSON nesting or node budget exceeded.');ws();const ch=value[i];
    if(ch==='{'){i++;ws();const seen=new Set();if(value[i]==='}'){i++;return;}while(true){ws();const key=str();insist(!seen.has(key),'JSON_DUPLICATE','Duplicate JSON field refused.');seen.add(key);ws();insist(value[i++]===':','JSON_INVALID','Missing JSON colon.');scan(level+1);ws();const next=value[i++];if(next==='}')return;insist(next===',','JSON_INVALID','Invalid JSON object.');}}
    if(ch==='['){i++;ws();if(value[i]===']'){i++;return;}while(true){scan(level+1);ws();const next=value[i++];if(next===']')return;insist(next===',','JSON_INVALID','Invalid JSON array.');}}
    if(ch==='"'){str();return;}
    const m=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(value.slice(i));insist(m,'JSON_INVALID','Invalid JSON value.');i+=m[0].length;
  };
  scan(0);ws();insist(i===value.length,'JSON_INVALID','Trailing JSON content.');try{return JSON.parse(value);}catch{insist(false,'JSON_INVALID','Invalid JSON document.');}
}
