import { describe, expect, it } from 'vitest';

import { normalizeNewlines } from './index';

describe('normalizeNewlines', () => {
  it('turns CRLF and lone CR into LF', () => {
    expect(normalizeNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });
});
