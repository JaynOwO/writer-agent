// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractSource, decodeEntities, hashBytes, lineRange, lineCount, validateSourceContext } from '@writer-agent/core';
const html=(s:string)=>extractSource(Buffer.from(s),'text/html');
test('static HTML extraction retains provenance and reports metadata without inventing it',()=>{
  const r=html('<html><head><title>A &amp; B</title><meta name="author" content="李四"><meta property="article:published_time" content="2026-09-01"><meta property="og:site_name" content="Example"></head><body><h1>标题</h1><p>可能 <b>相关</b>。</p><p>Not causation.</p></body></html>');
  assert.equal(r.text,'标题\n\n可能 相关。\n\nNot causation.');
  assert.deepEqual(r.metadata,{title:'A & B',author:'李四',publishedAt:'2026-09-01',publisher:'Example'});
  assert.equal(r.textHash,hashBytes(r.text));assert.match(r.warnings.join(' '),/not a browser/);
});
test('unknown metadata remains null; source text cannot execute code or fetch subresources',()=>{
  const r=html('<p>keep</p><script>globalThis.EXECUTED=true</script><style>body{color:red}</style><img src="http://127.0.0.1/private"><iframe src="file:///secret">bad</iframe><p>尾段</p>');
  assert.equal(r.text,'keep\n\n尾段');assert.equal(r.metadata.author,null);assert.equal(r.metadata.publishedAt,null);assert.doesNotMatch(r.text,/EXECUTED|file:|private|color/);
});
test('tag scanner handles greater-than signs in attributes, comments, mixed-case scripts and quoted meta',()=>{
  const r=html('<head><title>quoted</title><meta name=author content="A > B"></head><!-- <p>comment</p> --><p data-x="a > b">正文</p><ScRiPt>x > y</sCrIpT><p>结束</p>');
  assert.equal(r.metadata.author,'A > B');assert.equal(r.text,'正文\n\n结束');
});
test('omitted raw block indices are not shifted by Unicode case conversion',()=>{
  assert.equal(html('<p>İ</p><script>bad</script><p>good</p>').text,'İ\n\ngood');
});
test('numeric and common entities decode once, not recursively',()=>{
  assert.equal(decodeEntities('&#x1f600; &#20320; &amp;lt; &unknown;'),'😀 你 &lt; &unknown;');
  assert.equal(decodeEntities('&#0; &#xD800;'),'� �');
});
test('UTF-8 plain text and Markdown preserve original characters and line endings',()=>{
  const text='\ufeffA\r\n你好😀\n';
  for(const type of ['text/plain','text/markdown'] as const){const r=extractSource(Buffer.from(text),type);assert.equal(r.text,text);assert.equal(r.textHash,hashBytes(Buffer.from(text)));}
});
for(const [name,raw,type] of [
  ['invalid UTF-8',Buffer.from([0xff]),'text/plain'],['NUL',Buffer.from('hi\0there'),'text/plain'],
  ['PDF',Buffer.from('%PDF'),'application/pdf'],['empty HTML',Buffer.from('<script>bad</script>'),'text/html'],
  ['unsupported charset',Buffer.from('<meta charset="gbk"><p>abc</p>'),'text/html'],
] as const)test('unsupported source rejected: '+name,()=>assert.throws(()=>extractSource(raw,type as 'text/html'),{code:'SOURCE_UNSUPPORTED'}));
test('raw and extracted size caps are enforced',()=>{
  assert.throws(()=>extractSource(Buffer.alloc(2_000_001),'text/plain'),{code:'SOURCE_TOO_LARGE'});
  assert.throws(()=>extractSource(Buffer.from('a'.repeat(1_000_001)),'text/plain'),{code:'INVALID_INPUT'});
});
test('exact excerpt line offsets work with CRLF, emoji and final empty lines',()=>{
  const text='甲\r\n😀乙\r\n尾\n';const r=lineRange(text,2,3);
  assert.equal(r.quote,'😀乙\r\n尾');assert.equal(text.slice(r.startOffset,r.endOffset),r.quote);
  assert.equal(r.quoteHash,hashBytes(r.quote));assert.equal(lineCount(text),4);
  assert.equal(lineRange(text,1,4).quote,text);
});
for(const range of [[0,1],[1,0],[2,1],[1,99],[1.2,2],[1,Infinity]])test('invalid source line range '+range,()=>assert.throws(()=>lineRange('a\nb',range[0]!,range[1]!),{code:'INVALID_INPUT'}));
test('source-context validator enforces hashes, distinct identity and strict fields',()=>{
  const text='证据';const item={sourceId:'src1',snapshotId:'snap1',excerptId:null,locator:'example.txt',title:null,textHash:hashBytes(text),contentHash:hashBytes(text),startLine:1,endLine:1,text};
  validateSourceContext([item]);assert.throws(()=>validateSourceContext([item,item]),{code:'INVALID_INPUT'});
  assert.throws(()=>validateSourceContext([{...item,text:'tampered'}]),{code:'INVALID_INPUT'});
  assert.throws(()=>validateSourceContext([{...item,verified:true}]),{code:'INVALID_INPUT'});
});
