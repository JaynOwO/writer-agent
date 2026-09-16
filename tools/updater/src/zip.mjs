// SPDX-License-Identifier: Apache-2.0
// A deliberately limited, bounded ZIP reader. Only ordinary stored/deflated files are accepted.
import { strictJson } from './json.mjs';
import { inflateRawSync } from 'node:zlib';
import { insist, safeRelative, sha256, parseVersion, exactKeys } from './common.mjs';
const decoder = new TextDecoder('utf-8', { fatal: true });
const table = new Uint32Array(256);
for (let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[i]=c>>>0;}
export function crc32(b){let c=0xffffffff;for(const n of b)c=table[(c^n)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export const ZIP_LIMITS = Object.freeze({ compressed: 128_000_000, total: 256_000_000, file: 16_000_000, entries: 3000, ratio: 300 });
function decode(b){try{return decoder.decode(b);}catch{insist(false,'ZIP_ENCODING','ZIP entry is not valid UTF-8.');}}
function extraSafe(buf) {
  let i=0;while(i<buf.length){insist(i+4<=buf.length,'ZIP_INVALID','Truncated ZIP extra field.');const id=buf.readUInt16LE(i),len=buf.readUInt16LE(i+2);i+=4;insist(i+len<=buf.length && ![1,0x7075,0x000d,0x756e].includes(id),'ZIP_UNSUPPORTED','ZIP64, alternative names and Unix link metadata are not supported.');i+=len;}
}
export function readZip(bytes, limits=ZIP_LIMITS) {
  insist(Buffer.isBuffer(bytes) && bytes.length>=22 && bytes.length<=limits.compressed,'ZIP_SIZE','Invalid compressed ZIP size.');
  let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--){if(bytes.readUInt32LE(p)===0x06054b50 && p+22+bytes.readUInt16LE(p+20)===bytes.length){end=p;break;}}
  insist(end>=0,'ZIP_INVALID','No valid end-of-central-directory record.');
  const count=bytes.readUInt16LE(end+10),centralSize=bytes.readUInt32LE(end+12),central=bytes.readUInt32LE(end+16);
  insist(bytes.readUInt16LE(end+4)===0 && bytes.readUInt16LE(end+6)===0 && bytes.readUInt16LE(end+8)===count && count!==65535 && count>0 && count<=limits.entries && central+centralSize===end,'ZIP_UNSUPPORTED','Split, ZIP64 or malformed directory refused.');
  const entries=new Map(), names=new Set(), spans=[];let pos=central,total=0;
  for(let i=0;i<count;i++){
    insist(pos+46<=end && bytes.readUInt32LE(pos)===0x02014b50,'ZIP_INVALID','Invalid central record.');
    const flags=bytes.readUInt16LE(pos+8),method=bytes.readUInt16LE(pos+10),crc=bytes.readUInt32LE(pos+16),packed=bytes.readUInt32LE(pos+20),size=bytes.readUInt32LE(pos+24),nl=bytes.readUInt16LE(pos+28),el=bytes.readUInt16LE(pos+30),cl=bytes.readUInt16LE(pos+32),disk=bytes.readUInt16LE(pos+34),attrs=bytes.readUInt32LE(pos+38),offset=bytes.readUInt32LE(pos+42);
    insist((flags & ~0x080e)===0 && (flags&1)===0 && [0,8].includes(method) && disk===0 && pos+46+nl+el+cl<=end,'ZIP_UNSUPPORTED','Unsupported ZIP flags, method or disk.');
    const rawName=bytes.subarray(pos+46,pos+46+nl),name=decode(rawName),directory=name.endsWith('/'),path=directory?name.slice(0,-1):name;
    safeRelative(path);const key=path.normalize('NFC').toLowerCase();insist(!names.has(key),'ZIP_DUPLICATE','Duplicate or case-colliding ZIP path.');names.add(key);
    const unixType=(attrs>>>16)&0xf000;
    insist(unixType===0 || unixType===(directory?0x4000:0x8000),'ZIP_LINK','Only ordinary ZIP entries are accepted.');
    insist(size<=limits.file && (packed>0 || size===0) && size<=Math.max(1024,packed*limits.ratio),'ZIP_SIZE','ZIP entry size/ratio limit exceeded.');
    total+=size;insist(total<=limits.total,'ZIP_SIZE','Unpacked ZIP exceeds total limit.');
    extraSafe(bytes.subarray(pos+46+nl,pos+46+nl+el));
    insist(offset+30<=central && bytes.readUInt32LE(offset)===0x04034b50,'ZIP_INVALID','Invalid local ZIP header.');
    const ln=bytes.readUInt16LE(offset+26),le=bytes.readUInt16LE(offset+28),dataStart=offset+30+ln+le,dataEnd=dataStart+packed;
    insist(dataStart<=central && dataEnd<=central && bytes.readUInt16LE(offset+6)===flags && bytes.readUInt16LE(offset+8)===method && bytes.subarray(offset+30,offset+30+ln).equals(rawName),'ZIP_INVALID','Local and central ZIP entries disagree.');
    extraSafe(bytes.subarray(offset+30+ln,dataStart));
    if(!(flags&8))insist(bytes.readUInt32LE(offset+14)===crc && bytes.readUInt32LE(offset+18)===packed && bytes.readUInt32LE(offset+22)===size,'ZIP_INVALID','ZIP size or CRC headers disagree.');
    let after=dataEnd;
    if(flags&8){const signed=after+4<=central && bytes.readUInt32LE(after)===0x08074b50;if(signed)after+=4;insist(after+12<=central && bytes.readUInt32LE(after)===crc && bytes.readUInt32LE(after+4)===packed && bytes.readUInt32LE(after+8)===size,'ZIP_INVALID','Invalid ZIP data descriptor.');after+=12;}
    spans.push([offset,after]);
    let raw;try{raw=method===0?Buffer.from(bytes.subarray(dataStart,dataEnd)):inflateRawSync(bytes.subarray(dataStart,dataEnd),{maxOutputLength:Math.max(1,size)});}catch{insist(false,'ZIP_INVALID','Invalid or oversized deflate stream.');}
    insist(raw.length===size && crc32(raw)===crc,'ZIP_CHECKSUM','ZIP CRC or length mismatch.');
    if(directory)insist(size===0,'ZIP_INVALID','Directory contains data.');else entries.set(path,raw);
    pos+=46+nl+el+cl;
  }
  insist(pos===end,'ZIP_INVALID','Trailing central-directory content.');spans.sort((a,b)=>a[0]-b[0]);
  for(let i=0;i<spans.length;i++)insist(spans[i][0]===(i?spans[i-1][1]:0),'ZIP_OVERLAP','Overlapping, gapped or prefixed ZIP entries refused.');
  insist(spans.at(-1)[1]===central,'ZIP_INVALID','Unknown content before central directory.');
  // A regular file cannot also be a directory ancestor, even with different case.
  const fileKeys=new Set([...entries.keys()].map(x=>x.normalize('NFC').toLowerCase()));
  for(const name of names){const p=name.split('/');for(let i=1;i<p.length;i++)insist(!fileKeys.has(p.slice(0,i).join('/')),'ZIP_COLLISION','File/directory collision.');}
  return entries;
}
export function parseDelivery(bytes, policy) {
  const zip=readZip(bytes), roots=[...zip.keys()].filter(n=>n==='UPDATE_MANIFEST.json'||n.endsWith('/UPDATE_MANIFEST.json'));
  insist(roots.length===1,'MANIFEST_INVALID','Expected exactly one update manifest.');
  const root=roots[0].slice(0,-'UPDATE_MANIFEST.json'.length);insist(!root||root.split('/').length===2,'MANIFEST_INVALID','Unexpected nested delivery root.');
  const raw=zip.get(roots[0]);insist(raw.length<=4_000_000,'MANIFEST_INVALID','Manifest exceeds limit.');let m;
  m=strictJson(raw);
  exactKeys(m,['format','version','repository','baseCommit','baseTree','files','changes','identity','product','kind'],['format','version','repository','baseCommit','baseTree','files','changes']);
  insist(m.format===1 && typeof m.repository==='string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(m.repository),'MANIFEST_INVALID','Unknown delivery format.');parseVersion(m.version);
  insist(/^[0-9a-f]{40}$/.test(m.baseCommit) && /^[0-9a-f]{40}$/.test(m.baseTree),'MANIFEST_INVALID','Missing exact source baseline.');
  if(m.identity){exactKeys(m.identity,['host','repositoryId'],['host','repositoryId']);insist(m.identity.host===policy.host && String(m.identity.repositoryId)===policy.repositoryId,'REPOSITORY_MISMATCH','Delivery targets a different stable repository identity.');}
  else insist(policy.legacyApproved===true && policy.legacyNames.some(n=>n.toLowerCase()===m.repository.toLowerCase()),'LEGACY_BINDING_REQUIRED','Legacy bundle requires the explicitly approved historical-name binding.');
  insist((m.kind===undefined||m.kind==='source-delivery')&&(m.product===undefined||m.product==='siglum'),'PACKAGE_TYPE','Not a Siglum source delivery.');
  insist(Array.isArray(m.files)&&m.files.length>0&&m.files.length<=2000&&Array.isArray(m.changes)&&m.changes.length>0&&m.changes.length<=m.files.length,'MANIFEST_INVALID','Invalid source/change arrays.');
  const files=new Map(),names=new Set();
  for(const e of m.files){exactKeys(e,['path','bytes','sha256'],['path','bytes','sha256']);safeRelative(e.path);const k=e.path.toLowerCase();insist(!names.has(k)&&Number.isSafeInteger(e.bytes)&&e.bytes>=0&&e.bytes<=ZIP_LIMITS.file&&/^[0-9a-f]{64}$/.test(e.sha256),'MANIFEST_INVALID','Invalid or duplicate source entry.');names.add(k);const b=zip.get(root+'source/'+e.path);insist(b&&b.length===e.bytes&&sha256(b)===e.sha256,'SOURCE_CHECKSUM','Source does not match manifest.',{path:e.path});files.set(e.path,b);}
  for(const n of zip.keys())if(n.startsWith(root+'source/'))insist(files.has(n.slice((root+'source/').length)),'MANIFEST_INVALID','Unlisted source file.');
  const seen=new Set();for(const c of m.changes){exactKeys(c,['path','baseBlob'],['path','baseBlob']);insist(files.has(c.path)&&!seen.has(c.path)&&(c.baseBlob===null||/^[0-9a-f]{40}$/.test(c.baseBlob)),'MANIFEST_INVALID','Invalid changed-file entry.');seen.add(c.path);}
  return {manifest:m,files,hash:sha256(bytes),root,kind:'source-delivery',product:'siglum'};
}
