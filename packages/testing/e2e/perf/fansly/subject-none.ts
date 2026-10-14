// The base of every comparison (R20 P3d, P16a): the Fansly stand with no
// extension at all — the same scenario, the same neighbour setting.

import type { PerfSubject } from './scenario';

export function noneSubject(): PerfSubject {
  return {
    name: 'none',
    addonId: null,
    prepare: () => Promise.resolve(),
    ready: () => Promise.resolve(),
    overlay: () => Promise.resolve(),
    describe: () => Promise.resolve({}),
  };
}
