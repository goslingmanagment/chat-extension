// OnlyMonster's notes as the panel's text (2026-10-28): a note's lines joined with `\n`, and back. A note's body is HTML
// of ChatSpace's editor when it starts with `<p` or `<ul` — ChatSpace's own test (0.233.0, its note card) —, else plain
// text, lines by `\n`.
// - Reading HTML: block elements (`p`, `li`, `h1`…`h6`, `blockquote`, `div`, `pre`) and `br` end a line, tags are
//   stripped, entities decoded, whitespace collapsed as a browser shows it; an empty paragraph is an empty line.
// - Writing: a note that came as plain text, or a new one, is written as plain text. One that came as HTML keeps the
//   HTML of every line left as it was (the lines matched in order, the longest common run), and each changed or new
//   line becomes a `<p>` of its own with escaped text — so Monster's formatting of the other lines survives. A block
//   whose lines all stay, together, keeps its own HTML; a list's items that stay, together, keep their list; a kept
//   line of a block that did not stay whole keeps its own inline HTML in a `<p>`.
// Pure: no DOM (the background and the tests have none) — a small tokenizer.

/** ChatSpace's test of a note's body: HTML when it starts with `<p` or `<ul` (anything else it shows as plain text). */
const HTML_NOTE = /^\s*<(?:p|ul)[\s>]/;

export const isOmNoteHtml = (raw: string): boolean => HTML_NOTE.test(raw);

/** Elements that end a line (and begin one). */
const BLOCKS: ReadonlySet<string> = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'div', 'pre']);
/** Lists: their items are lines; the list itself is none. */
const LISTS: ReadonlySet<string> = new Set(['ul', 'ol']);
/** Elements with no content and no closing tag. */
const VOID: ReadonlySet<string> = new Set(['br', 'hr', 'img', 'wbr', 'input', 'col', 'area', 'base', 'link', 'meta', 'source', 'track', 'embed', 'param']);
const NAMED: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
]);
/** Above this many cells of the matching table, lines are matched one by one in order (a note of thousands of lines). */
const TABLE_CELLS = 1_000_000;

type Token =
  | { readonly kind: 'open'; readonly name: string; readonly start: number; readonly end: number }
  | { readonly kind: 'close'; readonly name: string; readonly start: number; readonly end: number }
  | { readonly kind: 'text'; readonly start: number; readonly end: number }
  | { readonly kind: 'skip'; readonly start: number; readonly end: number };

interface Line {
  /** What the person sees: tags stripped, entities decoded, whitespace collapsed. */
  readonly text: string;
  /** The line's own inline HTML, its open inline elements closed: a `<p>` of it shows the line as it was. */
  readonly inner: string;
}

interface List {
  readonly raw: string;
  readonly open: string;
  readonly close: string;
}

/** A piece of the note that makes whole lines: a top-level block, a top-level run of loose content, or a list's item. */
interface Unit {
  readonly raw: string;
  readonly lines: readonly Line[];
  readonly list: List | null;
  /** The item's place in its list. */
  readonly item: number;
}

/** The end of a tag that starts at `start` (`<`): after its `>`, quotes of attribute values respected; unterminated — the text's end. */
const tagEnd = (html: string, start: number): number => {
  let quote: string | null = null;
  for (let at = start + 1; at < html.length; at += 1) {
    const char = html[at];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return at + 1;
  }
  return html.length;
};

const LETTER = /[A-Za-z]/;

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let text = 0;
  let at = 0;
  while (at < html.length) {
    const lt = html.indexOf('<', at);
    if (lt < 0) break;
    const next = html.charAt(lt + 1);
    let token: Token | null = null;
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      token = { kind: 'skip', start: lt, end: close < 0 ? html.length : close + 3 };
    } else if (next === '!' || next === '?') {
      const close = html.indexOf('>', lt);
      token = { kind: 'skip', start: lt, end: close < 0 ? html.length : close + 1 };
    } else if (LETTER.test(next) || (next === '/' && LETTER.test(html.charAt(lt + 2)))) {
      const end = tagEnd(html, lt);
      const name = (/^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(html.slice(lt, end))?.[1] ?? '').toLowerCase();
      token = { kind: next === '/' ? 'close' : 'open', name, start: lt, end };
    }
    // A `<` that starts no tag is text.
    if (token === null) {
      at = lt + 1;
      continue;
    }
    if (lt > text) tokens.push({ kind: 'text', start: text, end: lt });
    tokens.push(token);
    at = text = token.end;
  }
  if (html.length > text) tokens.push({ kind: 'text', start: text, end: html.length });
  return tokens;
}

/** Entities decoded: the named few, and any number of a character. */
const decode = (text: string): string =>
  text.replace(/&(#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g, (whole, body: string) => {
    if (body.charAt(0) !== '#') return NAMED.get(body) ?? whole;
    const code = body.charAt(1) === 'x' || body.charAt(1) === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : whole;
  });

/** A line as it shows: whitespace (non-breaking spaces too) collapsed to one space, none at either end. */
const shown = (text: string): string => text.replace(/\s+/g, ' ').trim();

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const paragraph = (inner: string): string => `<p>${inner}</p>`;

/** The lines of tokens `from`…`to` (inclusive). */
function linesOf(html: string, tokens: readonly Token[], from: number, to: number): Line[] {
  const lines: Line[] = [];
  /** The line in progress; null — none (between blocks). */
  let line: { text: string; inner: string } | null = null;
  /** The line in progress began at a `br`: a block that ends there adds no empty line. */
  let afterBreak = false;
  /** Inline elements open in the line: closed at its end, opened again on the next line of the same block. */
  const open: { readonly name: string; readonly raw: string }[] = [];
  const begin = (): { text: string; inner: string } => ({ text: '', inner: open.map((tag) => tag.raw).join('') });
  const emit = (): void => {
    if (line === null) return;
    lines.push({ text: shown(line.text), inner: line.inner + open.map((tag) => `</${tag.name}>`).reverse().join('') });
    line = null;
  };
  for (let index = from; index <= to; index += 1) {
    const token = tokens[index] as Token;
    const raw = html.slice(token.start, token.end);
    if (token.kind === 'skip') continue;
    if (token.kind === 'text') {
      const text = decode(raw);
      const blank = text.trim() === '';
      if (line === null && blank) continue;
      line ??= begin();
      line.text += text;
      line.inner += raw;
      if (!blank) afterBreak = false;
      continue;
    }
    const { name } = token;
    if (name === 'br') {
      line ??= begin();
      emit();
      line = begin();
      afterBreak = true;
    } else if (BLOCKS.has(name) || LISTS.has(name)) {
      // A block's start ends the line before it; an empty line just begun (`<li><p>`) is the same line. Its end ends it,
      // empty too (`<p></p>`), unless only a `br` made it (`<p>a<br></p>` is one line, as a browser shows it).
      if (token.kind === 'open' ? line !== null && line.text.trim() !== '' : line !== null && !(afterBreak && line.text.trim() === '')) emit();
      open.length = 0;
      line = token.kind === 'open' && BLOCKS.has(name) ? begin() : null;
      afterBreak = false;
    } else if (token.kind === 'open') {
      line ??= begin();
      line.inner += raw;
      if (!VOID.has(name)) open.push({ name, raw });
    } else {
      const at = open.map((tag) => tag.name).lastIndexOf(name);
      if (at >= 0) open.length = at;
      if (line !== null) line.inner += raw;
    }
  }
  if (line !== null && (line as { text: string }).text.trim() !== '') emit();
  return lines;
}

/** The index of the token that closes the element opened at `start`; unterminated — the last token. */
function closingOf(tokens: readonly Token[], start: number): number {
  const opened = tokens[start] as Token & { readonly name: string };
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index] as Token;
    if (token.kind === 'open' && token.name === opened.name) depth += 1;
    else if (token.kind === 'close' && token.name === opened.name && --depth === 0) return index;
  }
  return tokens.length - 1;
}

const startsBlock = (token: Token | undefined): boolean => token !== undefined && token.kind === 'open' && (BLOCKS.has(token.name) || LISTS.has(token.name));

/** The note's units, in order. */
function unitsOf(html: string): Unit[] {
  const tokens = tokenize(html);
  const units: Unit[] = [];
  const slice = (from: number, to: number): string => html.slice((tokens[from] as Token).start, (tokens[to] as Token).end);
  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index] as Token;
    if (token.kind === 'open' && LISTS.has(token.name)) {
      const end = closingOf(tokens, index);
      const last = tokens[end] as Token;
      const closed = last.kind === 'close' && last.name === token.name && end > index;
      const list: List = { raw: slice(index, end), open: slice(index, index), close: closed ? slice(end, end) : '' };
      let item = 0;
      for (let inner = index + 1; inner < (closed ? end : end + 1); ) {
        const child = tokens[inner] as Token;
        if (child.kind === 'open' && child.name === 'li') {
          const close = Math.min(closingOf(tokens, inner), closed ? end - 1 : end);
          units.push({ raw: slice(inner, close), lines: linesOf(html, tokens, inner, close), list, item });
          item += 1;
          inner = close + 1;
        } else inner += 1;
      }
      index = end + 1;
    } else if (token.kind === 'open' && BLOCKS.has(token.name)) {
      const end = closingOf(tokens, index);
      units.push({ raw: slice(index, end), lines: linesOf(html, tokens, index, end), list: null, item: 0 });
      index = end + 1;
    } else {
      // Loose content up to the next block or list: lines of its own when it shows any.
      let end = index;
      while (end + 1 < tokens.length && !startsBlock(tokens[end + 1])) end += 1;
      const lines = linesOf(html, tokens, index, end);
      if (lines.length > 0) units.push({ raw: slice(index, end), lines, list: null, item: 0 });
      index = end + 1;
    }
  }
  return units;
}

/** The note's text as the panel shows it: its lines joined with `\n`. */
export function omNoteText(raw: string): string {
  if (!isOmNoteHtml(raw)) return raw.replace(/\r\n?/g, '\n');
  return unitsOf(raw)
    .flatMap((unit) => unit.lines.map((line) => line.text))
    .join('\n');
}

/** For each wanted line, the index of the old line it keeps (in order, the longest common run), or -1 — a new line. */
function align(old: readonly string[], wanted: readonly string[]): number[] {
  const match = Array.from<number>({ length: wanted.length }).fill(-1);
  if (old.length * wanted.length > TABLE_CELLS) {
    for (let from = 0, index = 0; index < wanted.length; index += 1) {
      const found = old.indexOf(wanted[index] as string, from);
      if (found >= 0) {
        match[index] = found;
        from = found + 1;
      }
    }
    return match;
  }
  const width = wanted.length + 1;
  const table = new Uint32Array((old.length + 1) * width);
  for (let i = old.length - 1; i >= 0; i -= 1) {
    for (let j = wanted.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = old[i] === wanted[j] ? (table[(i + 1) * width + j + 1] as number) + 1 : Math.max(table[(i + 1) * width + j] as number, table[i * width + j + 1] as number);
    }
  }
  for (let i = 0, j = 0; i < old.length && j < wanted.length; ) {
    if (old[i] === wanted[j]) {
      match[j] = i;
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] as number) >= (table[i * width + j + 1] as number)) i += 1;
    else j += 1;
  }
  return match;
}

/**
 * The body to write for the panel's `text` (lines joined with `\n`) of a note whose body was `original` (null — a new
 * note). '' — nothing to write: a note with nothing left is deleted, never written blank.
 */
export function omNoteWrite(original: string | null, text: string): string {
  const next = text.replace(/\r\n?/g, '\n');
  if (next.trim() === '') return '';
  const wanted = next.split('\n');
  if (original === null || !isOmNoteHtml(original)) {
    // Plain stays plain — unless ChatSpace would take the text for HTML: then it goes as paragraphs, shown as typed.
    return isOmNoteHtml(next) ? wanted.map((line) => paragraph(escapeHtml(line))).join('') : next;
  }
  if (next === omNoteText(original)) return original;

  const units = unitsOf(original);
  const firsts: number[] = [];
  const old: { readonly text: string; readonly unit: number; readonly line: Line }[] = [];
  units.forEach((unit, index) => {
    firsts.push(old.length);
    for (const line of unit.lines) old.push({ text: line.text, unit: index, line });
  });
  const match = align(
    old.map((line) => line.text),
    wanted,
  );
  /** Old lines `first`…`first + count - 1` are kept, together and in order, as wanted lines from `at` on. */
  const kept = (first: number, count: number, at: number): boolean => {
    for (let offset = 0; offset < count; offset += 1) if (match[at + offset] !== first + offset) return false;
    return true;
  };

  const pieces: { readonly html: string; readonly lines: readonly Line[] }[] = [];
  /** List items kept together, in the list they came from, while they last. */
  interface Group {
    readonly list: List;
    last: number;
    html: string;
    readonly lines: Line[];
  }
  let group: Group | null = null;
  /** The group as it is now (closeGroup changes it behind the flow's back). */
  const openGroup = (): Group | null => group;
  const closeGroup = (): void => {
    if (group === null) return;
    pieces.push({ html: group.html + group.list.close, lines: group.lines });
    group = null;
  };
  for (let at = 0; at < wanted.length; ) {
    const index = match[at] as number;
    if (index < 0) {
      closeGroup();
      pieces.push({ html: paragraph(escapeHtml(wanted[at] as string)), lines: [] });
      at += 1;
      continue;
    }
    const { unit: u, line } = old[index] as (typeof old)[number];
    const unit = units[u] as Unit;
    if (index !== firsts[u] || !kept(index, unit.lines.length, at)) {
      // A line of a piece that did not stay whole: its own inline HTML in a paragraph.
      closeGroup();
      pieces.push({ html: paragraph(line.inner), lines: [line] });
      at += 1;
      continue;
    }
    if (unit.list === null) {
      closeGroup();
      pieces.push({ html: unit.raw, lines: unit.lines });
      at += unit.lines.length;
      continue;
    }
    const current = openGroup();
    if (current !== null && current.list === unit.list && current.last === unit.item - 1) {
      current.html += unit.raw;
      current.lines.push(...unit.lines);
      current.last = unit.item;
      at += unit.lines.length;
      continue;
    }
    closeGroup();
    // The whole list, unchanged and together: as it was.
    const items = units.filter((other) => other.list === unit.list);
    const count = items.reduce((sum, item) => sum + item.lines.length, 0);
    if (unit.item === 0 && kept(index, count, at)) {
      pieces.push({ html: unit.list.raw, lines: items.flatMap((item) => item.lines) });
      at += count;
      continue;
    }
    group = { list: unit.list, last: unit.item, html: unit.list.open + unit.raw, lines: [...unit.lines] };
    at += unit.lines.length;
  }
  closeGroup();

  // ChatSpace takes a body for HTML only by its start: a first piece that starts otherwise goes as paragraphs of its lines.
  const head = pieces[0];
  if (head !== undefined && !isOmNoteHtml(head.html) && head.lines.length > 0) pieces[0] = { html: head.lines.map((line) => paragraph(line.inner)).join(''), lines: head.lines };
  return pieces.map((piece) => piece.html).join('');
}
