// A message's text as ChatSpace shows it — what the X8 fuse compares
// (architecture.md §6.7.6, decision X25). ChatSpace itself matches an echo to
// its queue by the text with the tags taken out, the entities decoded and the
// ends trimmed (`confirmEchoedMessage`); the platform may also hand back its
// own HTML for the same text (`<br />` for `<br>`, `<p>` per line, `&#39;`
// for a quote, an unescaped `&`). The fuse must trip on another text, never on
// such a rewrite, so the comparison is deliberately loose:
// - only real tags are taken out (`<` and a letter, or `</`): an unescaped
//   `a < b` stays text;
// - entities are decoded (named, decimal, hex); a text decoded once, twice,
//   or decoded before its tags were taken out counts as the same text;
// - every white space and zero-width mark is dropped (a line break that
//   became a paragraph, a space the platform trimmed), and the text is NFC.
// Two texts differ only when no form of one is a form of the other. A value
// that is not a string, or a very long one, is not compared at all. Nothing
// here keeps a text: the forms live as long as the send they belong to.

/** A longer text is not compared: not ours to judge (receipt.ts MAX_BODY). */
const MAX_TEXT = 65_536;
const TAG = /<\/?[A-Za-z][^<>]*>/g;
const ENTITY = /&(#[xX][0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g;
const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const INVISIBLE = /[\s\u200b-\u200d\u2060\ufeff]+/g;

const decode = (text: string): string =>
  text.replace(ENTITY, (whole: string, body: string) => {
    if (body.startsWith('#')) {
      const point = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    return NAMED[body] ?? whole;
  });

const squeeze = (text: string): string => text.normalize('NFC').replace(INVISIBLE, '');

/** The forms a text may take as shown; null — not a string, or too long to judge. The first form is the plain reading. */
export function shownForms(html: unknown): readonly string[] | null {
  if (typeof html !== 'string' || html.length > MAX_TEXT) return null;
  const bare = html.replace(TAG, '');
  return [...new Set([squeeze(decode(bare)), squeeze(decode(decode(bare))), squeeze(decode(html).replace(TAG, ''))])];
}

/** Whether `seen` shows the same text as the forms of ours; null — it cannot be told (not a string, too long). */
export function sameShown(ours: readonly string[] | null, seen: unknown): boolean | null {
  const theirs = shownForms(seen);
  if (ours === null || theirs === null) return null;
  return theirs.some((form) => ours.includes(form));
}
