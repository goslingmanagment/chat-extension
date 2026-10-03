// Stable local fingerprints (architecture.md §5.1 `requestDigest`, §7 «Кэш
// результата»). Synchronous and dependency-free: no crypto.subtle, so the
// same code runs in the background and in a tab. A fingerprint never leaves
// the browser and never keys anything on the hub; collisions only cost a
// cache miss or hit on the same user's own data, never a security boundary.

/**
 * JSON with object keys sorted at every depth and `undefined` members
 * dropped: two values that mean the same produce the same string.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => (item === undefined ? null : normalize(item)));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const member = (value as Record<string, unknown>)[key];
      if (member !== undefined) out[key] = normalize(member);
    }
    return out;
  }
  return value;
}

/**
 * 64-bit fingerprint of a string as 16 lowercase hex characters (two mixed
 * 32-bit lanes over the UTF-16 code units). Matches the contracts' DigestSchema.
 */
export function digestHex(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** Fingerprint of a value by its canonical JSON. */
export function stableDigest(value: unknown): string {
  return digestHex(canonicalJson(value));
}
