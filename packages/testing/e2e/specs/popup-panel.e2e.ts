// The popup where a person meets it: the panel Firefox opens under the
// extension's button (ui-design §4.23). Every other spec opens `popup.html`
// in a tab, and a tab is as wide as the window; the panel is as wide as the
// document itself asks for. 0.1.0 and 0.1.1 asked for nothing — the root's
// size container has no width of its own — and the panel opened as a line
// 600 px tall and 0 px wide, from the toolbar and from the extensions menu
// alike: for a person the popup «не открывается».

import { expect } from '@wdio/globals';

import { installTestBuild } from '../support/extension';
import { useNetworkTrap } from '../support/network-trap';
import { capturePanel, closePanel, placeButton, pressButton, settledPanel, type ButtonArea } from '../support/panel';

/** Firefox's own limit for a popup's panel. */
const PANEL_MAX_HEIGHT = 600;

const ROUTES: readonly (readonly [ButtonArea, string])[] = [
  ['toolbar', 'pinned to the toolbar'],
  ['menu', 'in the extensions menu'],
];

describe('the popup under the extension’s button (the browser’s own panel)', () => {
  useNetworkTrap();

  before(async () => {
    await installTestBuild();
  });

  afterEach(async () => {
    await closePanel();
  });

  for (const [area, where] of ROUTES) {
    it(`[PU-002] the button ${where}: the panel opens 360 px wide and as tall as the popup, not as a line`, async () => {
      await placeButton(area);
      await pressButton();
      const panel = await settledPanel();
      expect(panel.width).toBe(360);
      // Nobody is signed in: the head, the «Нужно войти» card with its button, the footer.
      expect(panel.height).toBeGreaterThan(120);
      expect(panel.height).toBeLessThan(PANEL_MAX_HEIGHT);
      await capturePanel(`ext-popup-panel-${area}`);
    });
  }
});
