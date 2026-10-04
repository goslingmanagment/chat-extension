// core/domain/text — text helpers shared with host-chatspace/isolated (§4).

/** Normalizes line endings to `\n`; the composer and the hub both expect LF. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntity(match: string, body: string): string {
  if (body.startsWith('#')) {
    const hex = body[1] === 'x' || body[1] === 'X';
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    // Lone surrogates and out-of-range numbers stay as written.
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
    return String.fromCodePoint(code);
  }
  return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? (NAMED_ENTITIES[body] as string) : match;
}

/**
 * RU-002: OnlyFans message HTML → plain text, without a DOM. `<br>` and
 * paragraph ends become newlines, every other tag is dropped, entities are
 * decoded once and last (so `&lt;b&gt;` stays the literal text `<b>` and
 * `&amp;lt;` becomes `&lt;`, never `<`), NBSP becomes a space. Unknown
 * entities stay as written. The result is trimmed.
 */
export function htmlToPlainText(html: string): string {
  return normalizeNewlines(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, decodeEntity)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
