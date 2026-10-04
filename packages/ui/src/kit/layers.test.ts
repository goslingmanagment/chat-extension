import { describe, expect, it } from 'vitest';

import { MOTION, prefersReducedMotion } from './layers';

describe('motion (ui-design §2.9)', () => {
  it('transitions answer an action within 150 ms', () => {
    expect(Math.max(MOTION.openMs, MOTION.popMs, MOTION.hoverMs)).toBeLessThanOrEqual(MOTION.maxTransitionMs);
    expect(MOTION.maxTransitionMs).toBe(150);
  });

  it('reads prefers-reduced-motion, false when unknown or failing', () => {
    const view = (matches: boolean) => ({ matchMedia: (query: string) => ({ matches: matches && query === '(prefers-reduced-motion: reduce)' }) as MediaQueryList });
    expect(prefersReducedMotion(view(true))).toBe(true);
    expect(prefersReducedMotion(view(false))).toBe(false);
    expect(prefersReducedMotion(null)).toBe(false);
    expect(
      prefersReducedMotion({
        matchMedia: () => {
          throw new Error('no media queries');
        },
      }),
    ).toBe(false);
  });
});
