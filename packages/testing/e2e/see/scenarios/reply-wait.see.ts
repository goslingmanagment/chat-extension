// ChatSpace: Reply while the start still reads the open chat from OnlyMonster's API (X54, on a hub that takes the PPV
// state; the stand answers that read 3 s late, as OnlyFans live does). The sheet opens at the click with the context
// stage and Reply busy — taken right after the press, before the start is admitted — then the answer.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PILOT_CAPABILITIES } from '../../../src/fake-hub/config';
import { scenario } from '../kit';

scenario(
  'reply-wait',
  async (s) => {
    await s.ready();
    await s.press(/^Reply/);
    // No still frame here: the spinner moves, and the start waits only so long.
    const png = await s.browser.takeScreenshot();
    const dock = await s.dock();
    writeFileSync(join(s.out, '00-reply-at-click.png'), Buffer.from(png, 'base64'));
    writeFileSync(join(s.out, 'at-click.json'), JSON.stringify(dock?.result ?? null, null, 2));
    await s.done();
    await s.shot('reply-answer');
  },
  {
    sites: ['chatspace'],
    before: async ({ hub, stand }) => {
      await hub.command({ op: 'config', patch: { capabilities: [...PILOT_CAPABILITIES, 'live-ppv-v1'] } });
      await stand.forcedHistoryDelay(3000);
    },
  },
);
