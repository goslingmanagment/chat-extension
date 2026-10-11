// The dock in headless Firefox, dark theme: the same cases as
// dock-gallery-states-light.e2e.ts (which says what they check), in a browser
// session of their own.

import { describeEveryState, resetWindow } from '../support/dock-gallery';
import { useNetworkTrap } from '../support/network-trap';

describe('dock gallery · dark: every dock state in both languages, 100–200 % zoom, composer 853/693/548/489/360/320 px', () => {
  useNetworkTrap();
  after(resetWindow);
  describeEveryState('dark');
});
