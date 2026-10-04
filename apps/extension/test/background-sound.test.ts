// The background's sound wiring (composition/background/sound.ts): which
// pages the slow subscriber poll asks, what a tab's own read of «Новые»
// feeds, and who is told to read the list again. The arbiter's policy has
// its own tests in core; here it is the real arbiter over a fake clock.

import { DEFAULT_SETTINGS, type AudienceNewPage, type Bootstrap, type HostAccount } from '@cg/contracts';
import { BOOTSTRAP_PILOT_ON, WORLD } from '@cg/testing/hub';
import { describe, expect, it } from 'vitest';

import { TAB_FED_FRESH_MS, createBackgroundSound } from '../src/composition/background/sound.ts';

const NOW = Date.parse('2026-10-04T09:00:00.000Z');
const ONE = WORLD.pages.one;
const ACCOUNT: HostAccount = { host: 'chatspace', hostAccountId: ONE.hostAccountId, platform: 'onlyfans', platformAccountId: ONE.platformAccountId, username: 'model_one', displayName: 'Model One' };

/** A clock whose timers fire only when the test moves it. */
function fakeClock(start: number) {
  let now = start;
  let nextId = 1;
  let timers: { id: number; at: number; fn: () => void }[] = [];
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  };
  return {
    now: () => now,
    setTimer(ms: number, fn: () => void) {
      const id = nextId++;
      timers.push({ id, at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimer(handle: number) {
      timers = timers.filter((timer) => timer.id !== handle);
    },
    settle,
    async advance(ms: number) {
      const end = now + ms;
      await settle();
      for (;;) {
        const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (due === undefined) break;
        timers = timers.filter((timer) => timer.id !== due.id);
        now = due.at;
        due.fn();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}

function audience(refs: readonly string[], at: number): AudienceNewPage {
  const iso = new Date(at).toISOString();
  return {
    pageLabel: ONE.pageLabel,
    window: { hours: 48, from: iso, to: iso, snapshotAt: iso },
    serverNow: iso,
    coverage: { state: 'complete', deliveryFrontier: null, lastAudienceSweepAt: null, reasons: [] },
    unknownCount: 0,
    welcomeTemplate: null,
    nextCursor: null,
    items: refs.map((eventRef, index) => ({
      eventRef,
      fanRef: String(7000 + index),
      username: null,
      displayName: null,
      kind: eventRef.startsWith('renewed') ? 'renewed' : 'new',
      trial: false,
      subscribedAt: iso,
      subscribedAtSource: 'notification',
      status: { isSubscriber: true, subscriptionStatus: 'active', endsAt: null, asOf: iso, source: 'webhook' },
      thread: null,
      claim: { greeting: 'none', lease: 'none', heldBy: null, custody: null },
    })),
  };
}

function world() {
  const clock = fakeClock(NOW);
  const state = {
    tabs: ['tab-a'] as string[],
    bootstrap: BOOTSTRAP_PILOT_ON as Bootstrap | null,
    usable: true,
    online: true,
    sound: DEFAULT_SETTINGS.sound,
    hubRows: [] as string[],
  };
  const reads: string[] = [];
  const played: number[] = [];
  const told: { to: string | null; pageId: number }[] = [];
  const stored = new Map<string, unknown>();
  const sound = createBackgroundSound({
    clock,
    audio: {
      prepare: () => Promise.resolve(true),
      play() {
        played.push(clock.now());
        return Promise.resolve({ played: true });
      },
    },
    presence: {
      listeningTabs: () => state.tabs.length,
      isChatInFocus: () => false,
      seenAccounts: () => [{ account: ACCOUNT, lastSeenAt: new Date(NOW).toISOString(), openTabs: state.tabs.length }],
    },
    settings: () => state.sound,
    bootstrap: () => state.bootstrap,
    newcomersUsable: () => state.usable,
    hostPermission: () => Promise.resolve(true),
    read(pageLabel) {
      reads.push(pageLabel);
      return Promise.resolve(audience(state.hubRows, clock.now()));
    },
    online: () => state.online,
    events: {
      emit(to, type, payload) {
        if (type === 'newcomers.changed') told.push({ to, pageId: (payload as { pageId: number }).pageId });
      },
    },
    tabs: () => state.tabs,
    session: { get: (key) => Promise.resolve(stored.get(key)), set: (key, value) => Promise.resolve(void stored.set(key, value)) },
    log: { write: () => undefined },
  });
  return { clock, state, reads, played, told, sound };
}

describe('the slow poll of «Новые» for the subscriber sound', () => {
  it('[SN-012] runs only while a ChatSpace tab lives and somebody is signed in; the first read is the baseline and rings nothing, a new subscriber after it rings once', async () => {
    const w = world();
    w.state.hubRows = ['evt-1'];
    w.state.tabs = [];
    w.sound.sync();
    await w.clock.advance(120_000);
    expect(w.reads).toEqual([]);

    w.state.tabs = ['tab-a'];
    w.sound.sync();
    await w.clock.settle();
    expect(w.reads).toEqual([ONE.pageLabel]);
    expect(w.played).toEqual([]);

    w.state.hubRows = ['evt-2', 'evt-1'];
    await w.clock.advance(70_000);
    expect(w.reads.length).toBeGreaterThanOrEqual(2);
    expect(w.played).toHaveLength(1);
    // Every tab is told to read its list again.
    expect(w.told.at(-1)).toEqual({ to: 'tab-a', pageId: ONE.pageId });

    // The last tab is gone, then the sign-in: nothing more is asked.
    const asked = w.reads.length;
    w.state.tabs = [];
    w.sound.sync();
    await w.clock.advance(180_000);
    expect(w.reads).toHaveLength(asked);
  });

  it('a page the hub cannot serve «Новые» for, a switched-off subscriber sound and a browser without a network ask nothing', async () => {
    for (const off of ['unusable', 'sound-off', 'owner-off', 'offline'] as const) {
      const w = world();
      if (off === 'unusable') w.state.usable = false;
      if (off === 'sound-off') w.state.sound = { ...DEFAULT_SETTINGS.sound, subscribers: { ...DEFAULT_SETTINGS.sound.subscribers, on: false } };
      if (off === 'owner-off') w.state.bootstrap = { ...BOOTSTRAP_PILOT_ON, flags: { ...BOOTSTRAP_PILOT_ON.flags, sound: false } };
      if (off === 'offline') w.state.online = false;
      w.sound.sync();
      await w.clock.advance(130_000);
      expect([off, w.reads]).toEqual([off, []]);
    }
  });

  it('[NF-004] a page a tab has just read itself is left out of the poll; its rows reach the same arbiter, and only the other tabs are told', async () => {
    const w = world();
    w.state.tabs = ['tab-a', 'tab-b'];
    const page = { pageId: ONE.pageId, platform: 'onlyfans', platformAccountId: ONE.platformAccountId };
    // The tab's open window reads the list: the baseline comes from it.
    w.sound.fed(page, audience(['evt-1'], NOW), 'tab-a');
    await w.clock.settle();
    expect(w.played).toEqual([]);
    w.sound.sync();
    await w.clock.settle();
    expect(w.reads).toEqual([]);

    // Its next read brings a new subscriber and a renewal: the new one rings, the renewal is not news.
    await w.clock.advance(30_000);
    w.sound.fed(page, audience(['evt-2', 'renewed-9', 'evt-1'], w.clock.now()), 'tab-a');
    await w.clock.settle();
    expect(w.played).toHaveLength(1);
    expect(w.told.filter((item) => item.pageId === ONE.pageId).map((item) => item.to)).toContain('tab-b');
    expect(w.told.map((item) => item.to)).not.toContain('tab-a');

    // The tab stopped reading (its window closed): once its last read is old enough the poll takes over.
    w.state.hubRows = ['evt-2', 'evt-1'];
    await w.clock.advance(TAB_FED_FRESH_MS + 70_000);
    expect(w.reads.length).toBeGreaterThanOrEqual(1);
    // Nothing new in it: no second ring for the same subscriber.
    expect(w.played).toHaveLength(1);
  });

  it('a sign-out forgets the baselines: the next person’s first read is a baseline again', async () => {
    const w = world();
    const page = { pageId: ONE.pageId, platform: 'onlyfans', platformAccountId: ONE.platformAccountId };
    w.sound.fed(page, audience(['evt-1'], NOW), 'tab-a');
    await w.clock.settle();
    w.sound.forget();
    w.sound.fed(page, audience(['evt-2', 'evt-1'], NOW), 'tab-a');
    await w.clock.settle();
    expect(w.played).toEqual([]);
    expect(w.sound.poller.running).toBe(false);
  });
});
