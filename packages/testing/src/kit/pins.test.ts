// Values ui/kit keeps locally so the first dock chunk does not load the
// contracts' zod schemas: each must stay equal to the contract's own.

import { describe, expect, it } from 'vitest';

import { CG_DETAIL_MAX_CHARS, selectorKey } from '@cg/contracts';
import { DETAIL_MAX_CHARS, viewKey } from '@cg/ui/kit';

import { ALL_SELECTORS } from '../scenarios/app-client';

describe('ui/kit local copies of contract values', () => {
  it('viewKey is selectorKey for every selector the UI can ask for', () => {
    expect(ALL_SELECTORS.length).toBeGreaterThan(20);
    for (const selector of ALL_SELECTORS) expect(viewKey(selector)).toBe(selectorKey(selector));
  });

  it('the technical line limit is CG_DETAIL_MAX_CHARS', () => {
    expect(DETAIL_MAX_CHARS).toBe(CG_DETAIL_MAX_CHARS);
  });
});
