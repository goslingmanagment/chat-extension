// The dock in headless Firefox, light theme (architecture.md §10.2 «Приёмка
// UI», ui-design §11): every state of the binding mockup (1…10, 18, 19) and
// of ui-design §10 over synthetic view models, in both languages, at
// 100/125/150/200 % zoom, at the composer widths 853, 693, 489 and 360 px and
// in the 320 px column. Container queries, real fonts and real layout exist
// only here: each case checks what unit tests cannot (no overflow out of the
// composer, no overlap in the bar, the 40 px bar, the height limit) and
// saves pictures into .cache/e2e/ to compare by eye with `final-<state>-*.png`
// of the mockup. The dark theme is dock-gallery-states-dark.e2e.ts: a spec
// file is one browser session.

import { describeEveryState, resetWindow } from '../support/dock-gallery';
import { useNetworkTrap } from '../support/network-trap';

describe('dock gallery · light: every dock state in both languages, 100–200 % zoom, composer 853/693/489/360/320 px', () => {
  useNetworkTrap();
  after(resetWindow);
  describeEveryState('light');
});
