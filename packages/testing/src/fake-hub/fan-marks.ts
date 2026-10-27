// The fake hub's `clientFanMarks` (the fan's warning marks): the stand's first Fansly fan (WORLD.fansly.chats.a, the
// open chat; @stand_fan_1, the showcase's Jamie) is in a «💩 Бомж» list on two Fansly pages of the agency and has two
// posts in FANSLY BLOCKLIST, newest first; every other fan has none. Invented names and texts.

import type { FanMarks, FanMarksQuery } from '@cg/contracts';

import { WORLD } from '../scenarios/hub';
import { SHOWCASE } from '../showcase';
import { iso } from './clock';
import type { FakePage } from './config';

const DAY_MS = 86_400_000;
/** FANSLY BLOCKLIST's chat in Telegram's private links (`t.me/c/<chat>/<message>`). */
const GROUP = 'https://t.me/c/1716498488';

export function fakeFanMarks(page: FakePage, query: FanMarksQuery, now: number): FanMarks {
  const none: FanMarks = { pageLabel: page.pageLabel, fanRef: query.fanRef, lists: [], blocklist: [], listsReadAt: iso(now - 4 * 60_000), blocklistReadAt: iso(now - 9 * 60_000) };
  if (page.platform !== 'fansly' || query.fanRef !== WORLD.fansly.chats.a.fan) return none;
  const handle = query.username ?? (SHOWCASE ? 'jamiec' : 'stand_fan_1');
  const other = SHOWCASE ? { pageLabel: 'ella-moon', modelName: 'Ella Moon' } : { pageLabel: 'model-three-fansly', modelName: 'Model Three' };
  return {
    ...none,
    lists: [
      { pageLabel: page.pageLabel, modelName: page.modelName, granted: true, label: '💩 Бомж', since: iso(now - 12 * DAY_MS) },
      { ...other, granted: false, label: '💩 Бомж', since: iso(now - 41 * DAY_MS) },
    ],
    blocklist: [
      { postedAt: iso(now - 3 * DAY_MS), text: `https://fansly.com/${handle}\nDNP + TM`, author: SHOWCASE ? 'Kira | Velvet Agency' : 'stand_agency', link: `${GROUP}/48211`, handle },
      {
        postedAt: iso(now - 64 * DAY_MS),
        text: `https://fansly.com/${handle}\ntw, просит кастом «в долг», потом пропадает`,
        author: SHOWCASE ? 'Mark (Moonlight Mgmt)' : 'stand_agency_2',
        link: `${GROUP}/40117`,
        handle,
      },
    ],
  };
}
