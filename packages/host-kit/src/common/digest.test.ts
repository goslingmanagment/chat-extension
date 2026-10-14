import { describe, expect, it } from 'vitest';

import { digest, normalize } from './digest';

describe('the text fingerprint both worlds of the page share', () => {
  it('digest: 16 hex digits, the same for the same text, another for another — the empty text has one too', () => {
    const texts = ['', 'a', 'b', 'hello', 'hello ', 'привет', '{"type":"doc","content":[]}', 'x'.repeat(5000)];
    const prints = texts.map(digest);
    for (const print of prints) expect(print).toMatch(/^[0-9a-f]{16}$/);
    expect(new Set(prints).size).toBe(texts.length);
    expect(texts.map(digest)).toEqual(prints);
    // cyrb53 with the fixed seeds of the adapter: a draft digest of one build compares with another's.
    expect(digest('')).toBe('488bdcb81aee8d83');
  });

  it('normalize: line breaks and non-breaking spaces made plain, runs of spaces folded, outer whitespace trimmed', () => {
    expect(normalize(' a \r\n b\t\tc ')).toBe('a\nb c');
    expect(normalize('one  two\rthree')).toBe('one two\nthree');
    expect(normalize('  \n\n  ')).toBe('');
    expect(normalize('kept  as\n\nparagraphs')).toBe('kept as\n\nparagraphs');
  });
});
