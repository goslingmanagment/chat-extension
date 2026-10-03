// JSON measures for the storage budgets (architecture.md §9.4): pure, no
// TextEncoder (core compiles against the ES lib only).

/** UTF-8 bytes of a value's JSON form; null when it is not JSON (cycle, BigInt, function, undefined). */
export function jsonUtf8Bytes(value: unknown): number | null {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    return null;
  }
  if (text === undefined) return null;
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** JSON with object keys sorted at every depth: equal data, equal text (compares what we wrote with what storage reports). */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'undefined';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
  return out;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
