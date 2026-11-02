import { describe, expect, it } from 'vitest';

import { otherPagesLabel } from './OtherPages';

const i18n = { formatMoneyMills: (mills: number | null) => `$${String((mills ?? 0) / 1000)}` };

describe('the mark of a fan money on other pages', () => {
  it('names the biggest page and counts the rest', () => {
    const lora = { pageLabel: 'lora-2', grossMills: 1_653_000 };
    const ari = { pageLabel: 'ari-1', grossMills: 120_000 };
    const lilly = { pageLabel: 'lilly-1', grossMills: 40_000 };
    expect(otherPagesLabel(i18n, [])).toBe('');
    expect(otherPagesLabel(i18n, [lora])).toBe('lora-2 $1653');
    expect(otherPagesLabel(i18n, [lora, ari])).toBe('lora-2 $1653 +1');
    expect(otherPagesLabel(i18n, [lora, ari, lilly])).toBe('lora-2 $1653 +2');
  });
});
