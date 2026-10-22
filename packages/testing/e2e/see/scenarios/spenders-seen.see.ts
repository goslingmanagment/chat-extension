// Spenders: whether the fan read our newest message — «не прочитано» while the fan has not opened the chat, «прочитано»
// once the fan did and the open preview read again (every 30 s while it says «не прочитано»): the chat list, then,
// since our message is its last with nothing unread, the history's newest messages. While our message is not in the
// hub's archive the mark stands beside the header's ages; once it is, under its bubble.

import { PAGE } from '../../../src/scenarios/hub';
import { STAND_IDS } from '../../support/stand';
import { scenario } from '../kit';

const FAN = STAND_IDS.fans.a1;

scenario('spenders-seen', async (s) => {
  await s.ready();
  const ours = await s.stand.modelMessage(STAND_IDS.accounts.a, FAN, 'Did you like the new set?');
  await s.leaveField();
  await s.keys(...s.PANEL, 'm');
  await s.see('modal', 'Fan Alder');
  await s.press(/^Fan Alder/, 'modal', '[data-cg-key^="fan:"]');
  await s.see('modal', 'не прочитано');
  await s.shot('unread');
  await s.stand.fanRead(STAND_IDS.accounts.a, FAN);
  await s.see('modal', /(?<!не )прочитано/, 45_000);
  await s.shot('read');
  // The archive has our message now: the card opened again shows the mark under it.
  await s.hub.command({ op: 'archiveMessage', pageLabel: PAGE, fanRef: FAN, sender: 'model', messageId: ours });
  await s.press(/^Fan Birch/, 'modal', '[data-cg-key^="fan:"]');
  await s.press(/^Fan Alder/, 'modal', '[data-cg-key^="fan:"]');
  await s.see('modal', 'new synthetic model message');
  await s.shot('read-in-feed');
});
