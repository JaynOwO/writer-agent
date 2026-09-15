// SPDX-License-Identifier: Apache-2.0
import { openSync, closeSync, fstatSync, lstatSync, readSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { Workspace } from '@writer-agent/storage';
import { MAX_SOURCE_BYTES, WriterError, requireString } from '@writer-agent/core';
import type { SourceMediaType } from '@writer-agent/core';
import { fetchSource, normalizeSourceUrl } from './source-http.js';
export const sourceHelp = `Siglum source library (static, unverified sources; no web search engine)
  writer source add <workspace> <public-url> [--fetch]
  writer source refresh <workspace> <sourceId> [--fetch]
  writer source import <workspace> <input.html|md|txt> [--source-id <sourceId>]
  writer source list <workspace>
  writer source show <workspace> <snapshotId>
  writer source history <workspace> <sourceId>
  writer source search <workspace> <exact-substring>
  writer source extract <workspace> <snapshotId> --lines <first:last>
  writer source excerpts <workspace> <snapshotId>
  writer source note <workspace> <snapshotId> <note> [--excerpt <excerptId>]
  writer source notes <workspace> <snapshotId>
  writer source bind <workspace> <documentId> <blockId> <excerptId>
  writer source links <workspace> <documentId>
  writer source export <workspace> <snapshotId> <new-output-directory>

add/refresh only preview until --fetch is explicitly supplied. No crawling, redirects, cookies, login or JavaScript.
Source line numbers belong to extracted text, not the original HTML or a PDF page.
Use writer migrate <workspace> [--apply] for old workspaces. See docs/sources.md.
`;
const print=(value:unknown)=>console.log(JSON.stringify(value,null,2));
function argsLength(args:string[],min:number,max=min) {
  if(args.length<min||args.length>max)throw new WriterError('INVALID_INPUT','Wrong source arguments. Run writer source help; quote paths and notes with spaces.');
}
export function readSourceFile(path:string):{locator:string;mediaType:SourceMediaType;raw:Uint8Array} {
  const file=resolve(path);const stat=lstatSync(file);
  if(stat.isSymbolicLink()||!stat.isFile()||stat.size>MAX_SOURCE_BYTES)throw new WriterError('INVALID_INPUT','Import requires an ordinary file no larger than 2000000 bytes; symlinks refused.');
  const media:Record<string,SourceMediaType>={'.html':'text/html','.htm':'text/html','.txt':'text/plain','.md':'text/markdown','.markdown':'text/markdown'};
  const mediaType=media[extname(file).toLowerCase()];if(!mediaType)throw new WriterError('SOURCE_UNSUPPORTED','Import supports UTF-8 .html, .htm, .txt, .md or .markdown files only.');
  const fd=openSync(file,'r');
  try {
    const before=fstatSync(fd);if(!before.isFile()||before.size>MAX_SOURCE_BYTES||before.ino!==stat.ino||before.dev!==stat.dev)throw new WriterError('INVALID_INPUT','Source file changed during open.');
    const buf=Buffer.alloc(MAX_SOURCE_BYTES+1);let size=0,n=0;
    while(size<buf.length&&(n=readSync(fd,buf,size,buf.length-size,null))>0)size+=n;
    const after=fstatSync(fd);
    if(size>MAX_SOURCE_BYTES)throw new WriterError('SOURCE_TOO_LARGE','Source grew past the import limit.');
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||size!==before.size)throw new WriterError('INVALID_INPUT','Source changed while being read; no snapshot saved.');
    return {locator:basename(file),mediaType,raw:buf.subarray(0,size)};
  }finally{closeSync(fd);}
}
/** Export never opens HTML in a browser. raw.bin is the exact response/file bytes. */
export function exportSource(workspace:Workspace,snapshotId:string,directory:string) {
  const snapshot=workspace.sources.snapshot(snapshotId),source=workspace.sources.get(snapshot.sourceId),raw=workspace.sources.raw(snapshotId);
  const excerpts=workspace.sources.excerpts(snapshotId),notes=workspace.sources.notes(snapshotId),out=resolve(directory);
  // Nonrecursive exclusive mkdir refuses all existing paths, including symlinks and occupied directories.
  mkdirSync(out,{mode:0o700});
  const write=(name:string,data:string|Uint8Array)=>writeFileSync(join(out,name),data,{flag:'wx',mode:0o600});
  write('raw.bin',raw);write('text.txt',snapshot.text);
  const {text:_text,...metadata}=snapshot;
  write('metadata.json',JSON.stringify({source,snapshot:metadata,verification:'unverified',rawFile:'raw.bin',textFile:'text.txt'},null,2)+'\n');
  write('excerpts.json',JSON.stringify(excerpts,null,2)+'\n');write('notes.json',JSON.stringify(notes,null,2)+'\n');
  return {exported:true,directory:out,snapshotId,rawHash:snapshot.rawHash,textHash:snapshot.textHash};
}
export async function sourceCommand(args:string[]):Promise<void> {
  const [command,...rest]=args;
  if(!command||command==='help'){console.log(sourceHelp);return;}
  const ranges:Record<string,readonly[number,number]>={add:[2,3],refresh:[2,3],import:[2,4],list:[1,1],show:[2,2],history:[2,2],search:[2,2],extract:[4,4],excerpts:[2,2],note:[3,5],notes:[2,2],bind:[4,4],links:[2,2],export:[3,3]};
  const range=Object.hasOwn(ranges,command)?ranges[command]:undefined;if(!range)throw new WriterError('INVALID_INPUT','Unknown source command.');
  argsLength(rest,range[0],range[1]);
  const directory=rest[0];requireString(directory,'workspace',4096);
  const w=Workspace.open(directory);const controller=new AbortController(),cancel=()=>controller.abort();
  try {
    if(w.info().schemaVersion<2)throw new WriterError('MIGRATION_REQUIRED','Run writer migrate <workspace> to preview an explicit, backed-up schema upgrade.');
    const target=rest[1];
    if(command==='list'){print({sources:w.sources.list(),limit:50,notice:'First 50 sources in creation order; use local search to locate more.'});return;}
    requireString(target,'source argument',4096);
    switch(command) {
      case 'add':case 'refresh': {
        if(rest[2]!==undefined&&rest[2]!=='--fetch')throw new WriterError('INVALID_INPUT','Only --fetch is accepted after a source URL/id.');
        const source=command==='refresh'?w.sources.get(target):null;
        if(source?.kind==='file')throw new WriterError('INVALID_INPUT','Refresh a file by importing it again with --source-id. No local path was stored.');
        const url=normalizeSourceUrl(source?.locator??target).href;
        if(rest[2]!=='--fetch'){print({status:'preview-only',fetched:false,url,notice:'Add --fetch to contact this public site and store a static snapshot. No credentials, redirects, browser or embedded resources are used.'});return;}
        process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
        const result=await fetchSource(url,{signal:controller.signal});
        if(controller.signal.aborted)throw new WriterError('SOURCE_CANCELLED','Cancelled before source was stored.');
        print(w.sources.add({kind:'web',locator:result.url,raw:result.raw,mediaType:result.mediaType,...(source?{sourceId:source.id}:{})}));return;
      }
      case 'import': {
        if(rest.length!==2&&(rest.length!==4||rest[2]!=='--source-id'))throw new WriterError('INVALID_INPUT','Expected --source-id <id>.');
        print(w.sources.add({kind:'file',...readSourceFile(target),...(rest[3]?{sourceId:rest[3]}:{})}));return;
      }
      case 'show': {const snapshot=w.sources.snapshot(target);print({source:w.sources.get(snapshot.sourceId),snapshot,verification:'unverified',lines:snapshot.text.split(/\r\n|\r|\n/).map((text,i)=>({line:i+1,text}))});return;}
      case 'history':print(w.sources.history(target));return;
      case 'search':print({scope:'local-latest-snapshots',caseSensitive:true,query:target,limit:20,results:w.sources.search(target)});return;
      case 'extract': {
        if(rest[2]!=='--lines'||!/^\d+:\d+$/.test(rest[3]??''))throw new WriterError('INVALID_INPUT','Expected --lines first:last.');
        const [first,last]=rest[3]!.split(':').map(Number);print(w.sources.extract(target,first!,last!));return;
      }
      case 'excerpts':print(w.sources.excerpts(target));return;
      case 'note': {
        if(rest.length!==3&&(rest.length!==5||rest[3]!=='--excerpt'))throw new WriterError('INVALID_INPUT','Expected optional --excerpt <id>.');
        print(w.sources.note(target,rest[2]!,rest[4]??null));return;
      }
      case 'notes':print(w.sources.notes(target));return;
      case 'bind':print(w.sources.bind(target,rest[2]!,rest[3]!));return;
      case 'links':print(w.sources.bindings(target));return;
      case 'export':print(exportSource(w,target,rest[2]!));return;
    }
  }finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);w.close();}
}
