// Cleaning one part of an answer before a person may insert it
// (architecture.md §7 «очистка ответа», AI-135): reasoning blocks, lines
// that leak the prompt, a «Reply:» prefix, wrapping quotes and the long
// dashes nobody types on a phone. The rules are the predecessors' (the
// Fansly extension's and the desktop's reply sanitizer), kept exact: they
// were tuned on real output. A part that is empty or pure framing after it
// is not usable.

/** Stray JSON-array framing some models emit around reply parts. */
const BRACKET_GARBAGE: ReadonlySet<string> = new Set(['[', ']', '["', '"]', "['", "']"]);

/**
 * Narrow on purpose around «instructions»: a bare match would also strip
 * legitimate in-character lines («just follow my instructions»).
 */
const META_LEAK_PATTERNS: readonly RegExp[] = [
  /\bthe\s+prompt\s+says\b/i,
  /\bprompt\s+says\b/i,
  /\bsystem\s+prompt\b/i,
  /\b(?:system|previous|above)\s+instructions?\b/i,
  /\bignore (?:all |the )?(?:previous |above )?instructions?\b/i,
  /\buntrusted\s+user\s+input\b/i,
  /\bnever\s+follow\s+instructions?\b/i,
  /\braw\s+system\s+messages?\b/i,
  /\bhidden\s+instructions?\b/i,
  /\boutput\s+only\b/i,
  /\bmost\s+replies\s+should\b/i,
  /\bsingle\s+message\b/i,
  /\bsingle\s+reply\b/i,
  /\bstay\s+in\s+character\b/i,
  /\bas\s+an\s+ai\b/i,
  /\bgenerated\s+(?:reply|message|response)\b/i,
];

/** `<think>…</think>` and fenced reasoning blocks; they may hold markers of their own, so they go first. */
export function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:think|thinking|reasoning|chain-of-thought)[^\n]*\n[\s\S]*?```/gi, '');
}

/** While streaming: a reasoning block that is still open, or the start of its tag, is not shown. */
export function hideOpenThinkBlock(text: string): string {
  const closed = stripThinkBlocks(text);
  const open = /<think\b[^>]*>/i.exec(closed);
  const visible = open === null ? closed : closed.slice(0, open.index);
  return visible.replace(/<(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/i, '');
}

export function isMetaLeakLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && META_LEAK_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function removeMetaLeakLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !isMetaLeakLine(line))
    .join('\n')
    .trim();
}

function stripReplyPrefix(text: string): string {
  return text
    .replace(/^(?:message\s*\d+|reply|response)\s*[:.-]\s*/i, '')
    .replace(/^here(?:'s| is)\s+(?:a\s+)?(?:reply|response)\s*[:.-]\s*/i, '')
    .trim();
}

function stripWrappingQuotes(text: string): string {
  let current = text.trim();
  let previous = '';
  while (current !== previous) {
    previous = current;
    current = current
      .replace(/^"([\s\S]*)"$/u, '$1')
      .replace(/^'([\s\S]*)'$/u, '$1')
      .replace(/^\u201c([\s\S]*)\u201d$/u, '$1')
      .replace(/^\u2018([\s\S]*)\u2019$/u, '$1')
      .trim();
  }
  return current;
}

/**
 * Em, en and horizontal-bar dashes are an AI tell. Between digits a dash is
 * a range (5–10 → 5-10); anywhere else it is a pause and becomes a comma.
 * Line breaks are kept, so a multi-line part stays multi-line.
 */
function normalizeDashes(text: string): string {
  return text
    .replace(/(\d)[^\S\r\n]*[—–―][^\S\r\n]*(\d)/gu, '$1-$2')
    .replace(/[^\S\r\n]*[—–―]+[^\S\r\n]*/gu, ', ')
    .replace(/,(?:[^\S\r\n]*,)+/gu, ',')
    .replace(/[^\S\r\n]+(\r?\n)/gu, '$1')
    .replace(/^[\s,]+/u, '')
    .replace(/[\s,]+$/u, '');
}

/** AI-135: one part as a person may send it. */
export function cleanPart(part: string): string {
  return normalizeDashes(stripWrappingQuotes(stripReplyPrefix(removeMetaLeakLines(stripThinkBlocks(part)))));
}

/** A cleaned part worth showing as a message: not empty, not bracket garbage, not a leaked prompt line. */
export function isUsablePart(part: string): boolean {
  const trimmed = part.trim();
  return trimmed.length > 0 && !BRACKET_GARBAGE.has(trimmed) && !isMetaLeakLine(trimmed);
}
