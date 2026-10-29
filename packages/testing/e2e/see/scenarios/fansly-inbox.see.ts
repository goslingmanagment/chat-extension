// Fansly: who waits for a reply in Fansly's own list of chats (2026-10-29). Sofia Lane's inbox in the showcase world, in
// Fansly's dark theme, after she answered Daniel and Jack from the composer: a muted terracotta dot on the avatar of
// every fan who wrote last (the default) and none on theirs, «Кто ждёт ответа» on the settings page, then «Мы:» before
// the preview of the chats the model answered; the dot again in Fansly's light theme.

import { browser } from '@wdio/globals';

import { FANSLY_MAIN, callFansly } from '../../support/fansly-stand';
import { openOptions, waitForOptions } from '../../support/pages';
import { around, scenario, type See } from '../kit';

const INBOX = '.messages-list-wrapper';
const mark = (kind: 'dot' | 'we'): string => `${INBOX} [data-cg-inbox="${kind}"]`;

async function waitMarks(kind: 'dot' | 'we'): Promise<void> {
  await browser.waitUntil(async () => (await browser.$$(mark(kind)).getElements()).length > 0, { timeout: 20_000, interval: 200, timeoutMsg: `no «${kind}» marks in the list of chats` });
}

async function shootInbox(s: See, name: string): Promise<void> {
  // The first rows of the list: the newest chats, where the marks matter.
  const list = await s.rect('page', INBOX);
  await s.shot(name, list === null ? {} : { clip: around([{ ...list, height: Math.min(list.height, 600) }]) });
}

/** The model answers a fan from Fansly's own composer, as a chatter would: the row's dot goes. */
async function answer(name: string, text: string): Promise<void> {
  const href = await browser.execute((who: string) => [...document.querySelectorAll('.messages-list-wrapper a[href^="/messages/"]')].find((link) => link.textContent?.includes(who) === true)?.getAttribute('href') ?? null, name);
  const groupId = href?.split('/').pop();
  if (groupId === undefined) throw new Error(`no row of ${name} in the list of chats`);
  await callFansly('open', groupId);
  const field = browser.$(FANSLY_MAIN.field);
  await field.waitForExist({ timeout: 10_000 });
  await field.setValue(text);
  await browser.$(FANSLY_MAIN.send).click();
  await browser.waitUntil(async () => (await browser.$(`.messages-list-wrapper a[href="${href}"] [data-cg-inbox="dot"]`).isExisting()) === false, { timeout: 10_000, timeoutMsg: `${name}'s dot stayed after the answer` });
}

async function setMark(s: See, mark: 'dot' | 'we' | 'off'): Promise<void> {
  const written = await s.rpc('fansly.settings.write', { patch: { hosts: { 'fansly-web': { inboxMark: mark } } } });
  if (!written.ok) throw new Error(`the mark was not written: ${written.error.code}`);
}

scenario(
  'fansly-inbox',
  async (s) => {
    await s.ready();
    await callFansly('setTheme', 'dark');
    await waitMarks('dot');
    await answer('Daniel Brooks', 'haha leg day is the worst. resting tonight?');
    await answer('Jack Wilson', 'busy but good! editing the new set right now');
    await callFansly('open', s.world.fansly.chats.a.group);
    await waitMarks('dot');
    await shootInbox(s, 'inbox-dot');

    // «Вид и звук»: the row «Кто ждёт ответа».
    await s.toPages();
    await openOptions('appearance');
    await waitForOptions((state) => state.section === 'appearance' && !state.loading, 'the appearance section');
    await s.shot('options-inbox-mark');
    await setMark(s, 'we');
    await s.toChat();
    await waitMarks('we');
    await shootInbox(s, 'inbox-we');

    // Fansly's light theme: the same marks on its own colours.
    await s.toPages();
    await setMark(s, 'dot');
    await s.toChat();
    await waitMarks('dot');
    await callFansly('setTheme', 'bright');
    await shootInbox(s, 'inbox-dot-light');
  },
  { sites: ['fansly'], showcase: true },
);
