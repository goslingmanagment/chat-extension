// core/domain/text — text helpers shared with host-chatspace/isolated (§4).

/** Normalizes line endings to `\n`; the composer and the hub both expect LF. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
