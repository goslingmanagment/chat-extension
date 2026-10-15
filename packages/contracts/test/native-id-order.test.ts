import { describe, expect, it } from 'vitest';

import { compareFanslyIds } from '../src/fansly';
import { compareNativeIds, nativeIdsAscending, NativeIdSchema } from '../src/primitives';
import { NATIVE_ID_ORDER_PAIRS } from './fixtures/native-id-order';

describe('canonical numeric ids share one precise order', () => {
  it('preserves the Fansly subpath API as the same definition', () => {
    expect(compareFanslyIds).toBe(compareNativeIds);
  });
  it.each(NATIVE_ID_ORDER_PAIRS)('orders %s before %s without Number', (older, newer) => {
    expect(NativeIdSchema.safeParse(older).success).toBe(true);
    expect(NativeIdSchema.safeParse(newer).success).toBe(true);
    expect(compareNativeIds(older, newer)).toBeLessThan(0);
    expect(compareNativeIds(newer, older)).toBeGreaterThan(0);
    expect(compareNativeIds(older, older)).toBe(0);
    expect(nativeIdsAscending([older, newer])).toBe(true);
    expect(nativeIdsAscending([newer, older])).toBe(false);
    expect(nativeIdsAscending([older, older])).toBe(false);
  });
  it('accepts empty and singleton sequences', () => {
    expect(nativeIdsAscending([])).toBe(true);
    expect(nativeIdsAscending(['1'])).toBe(true);
  });
});
