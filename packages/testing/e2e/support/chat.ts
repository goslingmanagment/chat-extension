// What a person does in ChatSpace itself, on the stand: typing into its
// message field, pressing its Send, scrolling its message list — with real
// keys and clicks — and what the stand's own page and server saw of it.

import { $, browser } from '@wdio/globals';
import { Key } from 'webdriverio';

import type { PageJournalEntry, ServerJournalEntry } from '../../fixture-chatspace/src/protocol';
import { callStand, standServer } from './stand';

/** The host system's scheme: ⌘ on macOS, Ctrl elsewhere; the panel keys add ⇧ there and Alt here. */
export const MAC = process.platform === 'darwin';
export const MOD = MAC ? Key.Command : Key.Control;
export const PANEL: readonly string[] = MAC ? [Key.Command, Key.Shift] : [Key.Control, Key.Alt];

/** The composer ChatSpace shows now (several are mounted, one per chat tab; the tab's wrapper carries the `v-show`). */
const ACTIVE_COMPOSER = '[data-stand-composer-slot]:not([style*="display: none"])';
/** ChatSpace's own message field of the open chat. */
export const EDITOR = `${ACTIVE_COMPOSER} .ProseMirror`;
/** ChatSpace's own Send button of the open chat. */
export const SEND = `${ACTIVE_COMPOSER} [data-stand-send]`;

/** The person clicks into ChatSpace's message field and types. */
export async function typeDraft(text: string): Promise<void> {
  await $(EDITOR).click();
  await browser.keys(text.split(''));
}

/** The person empties ChatSpace's message field: select all, delete. */
export async function clearDraft(): Promise<void> {
  await $(EDITOR).click();
  await browser.keys([MOD, 'a']);
  await browser.keys(Key.Backspace);
}

/** What ChatSpace's message field of that chat holds (its mounted composer; null — none). */
export async function composerText(accountId: string, chatId: string): Promise<string | null> {
  return (await callStand('composerState', accountId, chatId))?.text ?? null;
}

export async function waitForComposerText(accountId: string, chatId: string, expected: string | RegExp, message: string, timeout = 10_000): Promise<string> {
  let last: string | null = null;
  try {
    await browser.waitUntil(
      async () => {
        last = await composerText(accountId, chatId);
        return last !== null && (typeof expected === 'string' ? last === expected : expected.test(last));
      },
      { timeout, interval: 50 },
    );
  } catch {
    throw new Error(`${message}: the message field of ${accountId}/${chatId} holds ${JSON.stringify(last)}, not ${String(expected)}, after ${timeout} ms`);
  }
  return last as unknown as string;
}

/** The person presses ChatSpace's own Send. */
export async function pressSend(): Promise<void> {
  await $(SEND).click();
}

/** Two frames of the page: a layout change has been painted. */
export async function twoFrames(): Promise<void> {
  await browser.execute(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** The message at the top of ChatSpace's list and how far it is from the list's top edge. */
export async function listAnchor(): Promise<{ readonly id: string | null; readonly offset: number }> {
  return browser.execute(() => {
    const scroller = document.querySelector<HTMLElement>('[data-stand-message-list]');
    const first = [...document.querySelectorAll<HTMLElement>('[data-stand-message-id]')].find((node) => scroller !== null && node.offsetTop + node.offsetHeight > scroller.scrollTop + 1);
    return { id: first?.dataset['standMessageId'] ?? null, offset: first === undefined || scroller === null ? 0 : first.offsetTop - scroller.scrollTop };
  });
}

/** How far above its bottom `scrollList('near-bottom')` leaves the list: no longer «at the bottom» for ChatSpace's list, still at the latest messages for a person. */
export const NEAR_BOTTOM_OFFSET_PX = 40;

/** The person scrolls ChatSpace's list: to the middle of the history, a few lines above its bottom, or back to its bottom. */
export async function scrollList(to: 'middle' | 'near-bottom' | 'bottom'): Promise<void> {
  const moved = await browser.execute(
    async (where: string, near: number) => {
      const scroller = document.querySelector<HTMLElement>('[data-stand-message-list]');
      if (scroller === null) return 'no list';
      const bottom = scroller.scrollHeight - scroller.clientHeight;
      const target = where === 'middle' ? Math.round(bottom / 2) : where === 'near-bottom' ? bottom - near : bottom;
      if (Math.abs(scroller.scrollTop - target) <= 1) return 'there';
      const scrolled = new Promise<string>((resolve) => {
        scroller.addEventListener('scroll', () => requestAnimationFrame(() => requestAnimationFrame(() => resolve('scrolled'))), { once: true });
        setTimeout(() => resolve('no scroll event in 2 s'), 2000);
      });
      scroller.scrollTop = target;
      return scrolled;
    },
    to,
    NEAR_BOTTOM_OFFSET_PX,
  );
  if (moved !== 'scrolled' && moved !== 'there') throw new Error(`the list did not scroll to the ${to}: ${moved}`);
}

/** Entries of the stand page's own journal after `since` (its sequence numbers). */
export async function pageJournal(since: number): Promise<readonly PageJournalEntry[]> {
  return callStand('journal', since);
}

export async function pageJournalMark(): Promise<number> {
  return (await callStand('journal')).at(-1)?.seq ?? 0;
}

/** Calls of ChatSpace's composer bridge that wrote into a message field (`setText`, `insertText`): which chat's field took each. */
export function bridgeWrites(entries: readonly PageJournalEntry[]): Array<{ readonly method: string; readonly chatId: string }> {
  return entries
    .filter((entry) => entry.type === 'bridge-call' && (entry['method'] === 'setText' || entry['method'] === 'insertText'))
    .map((entry) => ({ method: String(entry['method']), chatId: String(entry['chatId']) }));
}

/** What entered ChatSpace's own send queue. */
export const queueAdds = (entries: readonly PageJournalEntry[]): PageJournalEntry[] => entries.filter((entry) => entry.type === 'queue-added');

/** The stand server's journal after `mark`. */
export async function serverSince(mark: number): Promise<ServerJournalEntry[]> {
  return [...(await standServer.journal(mark)).entries];
}

/** Native send POSTs (of one chat, or all). */
export const sendsOf = (entries: readonly ServerJournalEntry[], chatId?: string): ServerJournalEntry[] => entries.filter((entry) => entry.kind === 'send' && (chatId === undefined || entry.chatId === chatId));
/** Loads of a chat's history: on the platform each is a read of that chat. */
export const historyLoads = (entries: readonly ServerJournalEntry[], chatId?: string): ServerJournalEntry[] => entries.filter((entry) => entry.kind === 'history-load' && (chatId === undefined || entry.chatId === chatId));
