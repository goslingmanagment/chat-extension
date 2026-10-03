// Background event page (D-01: background.scripts, not a service worker).
// Listeners must be registered synchronously in main() so the event page can
// be woken by them; wiring lives in composition/background.ts.

import type { BackgroundDefinition } from 'wxt';
import { defineBackground } from 'wxt/utils/define-background';

import { composeBackground } from '../composition/background';

const definition: BackgroundDefinition = defineBackground(() => {
  composeBackground();
});

export default definition;
