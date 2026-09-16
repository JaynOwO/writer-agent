// SPDX-License-Identifier: Apache-2.0
import { WriterError, requireString } from './errors.js';
import { hashBytes, sourceText } from './sources.js';
import type { SourceContextItem, SourceQuote, DraftOutput, SearchResult, SearchHit } from './index.js';
import { publicResultUrl } from './workflow.js';

export const RESEARCH_INDEX_VERSION = 'paragraph-window-v1';
export interface ResearchChunk {
  id: string; snapshotId: string; textHash: string; startLine: number; endLine: number;
  start: number; end: number; quote: string; quoteHash: string; heading: string;
  previousId: string | null; nextId: string | null;
}
export interface ResearchIndex { version: typeof RESEARCH_INDEX_VERSION; snapshotId: string; textHash: string; totalLines: number; chunks: ResearchChunk[] }
export interface RankedChunk { chunk: ResearchChunk; score: number; reasons: string[] }
export interface EvidenceWindow { startLine: number; endLine: number; score: number; reasons: string[] }
export interface EvidencePlan {
  version: 'evidence-window-v1'; query: string; windows: EvidenceWindow[]; totalLines: number;
  includedLines: number; omittedLines: number; indexedEntireText: true; modelReadEntireText: boolean;
  warnings: string[];
}
/** Index all saved text. Coordinates always address the unmodified extracted source. */
export function indexResearch(snapshotId: string, text: string): ResearchIndex {
  requireString(snapshotId, 'snapshot ID'); sourceText(text, 1_000_000);
  const lines = text.split(/\r\n|\r|\n/); const textHash = hashBytes(text); const chunks: ResearchChunk[] = [];
  const starts = [0];
  for (const match of text.matchAll(/\r\n|\r|\n/g)) starts.push(match.index + match[0].length);
  let start = 1, heading = '';
  const emit = (end: number) => {
    if (end < start) return;
    const startOffset = starts[start - 1]!;
    let endOffset = starts[end] ?? text.length;
    if (end < starts.length) { if (text[endOffset - 1] === '\n') endOffset--; if (text[endOffset - 1] === '\r') endOffset--; }
    const quote = text.slice(startOffset, endOffset);
    const r = { startOffset, endOffset, quote, quoteHash: hashBytes(quote) };
    if (r.quote.trim()) chunks.push({ id: hashBytes(`${RESEARCH_INDEX_VERSION}:${snapshotId}:${start}:${end}:${r.quoteHash}`), snapshotId, textHash,
      startLine: start, endLine: end, start: r.startOffset, end: r.endOffset, quote: r.quote, quoteHash: r.quoteHash, heading, previousId: null, nextId: null });
    start = end + 1;
  };
  let bytes = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!; const header = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (header) { emit(i); heading = header[1]!.length>256 ? header[1]!.slice(0,256)+'…' : header[1]!; bytes = 0; }
    bytes += Buffer.byteLength(line) + 1;
    if (i + 1 - start >= 11 || bytes >= 2400 || (!line.trim() && i + 1 > start)) { emit(i + 1); bytes = 0; }
  }
  emit(lines.length);
  if (chunks.length > 12000) throw new WriterError('INVALID_INPUT', 'Source has too many index chunks.');
  for (let i = 0; i < chunks.length; i++) { chunks[i]!.previousId = chunks[i - 1]?.id ?? null; chunks[i]!.nextId = chunks[i + 1]?.id ?? null; }
  return { version: RESEARCH_INDEX_VERSION, snapshotId, textHash, totalLines: lines.length, chunks };
}
const STOP = new Set('the and a an of to in for is are with on as be by or from what how explain please about this that using use'.split(' '));
/** Latin words and Han bigrams; ranking normalization never touches quote coordinates. */
export function researchTerms(query: string): string[] {
  const value = query.normalize('NFKC').toLowerCase(); const terms = new Set<string>();
  for (const m of value.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = m[0];
    if (/\p{Script=Han}/u.test(word)) {
      for (const part of word.match(/\p{Script=Han}+/gu) ?? []) { const cps = [...part]; if (cps.length === 1) terms.add(part); for (let i = 0; i < cps.length - 1; i++) terms.add(cps[i]! + cps[i + 1]!); }
      for (const part of word.match(/[a-z0-9]+/g) ?? []) if (!STOP.has(part)) terms.add(part);
    } else if (!STOP.has(word) && word.length > 1) terms.add(word);
    if (terms.size > 256) break;
  }
  return [...terms].slice(0, 128);
}
export function rankResearch(index: ResearchIndex, query: string): RankedChunk[] {
  requireString(query, 'research question', 10000); const terms = researchTerms(query);
  const texts = index.chunks.map(c => (c.heading + '\n' + c.quote).normalize('NFKC').toLowerCase());
  const weights = terms.map(t => Math.log(1 + index.chunks.length / (1 + texts.filter(v => v.includes(t)).length)));
  return index.chunks.map((chunk, i) => {
    let score = 0; const matched: string[] = [];
    for (let n = 0; n < terms.length; n++) if (texts[i]!.includes(terms[n]!)) { score += weights[n]!; matched.push(terms[n]!); }
    return { chunk, score, reasons: matched.length ? [`Question-term matches: ${matched.join(', ')}`] : ['No literal question-term match; not a semantic relevance verdict.'] };
  }).sort((a, b) => b.score - a.score || a.chunk.start - b.chunk.start);
}
/** Preserve nearby qualifiers. Empty relevance does not pretend that the prefix answers the question. */
export function planEvidence(index: ResearchIndex, text: string, query: string, maxBytes = 8000, maxWindows = 2): EvidencePlan {
  if (hashBytes(text) !== index.textHash) throw new WriterError('CORRUPT_DATA', 'Index/source hash mismatch.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > 80000 || !Number.isSafeInteger(maxWindows) || maxWindows < 1 || maxWindows > 8) throw new WriterError('INVALID_INPUT', 'Invalid evidence budget.');
  const starts=[0];for(const m of text.matchAll(/\r\n|\r|\n/g))starts.push(m.index+m[0].length);
  const positions=new Map(index.chunks.map((c,i)=>[c.id,i]));
  const rangeBytes=(start:number,end:number)=>{let stop=starts[end]??text.length;if(end<starts.length){if(text[stop-1]==='\n')stop--;if(text[stop-1]==='\r')stop--;}return Buffer.byteLength(text.slice(starts[start-1]!,stop));};
  let skipped=0;
  const ranked = rankResearch(index, query); const windows: EvidenceWindow[] = []; const warnings: string[] = []; let used = 0;
  const candidates = ranked.some(r => r.score > 0) ? ranked.filter(r => r.score > 0) : ranked.slice(0, 1);
  if (!ranked.some(r => r.score > 0)) warnings.push('No literal question match. The first available passage is only a navigation sample, not proof of relevance.');
  for (const r of candidates) {
    if (windows.length >= maxWindows) break;
    const pos = positions.get(r.chunk.id)!;
    const left = index.chunks[pos - 1]; const right = index.chunks[pos + 1];
    let start = left && left.heading === r.chunk.heading ? left.startLine : Math.max(1, r.chunk.startLine - 2);
    let end = right && right.heading === r.chunk.heading ? right.endLine : Math.min(index.totalLines, r.chunk.endLine + 2);
    if (windows.some(w => start <= w.endLine && end >= w.startLine)) continue;
    let bytes = rangeBytes(start,end);
    if (bytes + used > maxBytes) {
      start = Math.max(1, r.chunk.startLine - 2); end = Math.min(index.totalLines, r.chunk.endLine + 2);
      bytes = rangeBytes(start,end);
    }
    if (bytes + used > maxBytes) { skipped++;if(skipped<=20)warnings.push(`Relevant lines ${r.chunk.startLine}–${r.chunk.endLine} with context exceed the remaining evidence budget; not silently clipped.`); continue; }
    windows.push({ startLine: start, endLine: end, score: r.score, reasons: [...r.reasons, 'Includes adjacent extracted-text context; not a guarantee all qualifications were captured.'] }); used += bytes;
  }
  if(skipped>20)warnings.push(`${skipped-20} additional oversized candidate windows omitted; no text was silently clipped.`);
  windows.sort((a, b) => a.startLine - b.startLine);
  const includedLines = windows.reduce((n, w) => n + w.endLine - w.startLine + 1, 0);
  return { version: 'evidence-window-v1', query, windows, totalLines: index.totalLines, includedLines, omittedLines: index.totalLines - includedLines,
    indexedEntireText: true, modelReadEntireText: includedLines === index.totalLines, warnings };
}
export interface RankedDiscovery { hit: SearchHit; reasons: string[]; score: number; role: 'unclassified'; publishedAt: null }
/** Deterministic retrieval preference, never a source truth/reliability rating. */
export function rankDiscoveries(records: SearchResult[], domains: readonly string[], max: number, question: string) {
  const terms = researchTerms(question); const candidates: RankedDiscovery[] = []; const excluded: { id: string; reason: string }[] = []; const urls = new Set<string>(); const snippets = new Map<string, string>();
  for (const record of records) for (const hit of record.results) {
    let url: string; try { url = publicResultUrl(hit.url, domains); } catch { excluded.push({ id: hit.id, reason: 'URL blocked by author/public-address policy.' }); continue; }
    if (urls.has(url)) { excluded.push({ id: hit.id, reason: 'Duplicate normalized requested URL.' }); continue; } urls.add(url);
    const normalized = hit.snippet.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase(); const dupe = normalized.length > 120 ? snippets.get(normalized) : undefined;
    if (dupe) { excluded.push({ id: hit.id, reason: `Identical substantial search snippet to ${dupe}; duplication clue, not proof of common ownership.` }); continue; }
    if (normalized.length > 120) snippets.set(normalized, hit.id);
    const hay = (hit.title + '\n' + hit.snippet).normalize('NFKC').toLowerCase(); const count = terms.filter(t => hay.includes(t)).length;
    candidates.push({ hit: { ...hit, url }, score: count, reasons: [`${count} literal question-term matches.`, 'Publication date and source role unverified; capture time is not publication time.'], role: 'unclassified', publishedAt: null });
  }
  candidates.sort((a, b) => b.score - a.score || a.hit.url.localeCompare(b.hit.url, 'en'));
  const selected: RankedDiscovery[] = []; const hosts = new Set<string>();
  for (const c of candidates) { const host = new URL(c.hit.url).hostname; if (selected.length < max && !hosts.has(host)) { selected.push({ ...c, reasons: [...c.reasons, 'Host diversity pass; different hosts are not necessarily independent sources.'] }); hosts.add(host); } }
  for (const c of candidates) if (selected.length < max && !selected.some(s => s.hit.id === c.hit.id)) selected.push(c);
  for (const c of candidates) if (!selected.some(s => s.hit.id === c.hit.id)) excluded.push({ id: c.hit.id, reason: 'Question relevance/diversity ordering and configured page budget.' });
  return { selected, excluded, interpretation: 'retrieval-order-not-truth-rating' as const };
}

export interface CitationBinding {
  id: string; markerStart: number; markerEnd: number; marker: string;
  sentenceStart: number; sentenceEnd: number; sentence: string;
  sourceId: string; snapshotId: string; excerptId: string | null; textHash: string;
  sourceStart: number; sourceEnd: number; quote: string; quoteHash: string;
  locator: string; title: string | null; startLine: number; endLine: number;
  assessment: 'reference-structure-only';
  quoteAssociation: 'source-entry-candidates-not-claim-support';
}
export interface CitationMap { version: 'citations-v1'; manuscriptHash: string; bindings: CitationBinding[] }
/** Stable evidence identities are independent of S1/S2 display numbering. */
export function mapCitations(draft: DraftOutput, sources: readonly SourceContextItem[]): CitationMap {
  const bindings: CitationBinding[] = []; const seen = new Set<string>();let markers=0,recordBytes=0;
  if ([...draft.markdown.matchAll(/\[\^S([^\]]*)\]/g)].some(m=>! /^[1-9]\d*$/.test(m[1]!))) throw new WriterError('INVALID_INPUT', 'Invalid source marker format.');
  const splits = (text: string, at: number) => at > 0 && at < text.length && /[\ud800-\udbff]/.test(text[at-1]!) && /[\udc00-\udfff]/.test(text[at]!);
  for (const match of draft.markdown.matchAll(/\[\^S([1-9]\d*)\]/g)) {
    if(++markers>512)throw new WriterError('INVALID_INPUT','Citation marker limit (512) exceeded; select a smaller document.');
    const i = Number(match[1]) - 1, source = sources[i];
    if (!source) throw new WriterError('INVALID_INPUT', 'Unknown candidate source marker.');
    const quotes = draft.citations.filter(q => q.itemIndex === i);
    if (!quotes.length) throw new WriterError('INVALID_INPUT', 'Citation marker lacks exact source quotation.');
    const markerStart = match.index, markerEnd = markerStart + match[0].length;
    let sentenceStart = markerStart;
    while (sentenceStart > 0 && !/[\n。！？!?]/u.test(draft.markdown[sentenceStart - 1]!)) sentenceStart--;
    // A punctuation mark immediately before a marker belongs to the preceding sentence.
    if (sentenceStart === markerStart && markerStart > 0) { sentenceStart--; while (sentenceStart > 0 && !/[\n。！？!?]/u.test(draft.markdown[sentenceStart - 1]!)) sentenceStart--; }
    const sentence = draft.markdown.slice(sentenceStart, markerEnd);
    for (const q of quotes) {
      if (!Number.isSafeInteger(q.start) || !Number.isSafeInteger(q.end) || q.start < 0 || q.end <= q.start || q.end > source.text.length || splits(source.text,q.start) || splits(source.text,q.end) || source.text.slice(q.start, q.end) !== q.quote) throw new WriterError('INVALID_INPUT', 'Citation quotation is not in its selected source.');
      const key = `${markerStart}:${source.snapshotId}:${source.startLine}:${q.start}:${q.end}:${hashBytes(q.quote)}`;
      if (seen.has(key)) continue; seen.add(key);
      recordBytes+=Buffer.byteLength(sentence)+Buffer.byteLength(q.quote)+1000;
      if(bindings.length>=2000||recordBytes>2_000_000)throw new WriterError('INVALID_INPUT','Citation map exceeds its bound; no partial map is saved.');
      bindings.push({ id: hashBytes(key), markerStart, markerEnd, marker: match[0], sentenceStart, sentenceEnd: markerEnd, sentence,
        sourceId: source.sourceId, snapshotId: source.snapshotId, excerptId: source.excerptId, textHash: source.textHash,
        sourceStart: q.start, sourceEnd: q.end, quote: q.quote, quoteHash: hashBytes(q.quote), locator: source.locator, title: source.title,
        startLine: source.startLine, endLine: source.endLine, assessment: 'reference-structure-only',quoteAssociation:'source-entry-candidates-not-claim-support' });
    }
  }
  for (const q of draft.citations) if (!bindings.some(b => b.snapshotId === sources[q.itemIndex]?.snapshotId && b.quote === q.quote)) throw new WriterError('INVALID_INPUT', 'Orphan quotation without candidate citation marker.');
  return { version: 'citations-v1', manuscriptHash: hashBytes(draft.markdown), bindings };
}
export function renderCitedDraft(draft: DraftOutput, sources: readonly SourceContextItem[]): { markdown: string; map: CitationMap } {
  mapCitations(draft, sources); const originalToNumber = new Map<number, number>(); const numbers = new Map<string, number>(); const entries: { number: number; source: SourceContextItem }[] = [];
  const markdown = draft.markdown.replace(/\[\^S([1-9]\d*)\]/g, (_marker, digits: string) => {
    const source = sources[Number(digits) - 1]!; const key = `${source.snapshotId}:${source.contentHash}:${source.startLine}:${source.endLine}`;
    if (!numbers.has(key)) { numbers.set(key, numbers.size + 1); entries.push({ number: numbers.size, source }); }
    originalToNumber.set(Number(digits)-1, numbers.get(key)! - 1);
    return `[^S${numbers.get(key)!}]`;
  });
  const safe = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/[\[\]<>`]/g, '');
  const notes = entries.map(({ number, source: s }) => `[^S${number}]: ${safe(s.title ?? 'Untitled source')} — ${s.origin?`MCP ${safe(s.origin.name)} (third-party result, not a direct page fetch); `:''}${safe(s.locator)}; snapshot ${s.snapshotId}; extracted-text lines ${s.startLine}–${s.endLine}. Reference only; support has not been certified.`);
  const mappedDraft = { ...draft, markdown, citations: draft.citations.map(q => ({ ...q, itemIndex: originalToNumber.get(q.itemIndex)! })) };
  const map = mapCitations(mappedDraft, entries.map(e => e.source));
  const full = markdown + (notes.length ? '\n\n' + notes.join('\n') : '');
  return { markdown: full, map: { ...map, manuscriptHash: hashBytes(full) } };
}
/** Rebase chapter display indices onto the frozen master source packet, not onto URLs. */
export function joinChapterDrafts(title: string, parts: { heading: string; draft: DraftOutput; sources: SourceContextItem[] }[], master: SourceContextItem[], identity: { runId: string; requestId: string }): DraftOutput {
  const citations: SourceQuote[] = []; const sections: string[] = []; const limitations: string[] = [];
  for (const part of parts) {
    const remap = part.sources.map(s => master.findIndex(m => m.snapshotId === s.snapshotId && m.contentHash === s.contentHash && m.startLine === s.startLine && m.endLine === s.endLine));
    if (remap.some(i => i < 0)) throw new WriterError('INVALID_INPUT', 'Chapter evidence is outside its frozen master selection.');
    mapCitations(part.draft, part.sources);
    const body = part.draft.markdown.replace(/\[\^S([1-9]\d*)\]/g, (_m, n: string) => `[^S${remap[Number(n) - 1]! + 1}]`);
    sections.push(`## ${part.heading}\n\n${body}`);
    citations.push(...part.draft.citations.map(q => ({ ...q, itemIndex: remap[q.itemIndex]! })));
    limitations.push(...part.draft.limitations);
  }
  const uniqueLimitations = [...new Set(limitations)];
  if (uniqueLimitations.length > 20) throw new WriterError('INVALID_INPUT', 'Combined chapter limitations exceed the report bound; none were silently dropped. Use a smaller outline.');
  return { protocolVersion: 1, task: 'draft', ...identity, title, markdown: sections.join('\n\n'), citations: [...new Map(citations.map(q => [JSON.stringify(q), q])).values()], limitations: uniqueLimitations };
}
