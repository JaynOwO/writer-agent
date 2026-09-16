// SPDX-License-Identifier: Apache-2.0
import type { DatabaseSync } from 'node:sqlite';
import {
  WriterError, requireString, newId, extractSource, hashBytes, lineRange, lineCount,
  validateMetadata, validateSourceContext, validateSourceSelection, sourceText, parseSnapshot, MAX_CONTEXT_ITEMS,
} from '@writer-agent/core';
import type {
  SourceRecord, SourceSnapshot, SourceMediaType, SourceExcerpt, ResearchNote,
  SourceSelection, SourceContextItem, SourceBinding,
} from '@writer-agent/core';

type Row = Record<string,unknown>;
const str = (r:Row,k:string):string => {if(typeof r[k]!=='string') throw new WriterError('CORRUPT_DATA','Invalid source field: '+k);return r[k];};
const num = (r:Row,k:string):number => {if(typeof r[k]!=='number'||!Number.isSafeInteger(r[k]))throw new WriterError('CORRUPT_DATA','Invalid source number.');return r[k];};
const now = () => new Date().toISOString();
function sourceRow(r:Row):SourceRecord {
  const kind=str(r,'kind'); if(kind!=='web'&&kind!=='file')throw new WriterError('CORRUPT_DATA','Invalid source kind.');
  return {id:str(r,'id'),kind,locator:str(r,'locator'),createdAt:str(r,'created_at')};
}
function snapshotRow(r:Row):SourceSnapshot {
  try {
    const raw=r.raw;if(!(raw instanceof Uint8Array))throw new Error('raw');
    const text=str(r,'text');sourceText(text);
    if(hashBytes(raw)!==str(r,'raw_hash')||hashBytes(text)!==str(r,'text_hash'))throw new Error('hash');
    const metadata:unknown=JSON.parse(str(r,'metadata_json'));validateMetadata(metadata);
    const warnings:unknown=JSON.parse(str(r,'warnings_json'));
    if(!Array.isArray(warnings)||warnings.some(w=>typeof w!=='string'))throw new Error('warnings');
    const mediaType=str(r,'media_type');if(!['text/html','text/plain','text/markdown'].includes(mediaType))throw new Error('media');
    return {id:str(r,'id'),sourceId:str(r,'source_id'),capturedAt:str(r,'captured_at'),mediaType:mediaType as SourceMediaType,
      rawBytes:raw.byteLength,rawHash:str(r,'raw_hash'),textHash:str(r,'text_hash'),text,metadata,extractor:str(r,'extractor'),warnings:warnings as string[]};
  } catch {throw new WriterError('CORRUPT_DATA','Source snapshot is invalid or its stored hashes do not match. Restore a backup; do not use it as evidence.');}
}
/** Same SQLite transaction boundary as manuscripts. This object is never given to a model. */
export class SourceLibrary {
  constructor(private readonly db:DatabaseSync, private readonly ready:()=>void,
    private readonly transaction:<T>(fn:()=>T)=>T) {}
  private requireRow(table:string,id:string):Row {
    this.ready();requireString(id,'source record id');
    // Table names are compile-time choices, never user input.
    if(!['sources','source_snapshots','source_excerpts','documents','changes','research_notes'].includes(table))throw new Error('Unknown table');
    const r=this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    if(!r)throw new WriterError('NOT_FOUND','Source/document/change record not found.');return r;
  }
  add(input:{kind:'web'|'file';locator:string;mediaType:SourceMediaType;raw:Uint8Array;sourceId?:string}):{source:SourceRecord;snapshot:SourceSnapshot} {
    this.ready();requireString(input.locator,'source locator',4096);
    if(input.kind!=='web'&&input.kind!=='file')throw new WriterError('INVALID_INPUT','Unknown source kind.');
    if(input.kind==='web') {
      let url:URL;try{url=new URL(input.locator);}catch{throw new WriterError('INVALID_INPUT','Invalid source URL.');}
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw new WriterError('INVALID_INPUT','Store a normalized HTTP(S) URL without credentials or fragment.');
    } else if(/[\\/\u0000-\u001f]/.test(input.locator))throw new WriterError('INVALID_INPUT','File source locator must be a basename, not a path.');
    const raw=Uint8Array.from(input.raw);const extracted=extractSource(raw,input.mediaType);
    return this.transaction(()=>{
      this.ready();let source:SourceRecord;
      if(input.sourceId) {
        source=this.get(input.sourceId);
        if(source.kind!==input.kind||source.locator!==input.locator)throw new WriterError('INVALID_INPUT','A refresh must keep the original source identity.');
      } else {
        const prior=input.kind==='web'?this.db.prepare("SELECT * FROM sources WHERE kind='web' AND locator=?").get(input.locator):undefined;
        if(prior)source=sourceRow(prior);
        else {source={id:newId('src'),kind:input.kind,locator:input.locator,createdAt:now()};this.db.prepare('INSERT INTO sources(id,kind,locator,created_at) VALUES(?,?,?,?)').run(source.id,source.kind,source.locator,source.createdAt);}
      }
      const id=newId('snap');
      this.db.prepare(`INSERT INTO source_snapshots(id,source_id,captured_at,media_type,raw,raw_hash,text_hash,text,metadata_json,extractor,warnings_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id,source.id,now(),input.mediaType,raw,extracted.rawHash,extracted.textHash,extracted.text,JSON.stringify(extracted.metadata),extracted.extractor,JSON.stringify(extracted.warnings));
      return {source,snapshot:this.snapshot(id)};
    });
  }
  get(id:string):SourceRecord {return sourceRow(this.requireRow('sources',id));}
  snapshot(id:string):SourceSnapshot {return snapshotRow(this.requireRow('source_snapshots',id));}
  raw(id:string):Uint8Array {const r=this.requireRow('source_snapshots',id);snapshotRow(r);return Uint8Array.from(r.raw as Uint8Array);}
  list(limit=50):{source:SourceRecord;latestSnapshotId:string|null}[] {
    this.ready();if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw new WriterError('INVALID_INPUT','Source list limit is 1..200.');
    return this.db.prepare(`SELECT s.*, (SELECT id FROM source_snapshots WHERE source_id=s.id ORDER BY seq DESC LIMIT 1) AS latest_id FROM sources s ORDER BY s.created_at,s.id LIMIT ?`).all(limit)
      .map(r=>({source:sourceRow(r),latestSnapshotId:typeof r.latest_id==='string'?r.latest_id:null}));
  }
  history(sourceId:string):SourceSnapshot[] {
    this.get(sourceId);return this.db.prepare('SELECT * FROM source_snapshots WHERE source_id=? ORDER BY seq').all(sourceId).map(snapshotRow);
  }
  search(query:string,limit=20) {
    this.ready();requireString(query,'search query',200);
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new WriterError('INVALID_INPUT','Search limit is 1..100.');
    // Exact Unicode substring search works for Chinese without pretending FTS English tokenization does.
    return this.db.prepare(`SELECT x.*,s.locator FROM source_snapshots x JOIN sources s ON s.id=x.source_id
      WHERE x.seq=(SELECT MAX(seq) FROM source_snapshots WHERE source_id=s.id)
      AND (instr(x.text,?)>0 OR instr(
        COALESCE(json_extract(x.metadata_json,'$.title'),'') || char(10) ||
        COALESCE(json_extract(x.metadata_json,'$.author'),'') || char(10) ||
        COALESCE(json_extract(x.metadata_json,'$.publisher'),'') || char(10) ||
        COALESCE(json_extract(x.metadata_json,'$.publishedAt'),''),?)>0) ORDER BY x.seq DESC LIMIT ?`).all(query,query,limit).map(r=>{
        const snapshot=snapshotRow(r);const start=Math.max(0,snapshot.text.indexOf(query)-60);
        return {sourceId:snapshot.sourceId,snapshotId:snapshot.id,title:snapshot.metadata.title,locator:str(r,'locator'),snippet:snapshot.text.slice(start,start+240)};
      });
  }
  extract(snapshotId:string,start:number,end:number):SourceExcerpt {
    return this.transaction(()=>{
      const snapshot=this.snapshot(snapshotId);const span=lineRange(snapshot.text,start,end);
      if(!span.quote.trim())throw new WriterError('INVALID_INPUT','An excerpt must contain non-whitespace text.');
      sourceText(span.quote,80_000);
      const id=newId('ex');
      this.db.prepare('INSERT INTO source_excerpts(id,snapshot_id,start_line,end_line,start_offset,end_offset,quote,quote_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(id,snapshotId,start,end,span.startOffset,span.endOffset,span.quote,span.quoteHash,now());
      return this.excerpt(id);
    });
  }
  excerpt(id:string):SourceExcerpt {
    const row=this.requireRow('source_excerpts',id);const snapshot=this.snapshot(str(row,'snapshot_id'));
    try {
      const range=lineRange(snapshot.text,num(row,'start_line'),num(row,'end_line'));
      if(range.quote!==str(row,'quote')||range.quoteHash!==str(row,'quote_hash')||range.startOffset!==num(row,'start_offset')||range.endOffset!==num(row,'end_offset'))throw new Error('range');
      return {id:str(row,'id'),snapshotId:snapshot.id,sourceId:snapshot.sourceId,...range,createdAt:str(row,'created_at')};
    } catch {throw new WriterError('CORRUPT_DATA','Stored excerpt no longer matches its immutable source snapshot.');}
  }
  excerpts(snapshotId:string):SourceExcerpt[] {
    this.snapshot(snapshotId);return this.db.prepare('SELECT id FROM source_excerpts WHERE snapshot_id=? ORDER BY seq').all(snapshotId).map(r=>this.excerpt(str(r,'id')));
  }
  note(snapshotId:string,text:string,excerptId:string|null=null):ResearchNote {
    sourceText(text,8000);requireString(text,'note',8000);
    return this.transaction(()=>{
      this.snapshot(snapshotId);
      if(excerptId!==null&&this.excerpt(excerptId).snapshotId!==snapshotId)throw new WriterError('INVALID_INPUT','Note and excerpt must use the same snapshot.');
      const note:ResearchNote={id:newId('note'),snapshotId,excerptId,text,createdAt:now()};
      this.db.prepare('INSERT INTO research_notes(id,snapshot_id,excerpt_id,text,created_at) VALUES(?,?,?,?,?)').run(note.id,snapshotId,excerptId,text,note.createdAt);return note;
    });
  }
  notes(snapshotId:string):ResearchNote[] {
    this.snapshot(snapshotId);return this.db.prepare('SELECT * FROM research_notes WHERE snapshot_id=? ORDER BY seq').all(snapshotId).map(r=>({id:str(r,'id'),snapshotId,excerptId:r.excerpt_id===null?null:str(r,'excerpt_id'),text:str(r,'text'),createdAt:str(r,'created_at')}));
  }
  context(selection:SourceSelection):SourceContextItem[] {
    validateSourceSelection(selection);
    const snapshots=selection.snapshots??[],excerpts=selection.excerpts??[];
    if(!Array.isArray(snapshots)||!Array.isArray(excerpts)||snapshots.length+excerpts.length>MAX_CONTEXT_ITEMS)throw new WriterError('INVALID_INPUT','Select at most 8 snapshots/excerpts.');
    // An empty selection remains compatible with schema v1 and does not access source tables.
    const items:SourceContextItem[]=[];
    for(const id of snapshots) {
      const s=this.snapshot(id),source=this.get(s.sourceId);
      items.push({sourceId:s.sourceId,snapshotId:s.id,excerptId:null,locator:source.locator,title:s.metadata.title,textHash:s.textHash,contentHash:s.textHash,startLine:1,endLine:lineCount(s.text),text:s.text});
    }
    for(const id of excerpts) {
      const e=this.excerpt(id),s=this.snapshot(e.snapshotId),source=this.get(s.sourceId);
      items.push({sourceId:s.sourceId,snapshotId:s.id,excerptId:e.id,locator:source.locator,title:s.metadata.title,textHash:s.textHash,contentHash:e.quoteHash,startLine:e.startLine,endLine:e.endLine,text:e.quote});
    }
    // Tool results retain an explicit unverified third-party origin, even when stored as imported text.
    const hasOrigin=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='source_provenance'").get();
    if(hasOrigin) for(let i=0;i<items.length;i++){const item=items[i]!, row=this.db.prepare('SELECT payload,payload_hash FROM source_provenance WHERE snapshot_id=?').get(item.snapshotId); if(row){if(typeof row.payload!=='string'||hashBytes(row.payload)!==row.payload_hash)throw new WriterError('CORRUPT_DATA','Tool origin integrity mismatch.');const p=JSON.parse(row.payload) as {serverId:string;name:string;attemptId:string;descriptorHash:string};items[i]={...item,origin:{kind:'mcp',serverId:p.serverId,name:p.name,attemptId:p.attemptId,descriptorHash:p.descriptorHash,verification:'external-service-unverified'}};}}
    validateSourceContext(items);return items;
  }
  verifyContext(items:readonly SourceContextItem[]):void {
    validateSourceContext(items);
    for(const item of items) {
      const expected=this.context(item.excerptId===null?{snapshots:[item.snapshotId]}:{excerpts:[item.excerptId]})[0]!;
      if(Object.keys(expected).length!==Object.keys(item).length)throw new WriterError('INVALID_INPUT','Unexpected source origin metadata.');
      for(const key of Object.keys(expected) as (keyof SourceContextItem)[])if(JSON.stringify(expected[key])!==JSON.stringify(item[key]))throw new WriterError('INVALID_INPUT','Source context differs from the saved snapshot/excerpt.');
    }
  }
  bind(documentId:string,blockId:string,excerptId:string):SourceBinding {
    return this.transaction(()=>{
      const doc=this.requireRow('documents',documentId);this.excerpt(excerptId);requireString(blockId,'blockId');
      const rev=this.db.prepare('SELECT * FROM revisions WHERE id=? AND document_id=?').get(str(doc,'head_revision_id'),documentId);
      if(!rev)throw new WriterError('CORRUPT_DATA','Missing document head.');
      const block=parseSnapshot(str(rev,'snapshot_json')).blocks.find(b=>b.id===blockId);
      if(!block)throw new WriterError('NOT_FOUND','Block not found in this document.');
      const binding:SourceBinding={id:newId('link'),documentId,revisionId:str(rev,'id'),blockId,blockVersion:block.version,excerptId,createdAt:now(),state:'current',verification:'user-linked-not-verified'};
      this.db.prepare('INSERT INTO source_bindings(id,document_id,revision_id,block_id,block_version,excerpt_id,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(binding.id,documentId,binding.revisionId,blockId,block.version,excerptId,binding.createdAt);return binding;
    });
  }
  bindings(documentId:string):SourceBinding[] {
    const doc=this.requireRow('documents',documentId);
    const rev=this.db.prepare('SELECT * FROM revisions WHERE id=?').get(str(doc,'head_revision_id'));
    if(!rev)throw new WriterError('CORRUPT_DATA','Missing revision.');const current=parseSnapshot(str(rev,'snapshot_json'));
    return this.db.prepare('SELECT * FROM source_bindings WHERE document_id=? ORDER BY seq').all(documentId).map(r=>({
      id:str(r,'id'),documentId,revisionId:str(r,'revision_id'),blockId:str(r,'block_id'),blockVersion:num(r,'block_version'),excerptId:str(r,'excerpt_id'),createdAt:str(r,'created_at'),
      state:current.blocks.some(b=>b.id===r.block_id&&b.version===r.block_version)?'current':'stale',verification:'user-linked-not-verified',
    }));
  }
  provenance(changeId:string) {
    this.requireRow('changes',changeId);
    const r=this.db.prepare('SELECT p.* FROM proposal_contexts p JOIN change_contexts c ON c.context_id=p.id WHERE c.change_id=?').get(changeId);
    if(!r)return null;
    try {
      const items:unknown=JSON.parse(str(r,'items_json'));validateSourceContext(items);this.verifyContext(items);
      return {id:str(r,'id'),documentId:str(r,'document_id'),baseRevisionId:str(r,'base_revision_id'),providerId:str(r,'provider_id'),instruction:str(r,'instruction'),items,createdAt:str(r,'created_at'),verification:'supplied-not-verified' as const};
    }catch{throw new WriterError('CORRUPT_DATA','Stored proposal source context is invalid.');}
  }
}
