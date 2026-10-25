// «В разговоре» (Chat Memory week 1): another chatter (Nikita) wrote to fans of the page a few minutes ago. The open
// chat's dock says so with «Понятно»; Spenders marks the fans' rows. A warning, never a block. ChatSpace by default;
// `--site fansly` — the dock of Fansly's first chat.

import { WORLD } from '../../../src/scenarios/hub';
import { STAND_IDS } from '../../support/stand';
import { STAND_PAGE, scenario } from '../kit';

scenario(
  'talking',
  async (s) => {
    await s.ready();
    await s.see('dock', 'С ним сейчас говорит Nikita', 45_000);
    await s.shot('talking-dock');
    if (s.site === 'fansly') return;
    await s.leaveField();
    await s.keys(...s.PANEL, 'm');
    await s.see('modal', 'в разговоре: Nikita', 30_000);
    await s.shot('talking-spenders');
    // ⌘K: the same fans' chats carry the mark (the navigation's chat handles name no host).
    await s.closeAll();
    await s.leaveField();
    await s.keys(s.MOD, 'k');
    await s.see('modal', 'в разговоре: Nikita', 30_000);
    await s.shot('talking-palette');
  },
  {
    sites: ['chatspace', 'fansly'],
    before: async ({ hub, site }) => {
      const marks =
        site === 'fansly'
          ? [{ pageLabel: WORLD.pages.fansly.pageLabel, fanRef: WORLD.fansly.chats.a.fan, conversationRef: WORLD.fansly.chats.a.group }]
          : [STAND_IDS.fans.a1, STAND_IDS.fans.a2].map((fanRef) => ({ pageLabel: STAND_PAGE, fanRef }));
      for (const mark of marks) await hub.command({ op: 'talking', ...mark, name: 'Nikita', agoMs: 4 * 60_000 });
    },
  },
);
