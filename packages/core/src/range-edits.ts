// SPDX-License-Identifier: Apache-2.0
import { WriterError, requireString } from './errors.js';
import { validateText, validateSnapshot } from './document.js';
import { hashBytes } from './sources.js';
import type { Snapshot, TextBlock } from './types.js';

export const RANGE_ALGORITHM = 'word-lcs-ranges-v1';
export const RANGE_LIMIT = 200;
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
const words = new Intl.Segmenter('und', { granularity: 'word' });
export interface TextSplice { readonly start:number; readonly end:number; readonly before:string; readonly after:string }
export interface ProposedRange extends TextSplice {
  readonly blockId:string;
  readonly summary:string;
  /** Indices of other candidates in this same immutable set. */
  readonly dependsOn:readonly number[];
  /** Nonempty group labels make a group atomic. null means independent. */
  readonly group:string|null;
}
export interface RangeOperation extends TextSplice {
  readonly id:string; readonly setId:string; readonly documentId:string;
  readonly baseRevisionId:string; readonly blockId:string; readonly baseBlockVersion:number;
  readonly summary:string; readonly dependsOn:readonly string[]; readonly group:string|null;
  readonly providerId:string; readonly status:'pending'|'accepted'|'rejected'|'reverted';
  readonly acceptedRevisionId:string|null; readonly acceptedStart:number|null;
  readonly createdAt:string;
}
export interface RangeSet {
  readonly id:string; readonly documentId:string; readonly baseRevisionId:string;
  readonly sourceChangeId:string|null; readonly algorithm:string; readonly providerId:string;
  readonly createdAt:string;
}
export interface JournalSplice extends TextSplice { readonly operationId:string|null }
export interface BlockJournal {
  readonly blockId:string; readonly beforeVersion:number; readonly afterVersion:number;
  readonly beforeHash:string; readonly afterHash:string; readonly splices:readonly JournalSplice[];
}
export interface ContentJournal {
  readonly revisionId:string; readonly documentId:string; readonly parentId:string;
  readonly kind:'range-accepted'|'range-reverted'|'manual-edited';
  readonly blocks:readonly BlockJournal[]; readonly createdAt:string;
}
export function graphemeBoundaries(text:string):Set<number>{
  validateText(text);const result=new Set<number>([0,text.length]);for(const seg of graphemes.segment(text))result.add(seg.index);return result;
}
export function assertSplice(text:string,edit:TextSplice,boundaries=graphemeBoundaries(text)):void{
  validateText(edit.before,'original range');validateText(edit.after,'replacement range');
  if(!Number.isSafeInteger(edit.start)||!Number.isSafeInteger(edit.end)||edit.start<0||edit.end<edit.start||edit.end>text.length||!boundaries.has(edit.start)||!boundaries.has(edit.end)||text.slice(edit.start,edit.end)!==edit.before||edit.before===edit.after)
    throw new WriterError('CHANGE_CONFLICT','Range, exact original text or grapheme boundaries do not match.');
}
export function assertIndependent(edits:readonly TextSplice[]):void{
  const sorted=[...edits].sort((a,b)=>a.start-b.start||a.end-b.end);
  for(let i=1;i<sorted.length;i++){
    const a=sorted[i-1]!,b=sorted[i]!;
    if(a.end>b.start||(a.start===a.end&&a.start===b.start)||(b.start===b.end&&b.start===a.end))
      throw new WriterError('CHANGE_CONFLICT','Overlapping edits or shared insertion boundaries require a new combined proposal.');
  }
}
export function applySplices(text:string,edits:readonly TextSplice[]):{text:string;starts:readonly number[]}{
  if(!edits.length||edits.length>RANGE_LIMIT)throw new WriterError('INVALID_INPUT','Choose between 1 and 200 range operations.');
  const boundaries=graphemeBoundaries(text);for(const e of edits)assertSplice(text,e,boundaries);assertIndependent(edits);
  const sorted=edits.map((edit,index)=>({edit,index})).sort((a,b)=>a.edit.start-b.edit.start),starts=new Array<number>(edits.length);let result='',cursor=0;
  for(const {edit:e,index}of sorted){result+=text.slice(cursor,e.start);starts[index]=result.length;result+=e.after;cursor=e.end;}
  result+=text.slice(cursor);validateText(result);const next=graphemeBoundaries(result);
  for(let i=0;i<edits.length;i++)if(!next.has(starts[i]!)||!next.has(starts[i]!+edits[i]!.after.length))throw new WriterError('CHANGE_CONFLICT','The replacement would merge across a grapheme boundary. Submit a complete character-cluster replacement.');
  return {text:result,starts};
}
/** Map ONLY through a certified, complete edit chain. Never searches for a repeated phrase. */
export function mapRange(range:{start:number;end:number},edits:readonly TextSplice[]):{start:number;end:number}{
  assertIndependent(edits);let shift=0;const {start:s,end:e}=range;if(s<0||e<s)throw new WriterError('CORRUPT_DATA','Invalid stored range.');
  for(const x of [...edits].sort((a,b)=>a.start-b.start)){
    const insertion=x.start===x.end,point=s===e;
    if(insertion){
      if((point&&x.start===s)||(!point&&x.start>s&&x.start<e))throw new WriterError('CHANGE_CONFLICT','Later editing touched this operation. Review dependencies rather than overwriting newer text.');
      // Start leans right; end leans left. Same-position insertions are explicitly exclusive.
      if(x.start<=s)shift+=x.after.length;
    }else{
      if((point&&x.start<s&&x.end>s)||(!point&&x.start<e&&x.end>s))throw new WriterError('CHANGE_CONFLICT','A later edit overlaps the selected range.');
      if(x.end<=s)shift+=x.after.length-(x.end-x.start);
    }
  }
  return {start:s+shift,end:e+shift};
}
export function validateRanges(value:readonly ProposedRange[],snapshot:Snapshot):void{
  validateSnapshot(snapshot);if(!Array.isArray(value)||value.length<1||value.length>RANGE_LIMIT||Buffer.byteLength(JSON.stringify(value),'utf8')>6_000_000)throw new WriterError('INVALID_INPUT','Invalid range candidate count.');
  const grouped=new Map<string,ProposedRange[]>();
  for(let i=0;i<value.length;i++){
    const e=value[i]!;requireString(e.blockId,'block ID',200);requireString(e.summary,'range summary',1000);
    const block=snapshot.blocks.find(b=>b.id===e.blockId);if(!block)throw new WriterError('CHANGE_CONFLICT','Unknown target block.');assertSplice(block.text,e);
    if(e.group!==null)requireString(e.group,'atomic group',100);
    if(!Array.isArray(e.dependsOn)||new Set(e.dependsOn).size!==e.dependsOn.length||e.dependsOn.some((n:number)=>!Number.isSafeInteger(n)||n<0||n>=value.length||n===i))throw new WriterError('INVALID_INPUT','Invalid dependency references.');
    const list=grouped.get(e.blockId)||[];list.push(e);grouped.set(e.blockId,list);
  }
  for(const list of grouped.values())assertIndependent(list);
  const visiting=new Set<number>(),visited=new Set<number>();
  const visit=(n:number)=>{if(visiting.has(n))throw new WriterError('INVALID_INPUT','Range dependency cycle.');if(visited.has(n))return;visiting.add(n);for(const d of value[n]!.dependsOn)visit(d);visiting.delete(n);visited.add(n);};
  value.forEach((_,i)=>visit(i));
}
/** Deterministic bounded token diff; a coarse fallback is explicit, never unsafe. */
export function rangeDiff(before:string,after:string,cellBudget=500_000):{algorithm:string;coarse:boolean;splices:readonly TextSplice[]}{
  validateText(before);validateText(after);if(before===after)return {algorithm:RANGE_ALGORITHM,coarse:false,splices:[]};
  const gb=graphemeBoundaries(before),ga=graphemeBoundaries(after);
  let prefix=0;while(prefix<before.length&&prefix<after.length&&before[prefix]===after[prefix])prefix++;
  while(prefix>0&&(!gb.has(prefix)||!ga.has(prefix)))prefix--;
  let suffix=0;while(suffix<before.length-prefix&&suffix<after.length-prefix&&before[before.length-suffix-1]===after[after.length-suffix-1])suffix++;
  while(suffix>0&&(!gb.has(before.length-suffix)||!ga.has(after.length-suffix)))suffix--;
  const coarse=()=>({algorithm:RANGE_ALGORITHM+'-coarse',coarse:true,splices:[{start:prefix,end:before.length-suffix,before:before.slice(prefix,before.length-suffix),after:after.slice(prefix,after.length-suffix)}]});
  const tokenize=(s:string)=>{const out:{text:string;start:number;end:number}[]=[];for(const x of words.segment(s)){out.push({text:x.segment,start:x.index,end:x.index+x.segment.length});if(out.length>4000)return null;}return out;};
  const a=tokenize(before.slice(prefix,before.length-suffix)),b=tokenize(after.slice(prefix,after.length-suffix));
  if(!a||!b||(a.length+1)*(b.length+1)>cellBudget)return coarse();
  const rows=a.length+1,cols=b.length+1,dp=new Uint32Array(rows*cols);
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i*cols+j]=a[i]!.text===b[j]!.text?1+dp[(i+1)*cols+j+1]!:Math.max(dp[(i+1)*cols+j]!,dp[i*cols+j+1]!);
  const out:TextSplice[]=[];let i=0,j=0,open:{s:number;t:number}|null=null;
  const at=(xs:typeof a,n:number,total:number)=>n<xs.length?xs[n]!.start:total;
  const flush=()=>{if(!open)return;const s=at(a,open.s,before.length-prefix-suffix),e=at(a,i,before.length-prefix-suffix),u=at(b,open.t,after.length-prefix-suffix),v=at(b,j,after.length-prefix-suffix);out.push({start:prefix+s,end:prefix+e,before:before.slice(prefix+s,prefix+e),after:after.slice(prefix+u,prefix+v)});open=null;};
  while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]!.text===b[j]!.text){flush();i++;j++;}else{open??={s:i,t:j};if(j===b.length||(i<a.length&&dp[(i+1)*cols+j]!>=dp[i*cols+j+1]!))i++;else j++;}}
  flush();if(out.length>RANGE_LIMIT)return coarse();
  try{if(applySplices(before,out).text!==after)return coarse();}catch{return coarse();}
  return {algorithm:RANGE_ALGORITHM,coarse:false,splices:out};
}
export function projectedBlock(block:TextBlock,edits:readonly TextSplice[]):TextBlock{
  const result=applySplices(block.text,edits);return {...block,text:result.text,version:block.version+1};
}
export function verifyBlockJournal(before:TextBlock,after:TextBlock,journal:BlockJournal):void{
  if(journal.blockId!==before.id||after.id!==before.id||journal.beforeVersion!==before.version||journal.afterVersion!==after.version||after.version!==before.version+1||journal.beforeHash!==hashBytes(before.text)||journal.afterHash!==hashBytes(after.text)||before.separator!==after.separator)
    throw new WriterError('CORRUPT_DATA','Content journal version/hash mismatch.');
  if(applySplices(before.text,journal.splices).text!==after.text)throw new WriterError('CORRUPT_DATA','Content journal does not reproduce the saved revision.');
}
