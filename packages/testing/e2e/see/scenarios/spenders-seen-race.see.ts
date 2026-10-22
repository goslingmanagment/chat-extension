// Spenders: the read mark's race on ChatSpace — the fan writes the moment the preview's check loads the chat's history
// (after the chat list said our message is the last with nothing unread). The load marks that message read too: the
// card says so instead of a mark, and stops asking.

import { STAND_IDS } from '../../support/stand';
import { scenario } from '../kit';

const FAN = STAND_IDS.fans.a1;

scenario('spenders-seen-race', async (s) => {
  await s.ready();
  await s.stand.modelMessage(STAND_IDS.accounts.a, FAN, 'Did you like the new set?');
  await s.stand.raceHistory(STAND_IDS.accounts.a, FAN);
  await s.leaveField();
  await s.keys(...s.PANEL, 'm');
  await s.see('modal', 'Fan Alder');
  await s.press(/^Fan Alder/, 'modal', '[data-cg-key^="fan:"]');
  await s.see('modal', 'Во время проверки «прочитано» фан написал');
  await s.shot('raced');
});
