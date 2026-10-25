// first-run: «Первый запуск» of a Fansly chatter come over from the old extension — the sign-in holds a Fansly page
// only: the chatter's own steps are «Дать доступ к хабу» and the sign-in, no «Открыть ChatSpace»; Fansly's three under them.
//
//   pnpm see first-run                    — the checklist card (`first-run.png`)
//   pnpm see first-run --showcase         — the same at 2×, for the note

import { WORLD } from '../../../src/scenarios/hub';
import { openOptions, waitForOptions } from '../../support/pages';
import { around, scenario } from '../kit';

scenario(
  'first-run',
  async (s) => {
    await s.ready();
    await s.toPages();
    await openOptions('status');
    const status = await waitForOptions((page) => page.section === 'status' && !page.loading && page.checklist.some((step) => step.id.startsWith('fansly-')), 'the Status section with Fansly\'s first-run steps');
    const ids = status.checklist.map((step) => step.id);
    if (ids.includes('open-chatspace')) throw new Error(`«Открыть ChatSpace» is still a step of a Fansly-only chatter: ${ids.join(', ')}`);
    await s.wait(600);
    const card = await s.rect('page', '.pg-check');
    await s.shot('first-run', { file: 'first-run', ...(card === null ? {} : { clip: around([card], 12) }) });
  },
  {
    sites: ['fansly'],
    // The sign-in's pages: the Fansly one only, as a Fansly chatter's.
    before: async (s) => {
      await s.hub.command({ op: 'grantPages', username: WORLD.user.username, pages: [WORLD.pages.fansly.pageLabel] });
    },
  },
);
