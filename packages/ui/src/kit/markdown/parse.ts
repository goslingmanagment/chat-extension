// A small, safe Markdown reader for model output (Recap, Coach answers,
// Review text; architecture.md §10.1 «Markdown разбирается один раз», §14,
// AI-137): text → an AST of a fixed set of nodes. Raw HTML is never
// interpreted — it stays text, and Preact escapes text. Links keep only
// https:// targets; anything else becomes its plain label. Pure, linear in
// the input with bounded nesting; no DOM.

export type MdInline =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'br' }
  | { readonly t: 'strong'; readonly c: readonly MdInline[] }
  | { readonly t: 'em'; readonly c: readonly MdInline[] }
  | { readonly t: 'code'; readonly v: string }
  | { readonly t: 'link'; readonly href: string; readonly c: readonly MdInline[] };

export type MdBlock =
  | { readonly t: 'p'; readonly c: readonly MdInline[] }
  | { readonly t: 'h'; readonly level: 1 | 2 | 3; readonly c: readonly MdInline[] }
  | { readonly t: 'ul'; readonly items: readonly (readonly MdBlock[])[] }
  | { readonly t: 'ol'; readonly start: number; readonly items: readonly (readonly MdBlock[])[] }
  | { readonly t: 'pre'; readonly v: string }
  | { readonly t: 'quote'; readonly c: readonly MdBlock[] }
  | { readonly t: 'hr' };

/** Longer input is cut (model output is far shorter; this bounds the work). */
export const MD_MAX_CHARS = 100_000;
/** Nesting of lists, quotes and inline emphasis. */
export const MD_MAX_DEPTH = 4;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const ITEM = /^( {0,12})([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const BLANK = /^[ \t]*$/;

/** Only https:// links survive (§14: nothing leads to an unknown scheme). */
export function safeHref(raw: string): string | null {
  const trimmed = raw.trim().replace(/^<|>$/g, '');
  if (!/^https:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const ESCAPABLE = new Set('\\`*_{}[]()#+-.!>~|'.split(''));

/** How far a closing delimiter is looked for: keeps unmatched `*`, `` ` `` and `[` cheap on long text. */
export const MD_MAX_SPAN = 4000;

type CloserKind = 'plain' | 'emphasis';

/**
 * Finds closing delimiters within MD_MAX_SPAN of where the opener ends.
 * Openers are tried left to right, so each search remembers what it scanned:
 * the next opener looks only past it. Model output is untrusted; a run of
 * unmatched `*` or `[` stays linear instead of rescanning the same span for
 * every opener.
 */
class Closers {
  private readonly memo = new Map<string, { start: number; end: number; at: number }>();
  constructor(private readonly text: string) {}

  /** The first `needle` at or after `from` (emphasis: not after whitespace or a backslash); -1 if none in the span. */
  find(needle: string, from: number, kind: CloserKind): number {
    const text = this.text;
    const limit = Math.min(text.length, from + MD_MAX_SPAN + needle.length);
    const key = `${kind}:${needle}`;
    const seen = this.memo.get(key);
    let scan = from;
    if (seen !== undefined && seen.start <= from) {
      if (seen.at >= from) return seen.at < limit ? seen.at : -1;
      if (seen.at === -1) scan = Math.max(from, seen.end);
    }
    for (let index = scan; index < limit; index += 1) {
      if (!text.startsWith(needle, index)) continue;
      if (kind === 'emphasis') {
        const before = text[index - 1];
        if (before === undefined || /\s/.test(before) || before === '\\') continue;
      }
      this.memo.set(key, { start: from, end: index + 1, at: index });
      return index;
    }
    const start = seen !== undefined && seen.start <= from && seen.at === -1 ? seen.start : from;
    this.memo.set(key, { start, end: Math.max(limit, seen?.end ?? 0), at: -1 });
    return -1;
  }
}

function pushText(out: MdInline[], value: string): void {
  if (value === '') return;
  const last = out[out.length - 1];
  if (last !== undefined && last.t === 'text') out[out.length - 1] = { t: 'text', v: last.v + value };
  else out.push({ t: 'text', v: value });
}

/** Inline content of one block: `**strong**`, `*em*` / `_em_`, `` `code` ``, `[label](https://…)`, bare https URLs, line breaks. */
export function parseInline(text: string, depth = 0, inLink = false): MdInline[] {
  const out: MdInline[] = [];
  const closers = new Closers(text);
  let index = 0;
  let plain = '';
  const flush = (): void => {
    pushText(out, plain);
    plain = '';
  };
  while (index < text.length) {
    const char = text[index] as string;
    const next = text[index + 1];
    if (char === '\\' && next !== undefined && ESCAPABLE.has(next)) {
      plain += next;
      index += 2;
      continue;
    }
    if (char === '\n') {
      flush();
      out.push({ t: 'br' });
      index += 1;
      continue;
    }
    if (char === '`') {
      let run = 1;
      while (text[index + run] === '`') run += 1;
      const fence = '`'.repeat(run);
      const close = closers.find(fence, index + run, 'plain');
      if (close !== -1) {
        flush();
        out.push({ t: 'code', v: text.slice(index + run, close).replace(/^ (.*) $/, '$1') });
        index = close + run;
        continue;
      }
      plain += fence;
      index += run;
      continue;
    }
    if (depth < MD_MAX_DEPTH && !inLink && char === '[') {
      const labelEnd = closers.find(']', index + 1, 'plain');
      if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const urlEnd = closers.find(')', labelEnd + 2, 'plain');
        if (urlEnd !== -1) {
          const label = text.slice(index + 1, labelEnd);
          const href = safeHref(text.slice(labelEnd + 2, urlEnd));
          flush();
          const children = parseInline(label, depth + 1, true);
          if (href === null) for (const child of children) out.push(child);
          else out.push({ t: 'link', href, c: children });
          index = urlEnd + 1;
          continue;
        }
      }
    }
    if (depth < MD_MAX_DEPTH && (char === '*' || char === '_') && next === char) {
      const marker = char + char;
      const close = closers.find(marker, index + 3, 'emphasis');
      if (close !== -1 && !/\s/.test(text[index + 2] ?? ' ')) {
        flush();
        out.push({ t: 'strong', c: parseInline(text.slice(index + 2, close), depth + 1, inLink) });
        index = close + 2;
        continue;
      }
    }
    if (depth < MD_MAX_DEPTH && (char === '*' || char === '_') && next !== undefined && !/\s/.test(next) && next !== char) {
      // `_` inside a word (snake_case) is not emphasis.
      const wordBefore = char === '_' && index > 0 && /[\p{L}\p{N}]/u.test(text[index - 1] ?? '');
      const close = wordBefore ? -1 : closers.find(char, index + 2, 'emphasis');
      const wordAfter = char === '_' && close !== -1 && /[\p{L}\p{N}]/u.test(text[close + 1] ?? '');
      if (close !== -1 && !wordAfter && text[close + 1] !== char) {
        flush();
        out.push({ t: 'em', c: parseInline(text.slice(index + 1, close), depth + 1, inLink) });
        index = close + 1;
        continue;
      }
    }
    if (!inLink && (char === 'h' || char === 'H') && /^https:\/\//i.test(text.slice(index, index + 8))) {
      const before = text[index - 1];
      if (before === undefined || !/[\p{L}\p{N}]/u.test(before)) {
        let end = index;
        while (end < text.length && !/[\s<>"]/.test(text[end] as string)) end += 1;
        while (end > index && /[.,;:!?)\]}'»]/.test(text[end - 1] as string)) end -= 1;
        const raw = text.slice(index, end);
        const href = safeHref(raw);
        if (href !== null) {
          flush();
          out.push({ t: 'link', href, c: [{ t: 'text', v: raw }] });
          index = end;
          continue;
        }
      }
    }
    plain += char;
    index += 1;
  }
  flush();
  return out;
}

/** A heading's text without trailing blanks and its closing `#`s («## Итог ##», not «C#»); loops, no backtracking. */
function trimHeading(text: string): string {
  const blank = (char: string | undefined): boolean => char === ' ' || char === '\t';
  let end = text.length;
  while (end > 0 && blank(text[end - 1])) end -= 1;
  let hashes = end;
  while (hashes > 0 && text[hashes - 1] === '#') hashes -= 1;
  if (hashes < end && (hashes === 0 || blank(text[hashes - 1]))) {
    end = hashes;
    while (end > 0 && blank(text[end - 1])) end -= 1;
  }
  return text.slice(0, end);
}

function parseBlocks(lines: readonly string[], depth: number): MdBlock[] {
  const blocks: MdBlock[] = [];
  let index = 0;
  let paragraph: string[] = [];
  const endParagraph = (): void => {
    if (paragraph.length > 0) blocks.push({ t: 'p', c: parseInline(paragraph.join('\n').trim(), 0) });
    paragraph = [];
  };
  while (index < lines.length) {
    const line = lines[index] as string;
    if (BLANK.test(line)) {
      endParagraph();
      index += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence !== null) {
      endParagraph();
      const marker = fence[1] as string;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] as string).trimStart().startsWith(marker)) {
        body.push(lines[index] as string);
        index += 1;
      }
      index += 1;
      blocks.push({ t: 'pre', v: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      endParagraph();
      const level = Math.min(3, (heading[1] as string).length) as 1 | 2 | 3;
      blocks.push({ t: 'h', level, c: parseInline(trimHeading(heading[2] ?? ''), 0) });
      index += 1;
      continue;
    }
    if (RULE.test(line) && paragraph.length === 0) {
      blocks.push({ t: 'hr' });
      index += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      endParagraph();
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index] as string)) {
        quoted.push(QUOTE.exec(lines[index] as string)?.[1] ?? '');
        index += 1;
      }
      blocks.push(depth < MD_MAX_DEPTH ? { t: 'quote', c: parseBlocks(quoted, depth + 1) } : { t: 'p', c: parseInline(quoted.join('\n'), 0) });
      continue;
    }
    const item = ITEM.exec(line);
    if (item !== null) {
      endParagraph();
      const indent = (item[1] as string).length;
      const ordered = /\d/.test((item[2] as string)[0] ?? '');
      const start = ordered ? Number.parseInt(item[2] as string, 10) : 1;
      const items: MdBlock[][] = [];
      while (index < lines.length) {
        const current = ITEM.exec(lines[index] as string);
        if (current === null || (current[1] as string).length !== indent || /\d/.test((current[2] as string)[0] ?? '') !== ordered) break;
        const body = [current[3] ?? ''];
        index += 1;
        // Continuation: indented deeper than the marker, or a lazy line that is not a new block.
        while (index < lines.length) {
          const next = lines[index] as string;
          if (BLANK.test(next)) {
            const after = lines[index + 1];
            if (after !== undefined && /^\s+/.test(after) && (after.match(/^\s*/)?.[0].length ?? 0) > indent) {
              body.push('');
              index += 1;
              continue;
            }
            break;
          }
          const nested = ITEM.exec(next);
          if (nested !== null && (nested[1] as string).length <= indent) break;
          const leading = next.match(/^\s*/)?.[0].length ?? 0;
          if (leading <= indent && (FENCE.test(next) || HEADING.test(next) || QUOTE.test(next))) break;
          body.push(next.slice(Math.min(leading, indent + 2)));
          index += 1;
        }
        items.push(depth < MD_MAX_DEPTH ? parseBlocks(body, depth + 1) : [{ t: 'p', c: parseInline(body.join('\n'), 0) }]);
      }
      blocks.push(ordered ? { t: 'ol', start, items } : { t: 'ul', items });
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  endParagraph();
  return blocks;
}

/** Markdown → blocks. Called once per finished text (never per streamed chunk). */
export function parseMarkdown(source: string): MdBlock[] {
  const text = source.length > MD_MAX_CHARS ? source.slice(0, MD_MAX_CHARS) : source;
  return parseBlocks(text.replace(/\r\n?/g, '\n').split('\n'), 0);
}

/** The plain text of an AST (copy, screen readers, tests). */
export function markdownText(blocks: readonly MdBlock[]): string {
  const inline = (nodes: readonly MdInline[]): string =>
    nodes.map((node) => (node.t === 'text' || node.t === 'code' ? node.v : node.t === 'br' ? '\n' : inline(node.c))).join('');
  const block = (node: MdBlock): string => {
    switch (node.t) {
      case 'p':
      case 'h':
        return inline(node.c);
      case 'pre':
        return node.v;
      case 'hr':
        return '';
      case 'quote':
        return node.c.map(block).join('\n');
      case 'ul':
      case 'ol':
        return node.items.map((item) => item.map(block).join('\n')).join('\n');
    }
  };
  return blocks.map(block).filter((part) => part !== '').join('\n\n');
}
