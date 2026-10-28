// The greeting reminder (2026-10-24, the owner: «через 10 минут — алерт, что
// фан не поприветствован, и из него кнопка Hi»; 2026-10-29: «первый алерт ...
// через 3 мин после фолоу, второй через 10, и третий красный через 15»): which
// rows of «Новые» are due, and which of the three reminders. A fan is due
// three, ten and fifteen minutes after the subscription while nobody greeted
// them and they did not write — the same «none» the list shows — and the
// subscription is not over; the third reminder is red. An hour on the
// reminder is late news: such a fan is the list's to show, not a toast's. The
// age is the hub's clock against the hub's time of the subscription, never
// this browser's.

import { type AudienceNewItem } from '@cg/contracts/hub';

import { greetingStatus, newcomerRow } from './rows';

/** The reminders of a fan nobody greeted, this long after the follow or the subscription; the last one is red. */
export const GREET_REMIND_STEPS_MS = [3 * 60_000, 10 * 60_000, 15 * 60_000] as const;
/** …until this long after subscribing: an older one is only in the list. */
export const GREET_REMIND_UNTIL_MS = 60 * 60_000;
/** Event ids remembered as reminded (per browser session). */
export const GREET_REMINDED_MAX = 500;

/** The reminders due by this age: 0 — none yet; a late one counts the steps it missed, so only the newest is shown. */
export function greetRemindStep(ageMs: number): number {
  return GREET_REMIND_STEPS_MS.filter((delay) => ageMs >= delay).length;
}

/** The moment (epoch ms) of the reminder that follows `step` shown ones of a follow at `at`; null — none left. */
export function nextGreetRemindAt(at: number, step: number): number | null {
  const delay = GREET_REMIND_STEPS_MS[step];
  return delay === undefined ? null : at + delay;
}

/** The last reminder is the red one. */
export function greetRemindUrgent(step: number): boolean {
  return step >= GREET_REMIND_STEPS_MS.length;
}

/** A row due a reminder, and which one (1…3). */
export interface DueGreeting {
  readonly item: AudienceNewItem;
  readonly step: number;
}

/** The rows of one answer of «Новые» that are due a reminder at the hub's `serverNow`, oldest subscription first. */
export function dueGreetings(items: readonly AudienceNewItem[], serverNow: string): DueGreeting[] {
  const now = Date.parse(serverNow);
  if (!Number.isFinite(now)) return [];
  const due: { readonly item: AudienceNewItem; readonly step: number; readonly age: number }[] = [];
  for (const item of items) {
    const age = now - Date.parse(item.subscribedAt);
    const step = age < GREET_REMIND_UNTIL_MS ? greetRemindStep(age) : 0;
    if (step === 0) continue;
    const row = newcomerRow(item);
    if (row.subscription.state === 'expired') continue;
    const fanWrote = (row.thread?.lastFanMessageAt ?? null) !== null;
    if (greetingStatus(row.claim, undefined, null, fanWrote, row.personalSendAt).s !== 'none') continue;
    due.push({ item, step, age });
  }
  return due.sort((a, b) => b.age - a.age).map(({ item, step }) => ({ item, step }));
}
