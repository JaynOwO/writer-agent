// SPDX-License-Identifier: Apache-2.0
import { isRecord } from './errors.js';
import { extensionError, boundedExtension } from './extensions.js';

const ANNOTATIONS = new Set(['title','description','default','examples','deprecated','readOnly','writeOnly','$comment','x-mcp-header']);
const KEYWORDS = new Set(['$schema','type','properties','required','additionalProperties','items','prefixItems','minItems','maxItems','uniqueItems','minLength','maxLength','minimum','maximum','exclusiveMinimum','exclusiveMaximum','minProperties','maxProperties','enum','const','anyOf','oneOf','allOf','not','$defs','$ref']);
const TYPES = ['object','array','string','number','integer','boolean','null'];
function refAt(root: unknown, ref: unknown): unknown {
  if (typeof ref !== 'string' || !ref.startsWith('#/$defs/')) extensionError('Only bounded local #/$defs references are supported. No network schema retrieval.');
  let node = root;
  for (const part of ref.slice(2).split('/').map(s=>s.replace(/~1/g,'/').replace(/~0/g,'~'))) { if (!isRecord(node) || !Object.hasOwn(node,part)) extensionError('Unresolved local schema reference.'); node=node[part]; }
  return node;
}
/** Deliberately bounded, documented JSON Schema 2020-12 subset. Unsupported assertions fail closed. */
export function inspectToolSchema(schema: unknown): void {
  boundedExtension(schema, 48000); let nodes=0; const visiting = new Set<unknown>();
  const walk=(s:unknown,depth:number)=>{
    if (++nodes>256 || depth>16) extensionError('Schema complexity limit.');
    if (typeof s==='boolean') return;
    if (!isRecord(s) || visiting.has(s)) extensionError('Invalid/cyclic tool schema.'); visiting.add(s);
    for(const k of Object.keys(s)) if(!KEYWORDS.has(k)&&!ANNOTATIONS.has(k)) extensionError(`Unsupported JSON Schema keyword: ${k}.`);
    if(s.$schema!==undefined&&!['https://json-schema.org/draft/2020-12/schema','https://json-schema.org/draft/2020-12/schema#'].includes(s.$schema as string))extensionError('Unsupported schema dialect.');
    if(s.type!==undefined){const types=Array.isArray(s.type)?s.type:[s.type];if(!types.length||types.some(t=>!TYPES.includes(t as string)))extensionError('Invalid schema type.');}
    for(const k of ['properties','$defs'])if(s[k]!==undefined){if(!isRecord(s[k]))extensionError('Schema properties/definitions need objects.');for(const [name,v]of Object.entries(s[k] as Record<string,unknown>)){if(['__proto__','constructor','prototype'].includes(name))extensionError('Unsafe schema property name.');walk(v,depth+1);}}
    if(s.required!==undefined&&(!Array.isArray(s.required)||s.required.some(n=>typeof n!=='string')||new Set(s.required).size!==s.required.length))extensionError('Invalid required list.');
    for(const k of ['minItems','maxItems','minLength','maxLength','minProperties','maxProperties'])if(s[k]!==undefined&&(!Number.isSafeInteger(s[k])||(s[k] as number)<0))extensionError('Invalid schema nonnegative bound.');
    for(const k of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum'])if(s[k]!==undefined&&(typeof s[k]!=='number'||!Number.isFinite(s[k])))extensionError('Invalid numeric schema bound.');
    if(s.uniqueItems!==undefined&&typeof s.uniqueItems!=='boolean')extensionError('Invalid uniqueItems.');
    if(s.enum!==undefined&&(!Array.isArray(s.enum)||!s.enum.length||s.enum.length>100))extensionError('Invalid enum.');
    for(const k of ['anyOf','oneOf','allOf','prefixItems'])if(s[k]!==undefined){if(!Array.isArray(s[k])||!(s[k] as unknown[]).length)extensionError('Invalid schema composition.');for(const v of s[k] as unknown[])walk(v,depth+1);}
    for(const k of ['items','additionalProperties','not'])if(s[k]!==undefined)walk(s[k],depth+1);
    if(s.$ref!==undefined)walk(refAt(schema,s.$ref),depth+1);
    visiting.delete(s);
  };
  walk(schema,0);
}
function canonical(v:unknown):string { if(Array.isArray(v))return '['+v.map(canonical).join(',')+']'; if(isRecord(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v); }
export function validateToolArguments(schema:unknown,value:unknown):void {
  inspectToolSchema(schema);boundedExtension(value,64000);let visits=0;
  const test=(s:unknown,v:unknown,depth:number):boolean=>{
    if(++visits>10000||depth>24)extensionError('Argument validation complexity limit.');
    if(typeof s==='boolean')return s;
    const r=s as Record<string,unknown>;
    if(r.$ref!==undefined&&!test(refAt(schema,r.$ref),v,depth+1))return false;
    const typeMatches=(t:unknown)=>t==='object'?isRecord(v):t==='array'?Array.isArray(v):t==='null'?v===null:t==='integer'?typeof v==='number'&&Number.isSafeInteger(v):t==='number'?typeof v==='number'&&Number.isFinite(v):typeof v===t;
    if(r.type!==undefined&&!(Array.isArray(r.type)?r.type:[r.type]).some(typeMatches))return false;
    if(r.enum!==undefined&&!(r.enum as unknown[]).some(e=>canonical(e)===canonical(v)))return false;
    if(Object.hasOwn(r,'const')&&canonical(r.const)!==canonical(v))return false;
    if(r.anyOf&&!(r.anyOf as unknown[]).some(e=>test(e,v,depth+1)))return false;
    if(r.oneOf&&(r.oneOf as unknown[]).filter(e=>test(e,v,depth+1)).length!==1)return false;
    if(r.allOf&&!(r.allOf as unknown[]).every(e=>test(e,v,depth+1)))return false;
    if(r.not!==undefined&&test(r.not,v,depth+1))return false;
    if(typeof v==='string'){const length=[...v].length;if(r.minLength!==undefined&&length<(r.minLength as number)||r.maxLength!==undefined&&length>(r.maxLength as number))return false;}
    if(typeof v==='number'){if(r.minimum!==undefined&&v<(r.minimum as number)||r.maximum!==undefined&&v>(r.maximum as number)||r.exclusiveMinimum!==undefined&&v<=(r.exclusiveMinimum as number)||r.exclusiveMaximum!==undefined&&v>=(r.exclusiveMaximum as number))return false;}
    if(Array.isArray(v)){
      if(r.minItems!==undefined&&v.length<(r.minItems as number)||r.maxItems!==undefined&&v.length>(r.maxItems as number))return false;
      if(r.uniqueItems&&new Set(v.map(canonical)).size!==v.length)return false;
      for(let i=0;i<v.length;i++){const item=(r.prefixItems as unknown[]|undefined)?.[i]??r.items;if(item!==undefined&&!test(item,v[i],depth+1))return false;}
    }
    if(isRecord(v)){
      if(r.minProperties!==undefined&&Object.keys(v).length<(r.minProperties as number)||r.maxProperties!==undefined&&Object.keys(v).length>(r.maxProperties as number))return false;
      if((r.required as string[]|undefined)?.some(k=>!Object.hasOwn(v,k)))return false;
      for(const [k,x]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))return false;const p=r.properties as Record<string,unknown>|undefined;const ss=p&&Object.hasOwn(p,k)?p[k]:r.additionalProperties;if(ss!==undefined&&!test(ss,x,depth+1))return false;}
    }
    return true;
  };
  if(!test(schema,value,0))extensionError('Arguments/result do not match the approved schema.');
}
export function headerValue(v:string|number|boolean):string {
  const s=String(v);return !/^[\x20-\x7e]*$/.test(s)||s.trim()!==s||s.startsWith('=?base64?')&&s.endsWith('?=')?`=?base64?${Buffer.from(s).toString('base64')}?=`:s;
}
/** Modern MCP transport header mirroring is limited to statically reachable primitive properties. */
export function toolHeaders(schema:Record<string,unknown>,args:Record<string,unknown>):Record<string,string>{
  const headers:Record<string,string>={};const used=new Set<string>();
  const walk=(s:unknown,v:unknown,reachable:boolean,root=false)=>{
    if(!isRecord(s))return;
    if(s['x-mcp-header']!==undefined){const n=s['x-mcp-header'];if(root||!reachable||typeof n!=='string'||!n||! /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(n)||used.has(n.toLowerCase())||!['integer','string','boolean'].includes(s.type as string))extensionError('Invalid x-mcp-header schema annotation.');used.add(n.toLowerCase());if(v!==undefined&&v!==null){if(!['string','number','boolean'].includes(typeof v)||typeof v==='number'&&!Number.isSafeInteger(v))extensionError('Invalid header parameter.');headers['Mcp-Param-'+n]=headerValue(v as string|number|boolean);}}
    for(const [k,x]of Object.entries(s)){
      if(k==='properties'&&isRecord(x))for(const[n,child]of Object.entries(x))walk(child,isRecord(v)&&Object.hasOwn(v,n)?v[n]:undefined,reachable);
      else if(['items','$defs','anyOf','oneOf','allOf','prefixItems','not','additionalProperties'].includes(k)) {if(Array.isArray(x))for(const child of x)walk(child,undefined,false);else if(k==='$defs'&&isRecord(x))for(const child of Object.values(x))walk(child,undefined,false);else walk(x,undefined,false);}
    }
  };walk(schema,args,true,true);return headers;
}
