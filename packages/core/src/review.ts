import type { ReviewHint } from './types.js';
import { validateText } from './document.js';

/** Deliberately limited, inspectable rules. Never use these hints as proof of intent or source support. */
export function reviewTextChange(before: string, after: string): ReviewHint[] {
  validateText(before); validateText(after);
  const hints: ReviewHint[] = [];
  const patterns = {
    uncertainty: /可能|或许|也许|似乎|\bmay\b|\bmight\b|\bcould\b/gi,
    attribution: /研究人员认为|一些研究认为|据报道|\baccording to\b|\bresearchers? (?:say|believe)\b/gi,
    causality: /导致|造成|\bcaus(?:e[sd]?|ing)\b|\bled to\b/gi,
    scope: /部分|一些|某些|\bsome\b|\ba subset\b/gi,
  };
  const found = (text: string, pattern: RegExp): string[] => text.match(pattern) ?? [];
  const removed = (pattern: RegExp) => found(before, pattern).length > 0 && found(after, pattern).length === 0;
  const add = (code: ReviewHint['code'], message: string, triggers: string[]) => {
    hints.push({ code, detector: 'lexical-v1', message, triggers });
  };
  if (removed(patterns.uncertainty)) add('certainty-increase', '不确定性用语消失：可能提高了断言强度，请人工核对。', found(before, patterns.uncertainty));
  if (removed(patterns.attribution)) add('attribution-removed', '归因用语消失：可能把他人判断改成直接断言，请人工核对。', found(before, patterns.attribution));
  if (found(before, patterns.causality).length === 0 && found(after, patterns.causality).length > 0) add('causality-added', '出现新的因果用语：当前规则未核验因果证据。', found(after, patterns.causality));
  if (removed(patterns.scope)) add('scope-widened', '范围限定词消失：适用范围可能扩大，请人工核对。', found(before, patterns.scope));
  return hints;
}
