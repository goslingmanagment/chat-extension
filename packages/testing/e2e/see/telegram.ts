// What the Telegram scenarios (`scenarios/telegram-*.see.ts`, `pnpm see <name> --site telegram`) share: the page's own
// readings (the field, the sends, the focus), waits that note what did not come instead of failing on it (a scenario
// takes pictures; it fails only when a step cannot be done), and a picture of the composer with the dock over it.

import { browser } from '@wdio/globals';

import { type Where } from '../support/ours';
import { callTelegram } from '../support/telegram-stand';
import { around, lap, type See, type SeeSite } from './kit';

/** The active slide's composer (the previous chat's stays hidden beside it). */
export const ACTIVE_FOOTER = '.messages-layout > .Transition > .Transition_slide-active .middle-column-footer';

/** The open chat's field as text (paragraphs joined by `\n`); null — the editor is not up yet. */
export const fieldText = (): Promise<string | null> => callTelegram('fieldText');

/** What the page sent so far: a scenario's «nothing was sent». */
export const sends = (): ReturnType<typeof callTelegram<'sent'>> => callTelegram('sent');

/** Where the page's keyboard focus is: Telegram's field, another element of the page, or a host of ours (`cg-host`). */
export function focusOwner(): Promise<string> {
  return browser.execute(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) return 'body';
    if (active.id === 'editable-message-text') return 'telegram-field';
    if (active.shadowRoot !== null || active.getAttribute('data-host') !== null) return `ours (${active.getAttribute('data-host') ?? active.tagName.toLowerCase()})`;
    return `${active.tagName.toLowerCase()}${active.id === '' ? '' : `#${active.id}`}${typeof active.className === 'string' && active.className !== '' ? `.${active.className.split(' ').join('.')}` : ''}`;
  });
}

/** One line of the page's facts in the run's log: the field, the sends, the focus. */
export async function facts(label: string): Promise<void> {
  const sent = await sends();
  lap(`${label}: field ${JSON.stringify(await fieldText())}, sent ${sent.length}${sent.length === 0 ? '' : ` (${sent.map((item) => JSON.stringify(item.text)).join(', ')})`}, focus ${await focusOwner()}`);
}

/** Waits until a surface of ours shows the text; true — it did, false — it did not in time (noted, not failed). */
export async function shown(s: See<SeeSite>, where: Where, text: string | RegExp, timeout = 15_000): Promise<boolean> {
  try {
    await s.see(where, text, timeout);
    lap(`${where} shows «${String(text)}»`);
    return true;
  } catch {
    lap(`${where} did NOT show «${String(text)}» in ${timeout / 1000} s: ${(await s.text(where)).slice(0, 240)}`);
    return false;
  }
}

/** Presses a button of ours if it is there within `timeout`; true — pressed. */
export async function pressIfShown(s: See<SeeSite>, text: string | RegExp, where: Where = 'dock', selector = 'button', timeout = 5000): Promise<boolean> {
  try {
    await s.h.waitOursText(where, text, `«${String(text)}»`, { timeout, selector });
    await s.press(text, where, selector);
    lap(`pressed «${String(text)}»`);
    return true;
  } catch {
    lap(`no «${String(text)}» to press`);
    return false;
  }
}

/** Waits until the field's text passes `test`; returns it. */
export async function waitField(test: (text: string) => boolean, what: string, timeout = 10_000): Promise<string> {
  let last: string | null = null;
  await browser.waitUntil(
    async () => {
      last = await fieldText();
      return last !== null && test(last);
    },
    { timeout, interval: 150, timeoutMsg: `${what}: the field holds ${JSON.stringify(last)}` },
  );
  return last ?? '';
}

/** A picture of the composer with whatever of ours stands over it (the dock, its result). */
export async function composerShot(s: See<SeeSite>, name: string): Promise<void> {
  const boxes = [await s.rect('page', ACTIVE_FOOTER), await s.rect('dock', '.cg-root')];
  if (boxes.every((box) => box === null)) {
    await s.shot(name);
    return;
  }
  await s.shot(name, { clip: around(boxes, 16) });
}
