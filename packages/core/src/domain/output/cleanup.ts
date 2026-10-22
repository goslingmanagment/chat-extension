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

// The reasoning rules are the hub's (prompts/output/reply-output.ts,
// hub#621); the copies behave the same.

/** The tag names a model puts its reasoning in; a suffix after an underscore counts too (`<thinking_mode>`). */
const REASONING_TAG_NAMES: readonly string[] = ['think', 'thinking', 'reasoning', 'mental_model'];

/**
 * A reasoning block closes with its own tag name, in any case. `<think\b`
 * alone missed the `<thinking>`, `<reasoning>`, `<thinking_mode>` and
 * `<mental_model>` blocks Opus 5.5 leaked into drafts on 2026-10-09..14.
 */
const REASONING_BLOCK = /<((?:think|thinking|reasoning|mental_model)(?:_\w+)?)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/**
 * A block that never closes counts from a bare tag that opens the text or
 * its own line, so «omg <thinking of you> all day» stays whole. It runs after
 * the fences are gone: an opener quoted inside one cuts nothing.
 */
const OPEN_REASONING_BLOCK = /(?:^|\n)\s*<(?:think|thinking|reasoning|mental_model)(?:_\w+)?>[\s\S]*$/i;

/** While streaming, any opener may still close. */
const REASONING_OPENER = /<(?:think|thinking|reasoning|mental_model)(?:_\w+)?\b[^>]*>/i;

/** Reasoning blocks, closed, fenced or never closed; they may hold markers of their own, so they go first. */
export function stripThinkBlocks(text: string): string {
  return text
    .replace(REASONING_BLOCK, '')
    .replace(/```(?:think|thinking|reasoning|chain-of-thought)[^\n]*\n[\s\S]*?```/gi, '')
    .replace(OPEN_REASONING_BLOCK, '');
}

/** `<`, `<thi`, `<reasoning`, `<thinking_mo`: the end of the stream may still become an opener. */
function mayOpenReasoning(name: string): boolean {
  const lower = name.toLowerCase();
  return REASONING_TAG_NAMES.some((tag) => tag.startsWith(lower) || lower.startsWith(`${tag}_`));
}

/** While streaming: a reasoning block that is still open, or the start of its tag, is not shown. */
export function hideOpenThinkBlock(text: string): string {
  const closed = stripThinkBlocks(text);
  const open = REASONING_OPENER.exec(closed);
  const visible = open === null ? closed : closed.slice(0, open.index);
  const tail = /<(\w*)$/.exec(visible);
  return tail !== null && mayOpenReasoning(tail[1] ?? '') ? visible.slice(0, tail.index) : visible;
}

/**
 * Reasoning written as plain text: a line that checks the house style rules
 * («No long dashes.», «no em dash, no full stop at end»), says «Cold opener»
 * or opens with «Fan writes…». None of 39,214 production generations said
 * these outside such reasoning (hub, 2026-10-16). «no dash» needs an end of
 * phrase after it, so «no dash cam» stays.
 *
 * And a draft the model goes on to correct: Ari's Hi opens with the persona's
 * own sample, then «Wait, that copies the sample opener exactly. Vary it.»,
 * a check of the username rule («not a guess about him»), or a label of the
 * draft it settles on («Final:», «Better:», «so a fresher version:»). None of
 * 46,143 production generations said these outside such reasoning (hub,
 * 2026-10-22); «sample» alone stays, a girl may offer one.
 */
const PLAN_NOTE_PATTERNS: readonly RegExp[] = [
  /\b(?:em|en|long)\s+dash(?:es)?\b/i,
  /\bno\s+dash(?:es\b|\s*[.,;)]|\s*$)/i,
  /\bno\s+(?:final\s+)?full\s+stop\b/i,
  /\bfull\s+stop\s+at\s+(?:the\s+)?end\b/i,
  /\bcold\s+opener\b/i,
  /^\s*(?:the\s+)?fan\s+(?:just\s+)?(?:writes|wrote|asks|asked|says|said|joked|replied|mentioned)\b/i,
  /\bsample\s+openers?\b/i,
  /\b(?:cop(?:y|ies|ying)|close\s+to|identical\s+to|word[\s-]+for[\s-]+word)\b.*\b(?:samples?|style\s+example)\b/i,
  /\b(?:samples?|style\s+example)\b.*\b(?:verbatim|word[\s-]+for[\s-]+word|vary)\b/i,
  /\bcop(?:y|ying)\s+(?:that|it|this)\s+(?:exactly|verbatim)\b/i,
  /(?:^|[.,;:!?]\s*|\b(?:me|should)\s+)vary(?:\s+(?:it|this|wording|the\s+wording))?\s*[.:!]?\s*$/i,
  /\b(?:jok(?:e|es|ing)\s+about\s+(?:the\s+|his\s+|what\s+(?:his\s+)?)?username|username\s+(?:jab|joke)|guess(?:es|ing)?\s+about\s+him|his\s+username)\b/i,
  /\boutput\s+(?:only\s+)?one\b/i,
  /(?:^|[.!?,]\s*)(?:final|better|revised|fix|correction|simpler|the\s+final\s+one)(?:,[^:\n]*)?\s*:\s*$/i,
  /\b(?:fresher|cleaner)\s+(?:version|take|one)\s*:\s*$/i,
  /\blet\s+me\s+(?:make\s+it\s+(?:clean|cleaner|simpler)|redo\s+that)\b/i,
];

function isPlanNoteLine(line: string): boolean {
  return PLAN_NOTE_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Within one part, the text after the last plan-note line is the reply;
 * before it is the plan or a draft the model went on to correct. With
 * nothing after it, the plan-note lines alone go. It runs on a part, never
 * across `[NEXT]` or `[VARIANT]`.
 */
function stripPlanNotes(text: string): string {
  const lines = text.split('\n');
  let last = -1;
  lines.forEach((line, index) => {
    if (isPlanNoteLine(line)) last = index;
  });
  if (last < 0) return text;
  const after = lines.slice(last + 1).join('\n');
  return after.trim().length > 0 ? after : lines.filter((line) => !isPlanNoteLine(line)).join('\n');
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
  return normalizeDashes(stripWrappingQuotes(stripReplyPrefix(removeMetaLeakLines(stripPlanNotes(stripThinkBlocks(part))))));
}

/** A cleaned part worth showing as a message: not empty, not bracket garbage, not a leaked prompt line. */
export function isUsablePart(part: string): boolean {
  const trimmed = part.trim();
  return trimmed.length > 0 && !BRACKET_GARBAGE.has(trimmed) && !isMetaLeakLine(trimmed);
}
