// SPDX-License-Identifier: Apache-2.0
import { WriterError } from './errors.js';
import { MAX_SOURCE_BYTES, SOURCE_EXTRACTOR_VERSION, hashBytes, sourceText, validateMetadata } from './sources.js';
import type { SourceMetadata, SourceMediaType } from './sources.js';

const entities: Record<string,string> = {
  amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:'\u00a0', ensp:'\u2002', emsp:'\u2003', thinsp:'\u2009',
  ndash:'–', mdash:'—', lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”', hellip:'…', bull:'•', copy:'©', reg:'®',
  trade:'™', euro:'€', pound:'£', yen:'¥', cent:'¢', times:'×', divide:'÷', le:'≤', ge:'≥', ne:'≠',
};
/** Bounded common/numeric entity decoding, not the full HTML named-entity standard. Unknown names stay literal. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,8}|#\d{1,10}|[a-z][a-z0-9]{1,31});/gi, (full: string, code: string) => {
    if (!code.startsWith('#')) return entities[code] ?? full;
    const n = /^#x/i.test(code) ? parseInt(code.slice(2),16) : parseInt(code.slice(1),10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
  });
}
const breaks = new Set(['p','div','section','article','main','header','footer','nav','aside','blockquote','h1','h2','h3','h4','h5','h6','li','ul','ol','table','tr','br','hr','pre']);
const omit = new Set(['script','style','template','noscript','iframe','object','svg','math']);
function attributes(tag: string): Map<string,string> {
  const map = new Map<string,string>();
  const body = tag.replace(/^<\/?[a-z0-9:-]+/i,'').replace(/\/?\s*>$/,'');
  for (const m of body.matchAll(/([^\s=<>/'"]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>`]+)))?/g)) {
    const key = m[1]!.toLowerCase();
    if (!map.has(key)) map.set(key,decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return map;
}
export function extractSource(raw: Uint8Array, mediaType: SourceMediaType) {
  if (!(raw instanceof Uint8Array) || raw.byteLength > MAX_SOURCE_BYTES) throw new WriterError('SOURCE_TOO_LARGE','Source exceeds the 2000000-byte raw limit.');
  if (!['text/html','text/plain','text/markdown'].includes(mediaType)) throw new WriterError('SOURCE_UNSUPPORTED','Only UTF-8 HTML, plain text and Markdown are supported.');
  let input: string;
  try { input = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw); }
  catch { throw new WriterError('SOURCE_UNSUPPORTED','Source is not valid UTF-8. No lossy text conversion was stored.'); }
  if (input.includes('\u0000')) throw new WriterError('SOURCE_UNSUPPORTED','NUL bytes in source text are not supported.');
  const warnings: string[] = [];
  const metadata: { -readonly [K in keyof SourceMetadata]: SourceMetadata[K] } = {title:null,author:null,publishedAt:null,publisher:null};
  let text = input;
  if (mediaType === 'text/html') {
    warnings.push('Static text extraction only: not a browser, full HTML parser or article reader. Layout, hidden text, tables and uncommon named entities may differ; check the raw snapshot.');
    const chunks: string[] = [];
    let titleText = '', inTitle = false, inHead = false, pos = 0, skipped: string | null = null;
    const add = (part: string) => { if (inTitle) titleText += part; else if (!inHead) chunks.push(part); };
    while (pos < input.length) {
      if (skipped) {
        // Raw blocks are data, never executed. For nested templates this is conservative, not DOM-equivalent.
        const closingTag = new RegExp('</'+skipped+'(?=[\\s/>])','ig');
        closingTag.lastIndex = pos;
        const close = closingTag.exec(input)?.index ?? -1;
        if (close < 0) { warnings.push('An unclosed omitted HTML element hid the remaining text.'); break; }
        pos = close; skipped = null;
      }
      const start = input.indexOf('<',pos);
      if (start < 0) { add(input.slice(pos)); break; }
      add(input.slice(pos,start));
      if (input.startsWith('<!--',start)) {
        const end = input.indexOf('-->',start+4); pos = end < 0 ? input.length : end+3; continue;
      }
      if (!/^<\/?[a-zA-Z]|^<!|^<\?/.test(input.slice(start,start+3))) { add('<'); pos=start+1; continue; }
      let end = start+1, quote = '';
      for (; end < input.length; end++) {
        const c=input[end]!;
        if (quote) { if (c===quote) quote=''; }
        else if (c==='"' || c==="'") quote=c;
        else if (c==='>') break;
      }
      if (end === input.length) { warnings.push('Unclosed HTML tag: trailing markup omitted.'); break; }
      const tag=input.slice(start,end+1), match=/^<(\/?)([a-z0-9:-]+)/i.exec(tag);
      pos=end+1;
      if (!match) continue;
      const closing=match[1]==='/', name=match[2]!.toLowerCase();
      if (name==='head') {inHead=!closing; continue;}
      if (name==='title') {inTitle=!closing;continue;}
      if (name==='meta' && !closing) {
        const attrs=attributes(tag), key=(attrs.get('name')??attrs.get('property')??'').toLowerCase(), value=attrs.get('content');
        const charset=attrs.get('charset') ?? (attrs.get('http-equiv')?.toLowerCase()==='content-type' ? /charset\s*=\s*([^;\s]+)/i.exec(value??'')?.[1] : undefined);
        if (charset && !/^utf-?8$/i.test(charset)) throw new WriterError('SOURCE_UNSUPPORTED','HTML declares a non-UTF-8 charset. Import a verified UTF-8 copy instead.');
        if (value?.trim()) {
          if (key==='author' && metadata.author===null) metadata.author=value.trim();
          if (['article:published_time','date','datepublished'].includes(key) && metadata.publishedAt===null) metadata.publishedAt=value.trim();
          if (['og:site_name','publisher'].includes(key) && metadata.publisher===null) metadata.publisher=value.trim();
          if (key==='og:title' && metadata.title===null) metadata.title=value.trim();
        }
      }
      if (!closing && omit.has(name)) {skipped=name; if (!inHead) chunks.push('\n'); continue;}
      if (!inHead && !inTitle) {
        if (breaks.has(name)) chunks.push('\n');
        else if (name==='td' || name==='th') chunks.push('\t');
      }
    }
    if (titleText.trim()) metadata.title=decodeEntities(titleText).replace(/\s+/g,' ').trim();
    for (const key of ['title','author','publishedAt','publisher'] as const) {
      const v=metadata[key];
      if (v && v.length>1000) {metadata[key]=v.slice(0,1000);warnings.push(`${key} metadata was shortened; the raw snapshot retains the original.`);}
    }
    text=decodeEntities(chunks.join('')).replace(/\r\n?/g,'\n').replace(/[^\S\n]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
    if (/&[a-z][a-z0-9]{1,31};/i.test(text)) warnings.push('Some named HTML entities are retained literally.');
  }
  sourceText(text); validateMetadata(metadata);
  if (!text.trim()) throw new WriterError('SOURCE_UNSUPPORTED','No usable text was extracted; no source was saved.');
  return {text,metadata,warnings,extractor:SOURCE_EXTRACTOR_VERSION,rawHash:hashBytes(raw),textHash:hashBytes(text)};
}
