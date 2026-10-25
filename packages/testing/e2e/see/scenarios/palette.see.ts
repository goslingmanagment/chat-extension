// The palette (⌘K), the end of its list («Ждут ответа»), a search in it, and the cheatsheet (?). On both sites
// (2026-10-26): on Fansly its chats are the hub's rows of Spenders; a row the search found opens its group (the hub
// named it), a row of «Ждут ответа» opens the group the page itself already gave (the hub's queue names none on the
// stand). With --showcase the palette's pictures are cut to its window, for a note.

import { createWorld } from '../../../fixture-fansly/src/data';
import { SHOWCASE } from '../../../src/showcase';
import { callFansly } from '../../support/fansly-stand';
import { around, scenario, type See } from '../kit';

/** The Fansly stand's fans on the Fansly page's board: money, and who waits for an answer (the plain world). */
const STAND = createWorld();
const BOARD: readonly { readonly index: number; readonly usd: number; readonly waitingMin?: number }[] = [
  { index: 1, usd: 1840, waitingMin: 25 },
  { index: 2, usd: 960, waitingMin: 190 },
  { index: 3, usd: 610 },
  { index: 4, usd: 420, waitingMin: 1600 },
  { index: 5, usd: 150 },
];
const standGroup = (index: number) => {
  const group = STAND.groups[index];
  if (group === undefined) throw new Error(`the stand has no chat ${index}`);
  return group;
};

/** What the search looks for and the name it finds, by site and world; on Fansly the stand's chat of that fan. */
function search(s: See): { readonly query: string; readonly name: string; readonly chat: number } {
  // The showcase world dresses the same chats (fixture-fansly showcase.ts): Owen Hart is the third, Daniel Brooks the second.
  if (s.site === 'fansly') return s.showcase ? { query: 'owen', name: 'Owen Hart', chat: 2 } : { query: 'fan 4', name: standGroup(3).fan.displayName, chat: 3 };
  return s.showcase ? { query: 'marco', name: 'Marco Rossi', chat: -1 } : { query: 'juni', name: 'Fan Juniper', chat: -1 };
}

/** Out of the site's message field: `?` is ours only outside a field. */
async function outOfField(s: See): Promise<void> {
  if (s.site === 'chatspace') return s.leaveField();
  await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** The palette as it stands: the whole tab, or (the showcase world) its window with a little of the page, `<name>-<site>.png`. */
async function shotPalette(s: See, name: string): Promise<void> {
  if (!s.showcase) {
    await s.shot(name);
    return;
  }
  await s.shot(name, { clip: around([await s.rect('modal', '.cg-pal')], 24), file: `${name}-${s.site}` });
}

/** Fansly: the palette's row of `name` is pressed and the page shows the stand's chat `chat` (its group on the address). */
async function openFromPalette(s: See, name: string, chat: number): Promise<void> {
  const group = standGroup(chat).id;
  await s.press(new RegExp(`^${name}`), 'modal', '.cg-pal__item');
  await s.browser.waitUntil(async () => (await callFansly('route')).groupId === group, { timeout: 15_000, timeoutMsg: `the palette did not open the chat of ${name}` });
  await s.browser.waitUntil(async () => !(await s.has('modal', '.cg-pal__item')), { timeout: 5000, timeoutMsg: 'the palette stayed open' });
}

scenario(
  'palette',
  async (s) => {
    const fansly = s.site === 'fansly';
    const { query, name, chat } = search(s);
    await s.ready();
    await outOfField(s);
    await s.keys(s.MOD, 'k');
    await s.browser.waitUntil(() => s.has('modal', '.cg-pal__item'), { timeout: 10_000, timeoutMsg: 'the palette did not open' });
    await s.see('modal', 'Ждут ответа', 15_000);
    await shotPalette(s, 'palette');
    // The end of the list: «Ждут ответа» under the actions, its last row chosen.
    await s.keys(s.Key.End);
    await shotPalette(s, 'palette-waiting');
    await s.keys(query);
    await s.see('modal', name);
    await shotPalette(s, 'palette-search');
    if (fansly) {
      // A row the search found: the board's row names its group.
      await openFromPalette(s, name, chat);
      await s.shot('palette-opened');
      // A row of «Ждут ответа»: its group is the one the page already gave.
      await s.keys(s.MOD, 'k');
      await s.see('modal', 'Ждут ответа', 15_000);
      await openFromPalette(s, s.showcase ? 'Daniel Brooks' : standGroup(1).fan.displayName, 1);
      await s.shot('palette-opened-waiting');
    }
    await s.closeAll();
    await outOfField(s);
    await s.keys('?');
    await s.see('modal', 'Клавиши ChatGoose'); // «ChatGoose keys»
    await s.shot('cheatsheet');
  },
  {
    sites: ['chatspace', 'fansly'],
    // The plain Fansly world's board: fans of the stand, with their groups; the showcase's is its own (fansly-shift.ts).
    before: async ({ hub, site }) => {
      if (site !== 'fansly' || SHOWCASE) return;
      const fans = BOARD.map(({ index, usd, waitingMin }) => {
        const group = standGroup(index);
        const waits = waitingMin === undefined ? {} : { awaiting: true, fanWroteAgoSec: waitingMin * 60, weWroteAgoSec: waitingMin * 60 + 3600 };
        return { fanRef: group.fan.id, conversationRef: group.id, username: group.fan.username, displayName: group.fan.displayName, lifetimeUsd: usd, windowUsd: null, ...waits };
      });
      await hub.command({ op: 'spenderFans', fans });
      await hub.command({ op: 'config', patch: { spendersTotal: fans.length } });
    },
  },
);
