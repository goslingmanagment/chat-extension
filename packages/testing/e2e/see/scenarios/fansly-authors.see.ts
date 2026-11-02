// «Кто написал» on Fansly (2026-11-03, the owner: «узнавать кто написал какое сообщение»): Sofia Lane's chat with Jamie
// in the showcase world, Fansly's dark theme. Two colleagues answered Jamie from their own browsers (the hub recorded
// who: anna with Reply and by hand, max with Fix and a change before the send), one more message went from a phone (no
// sender), and the chatter answers from the composer herself: before the time under each run of the model's messages
// stands who wrote it and how.

import { browser } from '@wdio/globals';

import { FANSLY_MAIN, callFansly, fakeFansly } from '../../support/fansly-stand';
import { around, scenario, type See } from '../kit';

const LABEL = `${FANSLY_MAIN.list} [data-cg-author]`;

async function labels(): Promise<string[]> {
  return browser.execute((selector: string) => [...document.querySelectorAll(selector)].map((node) => node.textContent ?? ''), LABEL);
}

async function waitLabel(text: RegExp): Promise<void> {
  await browser.waitUntil(async () => (await labels()).some((label) => text.test(label)), { timeout: 45_000, interval: 300, timeoutMsg: `no label ${text}: ${JSON.stringify(await labels())}` });
}

/** The chat's newest part: the list, cut to its bottom. */
async function shootChat(s: See, name: string): Promise<void> {
  const list = await s.rect('page', FANSLY_MAIN.list);
  if (list === null) {
    await s.shot(name);
    return;
  }
  // From the fan's «omg finally home» down to the chatter's own answer, above the dock.
  const height = Math.min(list.height, 560);
  await s.shot(name, { clip: { x: list.x, y: list.y + list.height - height, width: list.width, height: height - 6 } });
}

scenario(
  'fansly-authors',
  async (s) => {
    await s.ready();
    await callFansly('setTheme', 'dark');
    const { group, fan } = s.world.fansly.chats.a;
    const pageLabel = s.world.pages.fansly.pageLabel;
    /** A message of the chat; a model's one with the sender the hub recorded for it, if any. */
    const say = async (text: string, from: 'fan' | 'creator', author?: { readonly login: string; readonly how: string; readonly edited?: boolean }): Promise<void> => {
      const answer = (await fakeFansly().command({ op: 'message', groupId: group, text, from, createdAt: Math.floor(Date.now() / 1000) })) as { readonly message: { readonly id: string } };
      if (author !== undefined) {
        await s.hub.command({ op: 'messageAuthor', pageLabel, fanRef: fan, messageId: answer.message.id, login: author.login, at: new Date().toISOString(), how: author.how, ...(author.edited === undefined ? {} : { edited: author.edited }) });
      }
      await s.wait(500);
    };
    await say('omg finally home, that flight was brutal', 'fan');
    await say('welcome back!! how was Lisbon?', 'creator', { login: 'anna', how: 'reply', edited: false });
    await say('did you at least sleep on the plane?', 'creator', { login: 'anna', how: 'hand' });
    await say('barely lol. but the food there was insane', 'fan');
    await say('okay now I am jealous, tell me the best thing you ate', 'creator', { login: 'max', how: 'fix', edited: true });
    await say('brb grabbing coffee', 'creator');
    await say('pastéis de nata. I had like 12 of them', 'fan');
    await waitLabel(/^anna · Reply, сам · $/);
    await waitLabel(/^max · Fix \+ правка · \+1 без автора · $/);

    // The chatter answers from Fansly's own composer: her own send is told to the hub, and her name comes a moment later.
    const field = browser.$(FANSLY_MAIN.field);
    await field.waitForExist({ timeout: 10_000 });
    await field.setValue('12?? okay you win, I need to go there');
    await browser.$(FANSLY_MAIN.send).click();
    await waitLabel(new RegExp(`^${s.world.user.username} · сам · $`));
    await s.wait(600);
    await shootChat(s, 'authors');
    const label = await s.rect('page', LABEL);
    if (label !== null) await s.shot('label-1to1', { clip: around([label], 40) });
  },
  { sites: ['fansly'], showcase: true, viewport: { width: 1440, height: 1000 }, timeout: 180_000 },
);
