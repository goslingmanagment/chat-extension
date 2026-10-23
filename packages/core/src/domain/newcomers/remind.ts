// The greeting reminder (2026-10-24, the owner: «через 10 минут — алерт, что
// фан не поприветствован, и из него кнопка Hi»): which rows of «Новые» are
// due. A fan is due ten minutes after the subscription while nobody greeted
// them and they did not write — the same «none» the list shows — and the
// subscription is not over. An hour on the reminder is late news: such a fan
// is the list's to show, not a toast's. The age is the hub's clock against
// the hub's time of the subscription, never this browser's.

import { type AudienceNewItem } from '@cg/contracts/hub';

import { greetingStatus, newcomerRow } from './rows';

/** A fan nobody greeted this long after subscribing is reminded of. */
export const GREET_REMIND_AFTER_MS = 10 * 60_000;
/** …until this long after subscribing: an older one is only in the list. */
export const GREET_REMIND_UNTIL_MS = 60 * 60_000;
/** Event ids remembered as reminded (per browser session). */
export const GREET_REMINDED_MAX = 500;

/** The rows of one answer of «Новые» that are due a reminder at the hub's `serverNow`, oldest subscription first. */
export function dueGreetings(items: readonly AudienceNewItem[], serverNow: string): AudienceNewItem[] {
  const now = Date.parse(serverNow);
  if (!Number.isFinite(now)) return [];
  const due: { readonly item: AudienceNewItem; readonly age: number }[] = [];
  for (const item of items) {
    const age = now - Date.parse(item.subscribedAt);
    if (!(age >= GREET_REMIND_AFTER_MS && age < GREET_REMIND_UNTIL_MS)) continue;
    const row = newcomerRow(item);
    if (row.subscription.state === 'expired') continue;
    const fanWrote = (row.thread?.lastFanMessageAt ?? null) !== null;
    if (greetingStatus(row.claim, undefined, null, fanWrote, row.personalSendAt).s !== 'none') continue;
    due.push({ item, age });
  }
  return due.sort((a, b) => b.age - a.age).map((entry) => entry.item);
}
