// SPDX-License-Identifier: Apache-2.0
import type { DatabaseSync } from 'node:sqlite';
import {
  WriterError,newId,requireString,validateText,validateSnapshot,hashBytes,
  validateRanges,rangeDiff,applySplices,mapRange,assertIndependent,graphemeBoundaries,verifyBlockJournal,
} from '@writer-agent/core';
import type { Revision,Snapshot,Change,ProposedRange,RangeOperation,RangeSet,ContentJournal,BlockJournal,TextSplice } from '@writer-agent/core';
interface Host {currentRevision(id:string):Revision;getRevision(id:string):Revision;getChange(id:string):Change;history(id:string):Revision[]}
export interface EditingBuffer {id:string;documentId:string;baseRevisionId:string;version:number;blocks:readonly {blockId:string;text:string}[];updatedAt:string}
export interface RangeDecision {sequence:number;operationId:string;documentId:string;revisionId:string;action:'accepted'|'rejected'|'reverted';reason:string;createdAt:string}
const now=()=>new Date().toISOString();
function unpack<T>(row:Record<string,unknown>|undefined):T{
  if(!row)throw new WriterError('NOT_FOUND','Range record not found.');
  if(typeof row.payload!=='string'||typeof row.payload_hash!=='string'||hashBytes(row.payload)!==row.payload_hash)throw new WriterError('CORRUPT_DATA','Range record integrity mismatch.');
  try{return JSON.parse(row.payload) as T;}catch{throw new WriterError('CORRUPT_DATA','Invalid range record JSON.');}
}
function reasonCheck(reason:string){validateText(reason);if(reason.length>4000)throw new WriterError('INVALID_INPUT','Reason is too long.');}
export class RangeEditor {
  constructor(private readonly db:DatabaseSync,private readonly ready:()=>void,private readonly transaction:<T>(fn:()=>T)=>T,private readonly host:Host){}
  private insert(table:'range_sets'|'content_journals',data:unknown,columns:Record<string,string|null>):void{
    const payload=JSON.stringify(data),keys=[...Object.keys(columns),'payload','payload_hash'];this.db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(columns),payload,hashBytes(payload));
  }
  journal(revisionId:string):ContentJournal|null{
    this.ready();const row=this.db.prepare('SELECT payload,payload_hash FROM content_journals WHERE revision_id=?').get(revisionId);return row?unpack<ContentJournal>(row):null;
  }
  set(id:string):RangeSet{this.ready();requireString(id,'set ID',200);const set=unpack<RangeSet>(this.db.prepare('SELECT payload,payload_hash FROM range_sets WHERE id=?').get(id));if(set.id!==id)throw new WriterError('CORRUPT_DATA','Set identity mismatch.');return set;}
  forChange(changeId:string):RangeSet|null{this.ready();const row=this.db.prepare('SELECT payload,payload_hash FROM range_sets WHERE source_change_id=?').get(changeId);return row?unpack<RangeSet>(row):null;}
  operation(id:string):RangeOperation{
    this.ready();requireString(id,'operation ID',200);const row=this.db.prepare('SELECT * FROM range_operations WHERE id=?').get(id),op=unpack<RangeOperation>(row);
    if(op.id!==id||op.status!==row!.status||op.setId!==row!.set_id||op.documentId!==row!.document_id)throw new WriterError('CORRUPT_DATA','Operation identity/status mismatch.');
    const base=this.host.getRevision(op.baseRevisionId),b=base.snapshot.blocks.find(b=>b.id===op.blockId);
    if(!b||base.documentId!==op.documentId||b.version!==op.baseBlockVersion||b.text.slice(op.start,op.end)!==op.before)throw new WriterError('CORRUPT_DATA','Operation baseline mismatch.');return op;
  }
  list(documentId:string):RangeOperation[]{this.ready();this.host.currentRevision(documentId);const rows=this.db.prepare('SELECT id FROM range_operations WHERE document_id=? ORDER BY seq LIMIT 4001').all(documentId);if(rows.length>4000)throw new WriterError('INVALID_INPUT','Range history list exceeds 4000 items.');return rows.map(r=>this.operation(String(r.id)));}
  decisions(documentId:string):RangeDecision[]{this.ready();this.host.currentRevision(documentId);return this.db.prepare('SELECT * FROM range_decisions WHERE document_id=? ORDER BY seq').all(documentId).map(r=>({sequence:Number(r.seq),operationId:String(r.operation_id),documentId:String(r.document_id),revisionId:String(r.revision_id),action:r.action as RangeDecision['action'],reason:String(r.reason),createdAt:String(r.created_at)}));}
  create(documentId:string,baseRevisionId:string,proposals:readonly ProposedRange[],providerId='manual',options:{sourceChangeId?:string;algorithm?:string}={}):RangeSet{
    this.ready();requireString(providerId,'provider',200);
    return this.transaction(()=>{
      const current=this.host.currentRevision(documentId);if(current.id!==baseRevisionId)throw new WriterError('STALE_REVISION','The article changed before these range proposals were saved.');validateRanges(proposals,current.snapshot);
      if(options.sourceChangeId){const source=this.host.getChange(options.sourceChangeId);if(source.documentId!==documentId||source.status!=='pending')throw new WriterError('INVALID_TRANSITION','Only a pending proposal from this article can be split.');if(this.forChange(source.id))throw new WriterError('ALREADY_EXISTS','This proposal has already been split.');}
      const set:RangeSet={id:newId('rset'),documentId,baseRevisionId,sourceChangeId:options.sourceChangeId??null,algorithm:options.algorithm??'author-selected-ranges-v1',providerId,createdAt:now()};
      this.insert('range_sets',set,{id:set.id,document_id:documentId,base_revision_id:baseRevisionId,source_change_id:set.sourceChangeId});
      const ids=proposals.map(()=>newId('rop'));
      proposals.forEach((e,i)=>{const op:RangeOperation={id:ids[i]!,setId:set.id,documentId,baseRevisionId,blockId:e.blockId,baseBlockVersion:current.snapshot.blocks.find(b=>b.id===e.blockId)!.version,start:e.start,end:e.end,before:e.before,after:e.after,summary:e.summary,dependsOn:e.dependsOn.map(n=>ids[n]!),group:e.group,providerId,status:'pending',acceptedRevisionId:null,acceptedStart:null,createdAt:now()};const payload=JSON.stringify(op);this.db.prepare('INSERT INTO range_operations(id,set_id,document_id,status,payload,payload_hash) VALUES(?,?,?,?,?,?)').run(op.id,op.setId,documentId,op.status,payload,hashBytes(payload));});
      return set;
    });
  }
  splitChange(changeId:string,expectedHead:string):{set:RangeSet;operations:readonly RangeOperation[];coarse:boolean}{
    this.ready();return this.transaction(()=>{
      const c=this.host.getChange(changeId),current=this.host.currentRevision(c.documentId);if(current.id!==expectedHead)throw new WriterError('STALE_REVISION','Refresh the article before splitting this proposal.');
      const existing=this.forChange(changeId);if(existing)return {set:existing,operations:this.list(c.documentId).filter(o=>o.setId===existing.id),coarse:existing.algorithm.endsWith('-coarse')};
      const b=current.snapshot.blocks.find(b=>b.id===c.blockId);if(c.status!=='pending'||!b||b.version!==c.baseBlockVersion||b.text!==c.before)throw new WriterError('CHANGE_CONFLICT','The original proposal is no longer applicable to this block.');
      const d=rangeDiff(c.before,c.after),proposals=d.splices.map(s=>({...s,blockId:c.blockId,summary:c.summary,dependsOn:[],group:null}));
      const set=this.create(c.documentId,current.id,proposals,c.providerId,{sourceChangeId:c.id,algorithm:d.algorithm});return {set,operations:this.list(c.documentId).filter(o=>o.setId===set.id),coarse:d.coarse};
    });
  }
  /** Resolve against verified history, stopping on legacy/unrecorded edits in the target block. */
  resolve(op:RangeOperation,current:Revision,reverting=false):TextSplice{
    const startRevision=reverting?op.acceptedRevisionId:op.baseRevisionId;
    if(!startRevision||(reverting&&op.acceptedStart===null))throw new WriterError('CORRUPT_DATA','Missing accepted coordinates.');
    const start=reverting?op.acceptedStart!:op.start,original=reverting?op.after:op.before,replacement=reverting?op.before:op.after;
    let range={start,end:start+original.length};const history=this.host.history(op.documentId),from=history.findIndex(r=>r.id===startRevision),to=history.findIndex(r=>r.id===current.id);
    if(from<0||to<from||to-from>10000)throw new WriterError('CHANGE_CONFLICT','The required edit history is unavailable or too large.');
    for(let i=from+1;i<=to;i++){
      const prev=history[i-1]!,next=history[i]!;if(next.parentId!==prev.id)throw new WriterError('CORRUPT_DATA','Non-contiguous content history.');
      const b=prev.snapshot.blocks.find(b=>b.id===op.blockId),a=next.snapshot.blocks.find(b=>b.id===op.blockId);if(!b||!a)throw new WriterError('CHANGE_CONFLICT','Block structure changed.');
      if(b.version===a.version&&b.text===a.text&&b.separator===a.separator)continue;
      const journal=this.journal(next.id),entry=journal?.blocks.find(x=>x.blockId===op.blockId);
      if(!journal||journal.documentId!==op.documentId||journal.parentId!==prev.id||!entry)throw new WriterError('CHANGE_CONFLICT','A block-level or unrecorded edit interrupts safe range mapping. Re-propose against the current text.');
      verifyBlockJournal(b,a,entry);range=mapRange(range,entry.splices);
    }
    const block=current.snapshot.blocks.find(b=>b.id===op.blockId),bounds=block&&graphemeBoundaries(block.text);
    if(!block||block.text.slice(range.start,range.end)!==original||!bounds?.has(range.start)||!bounds.has(range.end))throw new WriterError('CHANGE_CONFLICT','The mapped range no longer contains the exact original graphemes.');
    return {...range,before:original,after:replacement};
  }
  preview(id:string){const op=this.operation(id),current=this.host.currentRevision(op.documentId);try{const edit=this.resolve(op,current,op.status==='accepted');return {operation:op,headRevisionId:current.id,resolved:edit,conflict:null};}catch(e){if(e instanceof WriterError&&e.code==='CHANGE_CONFLICT')return {operation:op,headRevisionId:current.id,resolved:null,conflict:e.message};throw e;}}
  private writeOperation(op:RangeOperation){const payload=JSON.stringify(op);this.db.prepare('UPDATE range_operations SET status=?,payload=?,payload_hash=? WHERE id=?').run(op.status,payload,hashBytes(payload),op.id);}
  private commit(current:Revision,snapshot:Snapshot,journals:readonly BlockJournal[],kind:ContentJournal['kind'],changeId:string|null):Revision{
    validateSnapshot(snapshot);const id=newId('rev'),createdAt=now(),legacy=kind==='range-reverted'?'reverted':'accepted';
    // Preserve the original revisions table; the companion journal is the authoritative new action kind.
    this.db.prepare('INSERT INTO revisions(id,document_id,parent_id,kind,change_id,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?)').run(id,current.documentId,current.id,legacy,changeId,JSON.stringify(snapshot),createdAt);
    const journal:ContentJournal={revisionId:id,documentId:current.documentId,parentId:current.id,kind,blocks:journals,createdAt};
    this.insert('content_journals',journal,{revision_id:id,document_id:current.documentId});
    if(this.db.prepare('UPDATE documents SET head_revision_id=? WHERE id=? AND head_revision_id=?').run(id,current.documentId,current.id).changes!==1)throw new WriterError('STALE_REVISION','Document head changed; no partial edit was saved.');
    return this.host.getRevision(id);
  }
  decide(documentId:string,ids:readonly string[],action:'accept'|'reject'|'revert',expectedHead:string,reason=''):Revision{
    this.ready();reasonCheck(reason);if(!Array.isArray(ids)||!ids.length||ids.length>200||new Set(ids).size!==ids.length||!['accept','reject','revert'].includes(action))throw new WriterError('INVALID_INPUT','Invalid range decision.');
    return this.transaction(()=>{
      const current=this.host.currentRevision(documentId);if(current.id!==expectedHead)throw new WriterError('STALE_REVISION','Refresh before applying this decision.');
      const all=this.list(documentId),ops=ids.map(id=>this.operation(id)),selected=new Set(ids);
      for(const o of ops){if(o.documentId!==documentId||o.status!==(action==='revert'?'accepted':'pending'))throw new WriterError('INVALID_TRANSITION','Only matching pending/accepted operations can be decided.');
        if(o.group&&all.some(x=>x.setId===o.setId&&x.group===o.group&&x.status===o.status&&!selected.has(x.id)))throw new WriterError('CHANGE_CONFLICT','Select every member of this atomic group.');
        if(action==='accept'&&o.dependsOn.some(id=>!selected.has(id)&&this.operation(id).status!=='accepted'))throw new WriterError('CHANGE_CONFLICT','Accept the required dependent operations together or first.');
        if(action==='revert'&&all.some(x=>x.status==='accepted'&&x.dependsOn.includes(o.id)&&!selected.has(x.id)))throw new WriterError('CHANGE_CONFLICT','A later accepted operation depends on this one. Revert it first or select the dependency group.');
      }
      let revision=current;const starts=new Map<string,number>();
      if(action!=='reject'){
        const byBlock=new Map<string,{op:RangeOperation;edit:TextSplice}[]>();for(const op of ops){const list=byBlock.get(op.blockId)||[];list.push({op,edit:this.resolve(op,current,action==='revert')});byBlock.set(op.blockId,list);}
        const journals:BlockJournal[]=[];
        const blocks=current.snapshot.blocks.map(b=>{const edits=byBlock.get(b.id);if(!edits)return {...b};assertIndependent(edits.map(x=>x.edit));const result=applySplices(b.text,edits.map(x=>x.edit));edits.forEach((x,i)=>starts.set(x.op.id,result.starts[i]!));journals.push({blockId:b.id,beforeVersion:b.version,afterVersion:b.version+1,beforeHash:hashBytes(b.text),afterHash:hashBytes(result.text),splices:edits.map(x=>({...x.edit,operationId:x.op.id}))});return {...b,text:result.text,version:b.version+1};});
        revision=this.commit(current,{blocks},journals,action==='accept'?'range-accepted':'range-reverted',ops.length===1?ops[0]!.id:null);
      }
      for(const op of ops){const status=action==='accept'?'accepted':action==='reject'?'rejected':'reverted';this.writeOperation({...op,status,acceptedRevisionId:action==='accept'?revision.id:op.acceptedRevisionId,acceptedStart:action==='accept'?starts.get(op.id)!:op.acceptedStart});this.db.prepare('INSERT INTO range_decisions(operation_id,document_id,revision_id,action,reason,created_at) VALUES(?,?,?,?,?,?)').run(op.id,documentId,revision.id,status,reason,now());}
      return revision;
    });
  }
  manual(documentId:string,expectedHead:string,updates:readonly {blockId:string;expectedVersion:number;text:string}[]):Revision{
    this.ready();return this.transaction(()=>{
      const current=this.host.currentRevision(documentId);if(current.id!==expectedHead)throw new WriterError('STALE_REVISION','Another session saved this article. Your buffer was preserved.');
      if(!Array.isArray(updates)||updates.length>10000||new Set(updates.map(x=>x.blockId)).size!==updates.length)throw new WriterError('INVALID_INPUT','Invalid manual block update.');
      for(const u of updates){validateText(u.text);const b=current.snapshot.blocks.find(b=>b.id===u.blockId);if(!b||u.expectedVersion!==b.version)throw new WriterError('CHANGE_CONFLICT','Manual editing cannot replace an unknown/stale block.');}
      const journals:BlockJournal[]=[];const blocks=current.snapshot.blocks.map(b=>{const u=updates.find(u=>u.blockId===b.id);if(!u||u.text===b.text)return {...b};const d=rangeDiff(b.text,u.text);journals.push({blockId:b.id,beforeVersion:b.version,afterVersion:b.version+1,beforeHash:hashBytes(b.text),afterHash:hashBytes(u.text),splices:d.splices.map(s=>({...s,operationId:null}))});return {...b,text:u.text,version:b.version+1};});
      return journals.length?this.commit(current,{blocks},journals,'manual-edited',null):current;
    });
  }
  buffer(documentId:string):EditingBuffer|null{this.ready();const row=this.db.prepare('SELECT payload,payload_hash FROM editing_buffers WHERE document_id=?').get(documentId);return row?unpack<EditingBuffer>(row):null;}
  saveBuffer(documentId:string,baseRevisionId:string,expectedVersion:number,blocks:readonly {blockId:string;text:string}[]):EditingBuffer{
    this.ready();return this.transaction(()=>{
      const base=this.host.getRevision(baseRevisionId);if(base.documentId!==documentId||blocks.length!==base.snapshot.blocks.length||blocks.some((b,i)=>b.blockId!==base.snapshot.blocks[i]!.id))throw new WriterError('INVALID_INPUT','Buffer structure differs from its source revision.');
      for(const b of blocks)validateText(b.text);validateSnapshot({blocks:base.snapshot.blocks.map((b,i)=>({...b,text:blocks[i]!.text}))});
      const existing=this.buffer(documentId);if((existing?.version??0)!==expectedVersion)throw new WriterError('STALE_REVISION','The editor buffer changed in another session.');
      const value:EditingBuffer={id:existing?.id??newId('buffer'),documentId,baseRevisionId,version:expectedVersion+1,blocks:structuredClone(blocks),updatedAt:now()};const payload=JSON.stringify(value);
      this.db.prepare('INSERT INTO editing_buffers(id,document_id,base_revision_id,version,payload,payload_hash,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET base_revision_id=excluded.base_revision_id,version=excluded.version,payload=excluded.payload,payload_hash=excluded.payload_hash,updated_at=excluded.updated_at').run(value.id,documentId,baseRevisionId,value.version,payload,hashBytes(payload),value.updatedAt);return value;
    });
  }
  commitBuffer(documentId:string,expectedHead:string,expectedBufferVersion:number):Revision{
    this.ready();return this.transaction(()=>{const b=this.buffer(documentId);if(!b||b.version!==expectedBufferVersion||b.baseRevisionId!==expectedHead)throw new WriterError('STALE_REVISION','The buffer needs an explicit conflict review.');const base=this.host.getRevision(expectedHead);const revision=this.manual(documentId,expectedHead,b.blocks.map((x,i)=>({...x,expectedVersion:base.snapshot.blocks[i]!.version})));this.db.prepare('DELETE FROM editing_buffers WHERE id=? AND version=?').run(b.id,b.version);return revision;});
  }
  discardBuffer(documentId:string,expectedVersion:number):void{this.ready();const b=this.buffer(documentId);if(!b||b.version!==expectedVersion)throw new WriterError('STALE_REVISION','Buffer changed.');this.db.prepare('DELETE FROM editing_buffers WHERE id=? AND version=?').run(b.id,b.version);}
}
