import { describe, expect, it } from 'vitest';

import { customPriceMills } from './Memory';

describe('the price of «Записать кастом»', () => {
  it('is dollars with at most cents, in mills; empty is none; anything else is no price, never a guess', () => {
    expect(customPriceMills('')).toBeNull();
    expect(customPriceMills('  ')).toBeNull();
    expect(customPriceMills('120')).toBe(120_000);
    expect(customPriceMills('$49.99')).toBe(49_990);
    expect(customPriceMills('49,5')).toBe(49_500);
    expect(customPriceMills('1 000')).toBe(1_000_000);
    expect(customPriceMills('1.2345')).toBe('bad');
    expect(customPriceMills('1,000')).toBe('bad');
    expect(customPriceMills('120 USD')).toBe('bad');
    expect(customPriceMills('-5')).toBe('bad');
  });
});
