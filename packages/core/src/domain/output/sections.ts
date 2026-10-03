// Labelled blocks and numbered items inside analysis text (AI-053, AI-084).
// The hub's Review and Coach prompts pin block labels at line starts
// («ВЕРДИКТ:», «СИТУАЦИЯ:» …) and number the mistakes, each with a «Как надо
// было:» replacement message. These readers split that text for DISPLAY
// only: the stored answer and the copy text stay the raw string. Labels
// absent (an older answer, a format slip) → null and the caller shows plain
// text. Pure text in, plain strings out; nothing here is markup.

export interface SectionSpec<K extends string> {
  /** The label exactly as the prompt pins it (line start, then a colon). */
  readonly label: string;
  readonly kind: K;
}

export interface LabelledSections<K extends string> {
  /** Text before the first label. */
  readonly lead: string;
  readonly sections: readonly { readonly kind: K; readonly body: string }[];
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Splits on the pinned labels at line starts. At least two labelled blocks
 * with a body are needed: one accidental «РИСК:» inside prose must not flip
 * the whole layout.
 */
export function splitLabelledSections<K extends string>(raw: string, specs: readonly SectionSpec<K>[]): LabelledSections<K> | null {
  const byLabel = new Map(specs.map((spec) => [spec.label.toUpperCase(), spec]));
  const labelRe = new RegExp(`^[ \\t]*(${specs.map((spec) => escapeRegExp(spec.label)).join('|')})[ \\t]*:`, 'gimu');
  const hits: { kind: K; start: number; bodyStart: number }[] = [];
  for (const match of raw.matchAll(labelRe)) {
    const spec = byLabel.get((match[1] ?? '').toUpperCase());
    if (spec === undefined) continue;
    hits.push({ kind: spec.kind, start: match.index, bodyStart: match.index + match[0].length });
  }
  if (hits.length < 2) return null;
  const sections: { kind: K; body: string }[] = [];
  hits.forEach((hit, index) => {
    const end = hits[index + 1]?.start ?? raw.length;
    const body = raw.slice(hit.bodyStart, end).trim();
    if (body.length > 0) sections.push({ kind: hit.kind, body });
  });
  if (sections.length < 2) return null;
  return { lead: raw.slice(0, hits[0]?.start ?? 0).trim(), sections };
}

export interface NumberedItem {
  readonly body: string;
  /** The «Как надо было:» tail — a ready-to-send example. */
  readonly fix: string | null;
  /** The marker's placement note («после "[Photo]"»), parentheses stripped. */
  readonly fixWhere: string | null;
  /** Commentary after an unambiguous quoted example, outside the fan text. */
  readonly afterFix: string | null;
}

const ITEM_START_RE = /^[ \t]*\d{1,2}[.)][ \t]+/gm;
/**
 * The marker sits mid-sentence in real output and often carries a
 * parenthetical placement note before the colon; the trailing colon or dash
 * keeps ordinary prose («я объясню, как надо было») from matching.
 */
const FIX_MARKER_RE = /[«"]?как надо было[»"]?[ \t]*(?:\(([^)\n]{1,120})\))?[ \t]*[:\-—–][ \t]*/i;

const QUOTE_PAIRS = [
  ['"', '"'],
  ['\u201c', '\u201d'],
  ['«', '»'],
] as const;

/** «"кстати, вижу…"» → «кстати, вижу…» — only when ONE pair wraps it all. */
function stripOneWrappingPair(text: string): string {
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length > 2 && text.startsWith(open) && text.endsWith(close) && !text.slice(1, -1).includes(open === close ? open : close)) {
      return text.slice(1, -1).trim();
    }
  }
  return text;
}

/**
 * Splits a clearly delimited leading quote from the prose after it. Unquoted
 * replies, unmatched or nested quotes keep the whole tail as the example.
 */
function splitQuotedFix(text: string): { readonly fix: string; readonly afterFix: string } | null {
  for (const [open, close] of QUOTE_PAIRS) {
    if (!text.startsWith(open)) continue;
    let closing = -1;
    for (let i = 1; i < text.length; i += 1) {
      const char = text[i];
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char !== open && char !== close) continue;
      if (char !== close) return null;
      closing = i;
      break;
    }
    if (closing <= 1) return null;
    const fix = text.slice(1, closing).trim();
    const remainder = text.slice(closing + 1);
    // Sentence punctuation may sit right outside the quotation marks: it belongs to the commentary.
    if (!/^(?:\s|[.,;:!?—–-](?:\s|$))/.test(remainder)) return null;
    const afterFix = remainder.trim();
    const commentary = afterFix.replace(/^[.,;:!?—–-]+\s*/, '');
    // A second quoted alternative is not an explanatory tail.
    if (/^(?:or|alternatively|или|либо|(?:ещ[её]|другой|второй)\s+вариант|вариант\s*\d)(?=$|[\s:—–-])/iu.test(commentary)) return null;
    const hasMoreDelimiters = [...afterFix.matchAll(/(?<!\\)["\u201c\u201d«»]/gu)].some((match) => match[0] === open || match[0] === close);
    if (hasMoreDelimiters && !/^\p{Script=Cyrillic}/u.test(commentary)) return null;
    return fix.length > 0 && afterFix.length > 0 ? { fix, afterFix } : null;
  }
  return null;
}

function parseItem(text: string, withFix: boolean): NumberedItem {
  const marker = withFix ? FIX_MARKER_RE.exec(text) : null;
  if (marker === null) return { body: text, fix: null, fixWhere: null, afterFix: null };
  const tail = text.slice(marker.index + marker[0].length).trim();
  const quoted = splitQuotedFix(tail);
  const fix = quoted?.fix ?? stripOneWrappingPair(tail);
  return {
    body: text.slice(0, marker.index).trim(),
    fix: fix.length > 0 ? fix : null,
    fixWhere: marker[1]?.trim() || null,
    afterFix: quoted?.afterFix ?? null,
  };
}

/** `1. …`, `2) …` items at line starts; `withFix` also lifts the «Как надо было:» example out of each. */
export function splitNumberedItems(body: string, withFix: boolean): { readonly lead: string; readonly items: readonly NumberedItem[] } {
  const starts = [...body.matchAll(ITEM_START_RE)].map((match) => ({ start: match.index, bodyStart: match.index + match[0].length }));
  const items = starts.map((hit, index) => parseItem(body.slice(hit.bodyStart, starts[index + 1]?.start ?? body.length).trim(), withFix));
  return { lead: body.slice(0, starts[0]?.start ?? body.length).trim(), items };
}
