// The greeting reminder on Fansly (2026-10-25): a follow heard from a tab's socket is checked once, ten minutes on,
// and a fan nobody greeted is a toast with «Hi» in the creator's tab.

import { type SoundBatch } from '@cg/contracts/sound';
import { BackgroundToastSchema, type BackgroundToast } from '@cg/contracts/tab-messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FANSLY_EPOCH_MS } from '../../../domain/hosts/fansly/newcomers/pass-rules';
import { FANSLY_GREET_RETRY_MS, FANSLY_GREET_SESSION_KEY, createFanslyGreetReminder } from './greet-remind';
import { type FanslyRemindVerdict } from './newcomers';

const T0 = Date.UTC(2026, 9, 25, 12, 0, 0);
const C = '700000000000000017';
const FAN = '710000000000000001';
const minutes = (n: number): number => n * 60_000;
const followId = (ms: number): string => String(BigInt(ms - FANSLY_EPOCH_MS) << 22n);

function setup(answer: FanslyRemindVerdict | null | (() => FanslyRemindVerdict | null) = { s: 'due', fanLabel: 'Ann' }) {
  const verdict = typeof answer === 'function' ? answer : () => answer;
  const checks: string[] = [];
  const toasts: { tab: string; toast: BackgroundToast }[] = [];
  const store = new Map<string, unknown>();
  let tab: string | null = 'tab-1';
  const make = () =>
    createFanslyGreetReminder({
      check: (creator, follows) => {
        for (const follow of follows) checks.push(`${creator}:${follow.fanRef}`);
        return Promise.resolve(new Map(follows.map((follow) => [follow.fanRef, verdict()])));
      },
      target: () => (tab === null ? null : { tabSessionId: tab, pageId: 7 }),
      toast: (to, toast) => {
        expect(BackgroundToastSchema.safeParse(toast).success).toBe(true);
        toasts.push({ tab: to, toast });
      },
      session: { get: (key) => Promise.resolve(structuredClone(store.get(key))), set: (key, value) => Promise.resolve(void store.set(key, structuredClone(value))) },
      clock: { now: () => Date.now(), setTimer: (ms, fn) => setTimeout(fn, ms) as unknown as number, clearTimer: (handle) => clearTimeout(handle) },
      uuid: () => '00000000-0000-4000-8000-000000000001',
    });
  const batch = (events: SoundBatch['events']): SoundBatch => ({ host: 'fansly-web', hostAccountId: C, events });
  const follow = (at = Date.now()): SoundBatch => batch([{ kind: 'subscriber', id: followId(at), accountId: C, followerId: FAN }]);
  return { checks, toasts, store, make, batch, follow, setTab: (next: string | null) => (tab = next) };
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('[host:fansly] the greeting reminder (2026-10-25)', () => {
  it('a follow is checked once, ten minutes on, and a fan nobody greeted is a toast with Hi in the creator’s tab; the same follow from another tab is one', async () => {
    const t = setup();
    const reminder = t.make();
    reminder.heard(t.follow());
    reminder.heard(t.follow(T0));
    await vi.advanceTimersByTimeAsync(minutes(10) - 1);
    expect(t.checks).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.checks).toEqual([`${C}:${FAN}`]);
    expect(t.toasts).toEqual([{ tab: 'tab-1', toast: expect.objectContaining({ scope: `greet.${FAN}`, fanLabel: 'Ann', greet: { pageId: 7, fanRef: FAN } }) }]);
    await vi.advanceTimersByTimeAsync(minutes(60));
    expect(t.checks).toHaveLength(1);
  });

  it('a fan who writes within the ten minutes is never checked; a greeted fan is no toast', async () => {
    const t = setup({ s: 'greeted' });
    const reminder = t.make();
    reminder.heard(t.follow());
    reminder.heard(t.batch([{ kind: 'message', id: '720000000000000001', conversationRef: '730000000000000001', senderId: FAN, fromFan: true, automatic: false, tip: false, sentAt: null }]));
    await vi.advanceTimersByTimeAsync(minutes(15));
    expect(t.checks).toEqual([]);
    reminder.heard(t.batch([{ kind: 'subscriber', id: followId(Date.now()), accountId: C, followerId: '710000000000000002' }]));
    await vi.advanceTimersByTimeAsync(minutes(10));
    expect(t.checks).toHaveLength(1);
    expect(t.toasts).toEqual([]);
  });

  it('a due follow waits for a tab of its creator (looked at each minute, up to an hour), and outlives the event page', async () => {
    const t = setup();
    t.setTab(null);
    const first = t.make();
    first.heard(t.follow());
    await vi.advanceTimersByTimeAsync(minutes(12));
    expect(t.checks).toEqual([]);
    first.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.store.get(FANSLY_GREET_SESSION_KEY)).toHaveLength(1);
    t.setTab('tab-2');
    const second = t.make();
    await second.restore();
    await vi.advanceTimersByTimeAsync(FANSLY_GREET_RETRY_MS);
    expect(t.toasts.map((entry) => entry.tab)).toEqual(['tab-2']);
  });

  it('a fan the check cannot tell about yet is asked again each minute — and no more once the follow is an hour old', async () => {
    let answers: (FanslyRemindVerdict | null)[] = [null, null, { s: 'due', fanLabel: null }];
    const t = setup(() => answers.shift() ?? null);
    const reminder = t.make();
    reminder.heard(t.follow());
    await vi.advanceTimersByTimeAsync(minutes(10));
    expect(t.checks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(FANSLY_GREET_RETRY_MS * 2);
    expect(t.checks).toHaveLength(3);
    expect(t.toasts).toHaveLength(1);
    answers = [];
    reminder.heard(t.batch([{ kind: 'subscriber', id: followId(Date.now()), accountId: C, followerId: '710000000000000002' }]));
    await vi.advanceTimersByTimeAsync(minutes(70));
    // Asked from its tenth minute to its sixtieth, once a minute; never after.
    expect(t.checks.filter((check) => check.endsWith(':710000000000000002')).length).toBeLessThanOrEqual(51);
    const asked = t.checks.length;
    await vi.advanceTimersByTimeAsync(minutes(10));
    expect(t.checks).toHaveLength(asked);
    expect(t.toasts).toHaveLength(1);
  });

  it('a follow of another account, or older than an hour, is nobody’s', async () => {
    const t = setup();
    const reminder = t.make();
    reminder.heard(t.batch([{ kind: 'subscriber', id: followId(Date.now()), accountId: '700000000000000099', followerId: FAN }]));
    reminder.heard(t.follow(T0 - minutes(61)));
    await vi.advanceTimersByTimeAsync(minutes(70));
    expect(t.checks).toEqual([]);
  });
});
