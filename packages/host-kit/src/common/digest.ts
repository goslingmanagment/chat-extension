// The text fingerprint both worlds of the page share: a MAIN script digests the
// draft it reads or writes, an isolated adapter the text it compares with it.
// Dependency-free — a MAIN bundle carries this file (architecture.md §1.1).

/** 53-bit string hash (cyrb53) as 16 hex digits: the local fingerprint of a whole document. */
export function digest(value: string): string {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (b >>> 0).toString(16).padStart(8, '0') + (a >>> 0).toString(16).padStart(8, '0');
}

/** Line breaks and non-breaking spaces made plain, runs of spaces folded, outer whitespace trimmed. */
export const normalize = (value: string): string =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
