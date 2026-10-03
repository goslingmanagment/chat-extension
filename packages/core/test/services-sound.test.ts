// The one sound arbiter of the extension (architecture.md §9.8): decisions
// one at a time over a fake clock, a fake player and a fake presence. Test
// titles carry the parity rows; ids are synthetic.

import { DEFAULT_SETTINGS, TAB_REQUESTS, type AudienceNewPage, type HostAccount, type IncomingFact, type SettingsV1 } from '@cg/contracts';
import { MESSAGE_THROTTLE_MS, SEEN_TTL_MS, STALE_SUBSCRIBER_MS, SUBSCRIBER_THROTTLE_MS, TONES, volumeToGain, type SoundTone } from '@cg/core/domain/sound';
import {
  SOUND_COUNTER_NAMES,
  SOUND_SESSION_KEY,
  SUBSCRIBER_BASELINE_MAX,
  SoundArbiter,
  createSubscriberPoller,
  soundRequestHandlers,
  type SoundPlayResult,
  type SubscriberBatch,
  type SubscriberPage,
} from '@cg/core/services/sound';
import { describe, expect, it } from 'vitest';

import { FakeClock, LogRecorder, MemoryStore, settle } from './support/clock';

const NOW = Date.parse('2026-10-03T10:00:00.000Z');
const ACCOUNT: HostAccount = { host: 'chatspace', hostAccountId: '1001', platform: 'onlyfans', platformAccountId: '3003', username: 'model_one', displayName: 'Model One' };
const OTHER: HostAccount = { host: 'chatspace', hostAccountId: '1002', platform: 'onlyfans', platformAccountId: '3004', username: 'model_two', displayName: 'Model Two' };

interface World {
  readonly clock: FakeClock;
  readonly store: MemoryStore;
  readonly log: LogRecorder;
  readonly played: { tone: SoundTone; level: number; at: number }[];
  readonly page: {
    sound: SettingsV1['sound'] | null;
    ownerSwitch: boolean | null;
    permission: boolean;
    tabs: number;
    focused: string | null;
    accounts: HostAccount[];
    /** How long the audio takes to wake; null — it never does. */
    wakeMs: number | null;
    playResult: SoundPlayResult | 'throw';
    prepares: number;
  };
  readonly arbiter: SoundArbiter;
}

function world(options: { prepare?: boolean; store?: MemoryStore; clock?: FakeClock } = {}): World {
  const clock = options.clock ?? new FakeClock(NOW);
  const store = options.store ?? new MemoryStore();
  const log = new LogRecorder();
  const played: World['played'] = [];
  const page: World['page'] = { sound: DEFAULT_SETTINGS.sound, ownerSwitch: null, permission: true, tabs: 1, focused: null, accounts: [ACCOUNT, OTHER], wakeMs: 0, playResult: { played: true }, prepares: 0 };
  const arbiter = new SoundArbiter({
    clock,
    audio: {
      ...(options.prepare === false
        ? {}
        : {
            prepare: () => {
              page.prepares += 1;
              if (page.wakeMs === null) return Promise.resolve(false);
              if (page.wakeMs === 0) return Promise.resolve(true);
              return new Promise<boolean>((resolve) => clock.setTimer(page.wakeMs ?? 0, () => resolve(true)));
            },
          }),
      play: (tone, level) => {
        if (page.playResult === 'throw') return Promise.reject(new Error('audio'));
        if (page.playResult.played) played.push({ tone, level, at: clock.now() });
        return Promise.resolve(page.playResult);
      },
    },
    presence: { listeningTabs: () => page.tabs, isChatInFocus: (chatKey) => chatKey === page.focused, accounts: () => page.accounts },
    settings: () => page.sound,
    ownerSwitch: () => page.ownerSwitch,
    hostPermission: () => page.permission,
    session: store,
    log,
  });
  return { clock, store, log, played, page, arbiter };
}

let nextId = 5000;
const fact = (patch: Partial<IncomingFact> = {}, w?: World): IncomingFact => ({
  host: 'chatspace',
  hostAccountId: '1001',
  platformFanId: '2002',
  platformMessageId: String(nextId++),
  fromFan: true,
  automatic: false,
  tip: false,
  sentAt: new Date((w?.clock.now() ?? NOW) - 1000).toISOString(),
  socketEpoch: 1,
  fanSequence: 1,
  source: 'ws-tap',
  ...patch,
});
const sound = (patch: Partial<SettingsV1['sound']>): SettingsV1['sound'] => ({ ...DEFAULT_SETTINGS.sound, ...patch });

describe('the sound arbiter: messages', () => {
  it('[SN-001] [SN-014] a fan\'s message rings through the one player: the chosen tone at the chosen volume', async () => {
    const w = world();
    expect(await w.arbiter.handleIncoming('tab-1', fact())).toBe('played');
    expect(w.played).toEqual([{ tone: TONES.chime, level: volumeToGain(50), at: NOW }]);
    w.page.sound = sound({ messages: { on: true, tone: 'bell' }, volume: 100 });
    await w.clock.advance(MESSAGE_THROTTLE_MS);
    expect(await w.arbiter.handleIncoming('tab-1', fact({}, w))).toBe('played');
    expect(w.played[1]).toMatchObject({ tone: TONES.bell, level: 0.24 });
  });

  it('[SN-001] the message sound works without a hub sign-in: a live ChatSpace identity, the host permission and the switch are enough', async () => {
    const w = world();
    w.page.ownerSwitch = null;
    expect(await w.arbiter.handleIncoming('tab-1', fact())).toBe('played');
    const denied = world();
    denied.page.permission = false;
    expect(await denied.arbiter.handleIncoming('tab-1', fact())).toBe('no-permission');
    const off = world();
    off.page.ownerSwitch = false;
    expect(await off.arbiter.handleIncoming('tab-1', fact())).toBe('disabled');
    const unreadable = world();
    unreadable.page.sound = null;
    expect(await unreadable.arbiter.handleIncoming('tab-1', fact())).toBe('disabled');
    expect([denied.played, off.played, unreadable.played]).toEqual([[], [], []]);
  });

  it('[SN-002] [SN-003] [SN-004] [SN-005] [SN-006] not a fan, automatic, a tip, stale, muted, unknown: silent, each with its name', async () => {
    const w = world();
    const cases: [Partial<IncomingFact>, string][] = [
      [{ fromFan: false }, 'not-fan'],
      [{ automatic: true }, 'automatic'],
      [{ tip: true }, 'tip'],
      [{ sentAt: new Date(NOW - 181_000).toISOString() }, 'stale'],
      [{ sentAt: null }, 'no-time'],
      [{ hostAccountId: '1099' }, 'account-unknown'],
    ];
    for (const [patch, outcome] of cases) expect([outcome, await w.arbiter.handleIncoming('tab-1', fact(patch))]).toEqual([outcome, outcome]);
    w.page.sound = sound({ mutedAccounts: ['chatspace:1001'] });
    expect(await w.arbiter.handleIncoming('tab-1', fact())).toBe('muted');
    // The other model is not muted.
    expect(await w.arbiter.handleIncoming('tab-1', fact({ hostAccountId: '1002' }))).toBe('played');
    expect(w.played).toHaveLength(1);
    expect(w.page.prepares).toBe(1);
  });

  it('[SN-007] no ChatSpace tab listens any more: silent; [SN-008] the chat open in a visible focused tab: silent', async () => {
    const w = world();
    w.page.tabs = 0;
    expect(await w.arbiter.handleIncoming('tab-1', fact())).toBe('tab-closed');
    w.page.tabs = 2;
    w.page.focused = 'chatspace:1001:2002';
    expect(await w.arbiter.handleIncoming('tab-1', fact())).toBe('open-chat');
    // Another fan of the same account, or the same fan id on another account, still rings.
    expect(await w.arbiter.handleIncoming('tab-1', fact({ platformFanId: '2003' }))).toBe('played');
    await w.clock.advance(MESSAGE_THROTTLE_MS);
    expect(await w.arbiter.handleIncoming('tab-1', fact({ hostAccountId: '1002' }, w))).toBe('played');
  });

  it('[SN-009] at most one message sound per 2 s: checked and reserved in one synchronous section, so a burst rings once', async () => {
    const w = world();
    const burst = await Promise.all([1, 2, 3, 4].map(() => w.arbiter.handleIncoming('tab-1', fact())));
    expect(burst).toEqual(['played', 'throttled', 'throttled', 'throttled']);
    await w.clock.advance(MESSAGE_THROTTLE_MS - 1);
    expect(await w.arbiter.handleIncoming('tab-1', fact({}, w))).toBe('throttled');
    await w.clock.advance(1);
    expect(await w.arbiter.handleIncoming('tab-1', fact({}, w))).toBe('played');
    expect(w.played).toHaveLength(2);
  });

  it('[SN-009] the pause is reserved only for a sound that really started', async () => {
    const w = world();
    w.page.playResult = { played: false, code: 'CG-AUDIO-BLOCKED', reason: 'suspended' };
    expect(await w.arbiter.handleIncoming('tab-1', fact())).toBe('audio-error');
    w.page.playResult = 'throw';
    expect(await w.arbiter.handleIncoming('tab-1', fact())).toBe('audio-error');
    w.page.playResult = { played: true };
    expect(await w.arbiter.handleIncoming('tab-1', fact())).toBe('played');
  });

  it('[SN-010] one event rings once in the whole extension for 10 minutes — whichever tab or source reports it', async () => {
    const w = world();
    const message = fact();
    const both = await Promise.all([w.arbiter.handleIncoming('tab-1', message), w.arbiter.handleIncoming('tab-2', { ...message, source: 'store' })]);
    expect(both).toEqual(['played', 'duplicate']);
    await w.clock.advance(SEEN_TTL_MS - 1);
    expect(await w.arbiter.handleIncoming('tab-3', { ...message, sentAt: new Date(w.clock.now()).toISOString() })).toBe('duplicate');
    // The same message id under another account is another event.
    expect(await w.arbiter.handleIncoming('tab-1', { ...message, hostAccountId: '1002', sentAt: new Date(w.clock.now()).toISOString() })).toBe('played');
    // A silent verdict about the message itself settles it too: a tip stays a tip from every tab.
    const tip = fact({ tip: true }, w);
    expect(await w.arbiter.handleIncoming('tab-1', tip)).toBe('tip');
    expect(await w.arbiter.handleIncoming('tab-2', { ...tip, tip: false })).toBe('duplicate');
  });

  it('[SN-010] a tab\'s first snapshot does not swallow the live copy another tab reports', async () => {
    const w = world();
    const message = fact({ sentAt: new Date(NOW - 60_000).toISOString() });
    // A freshly loaded tab finds the message in its first read of the store…
    expect(await w.arbiter.handleIncoming('tab-new', { ...message, source: 'store' })).toBe('first-snapshot');
    // …and the tab that was there when it arrived reports the pushed frame.
    expect(await w.arbiter.handleIncoming('tab-old', { ...message, source: 'ws-tap' })).toBe('played');
    // An unknown account does not settle the event either: the tab that knows it may still ring.
    const stray = fact({ hostAccountId: '1099' });
    expect(await w.arbiter.handleIncoming('tab-1', stray)).toBe('account-unknown');
    w.page.accounts.push({ ...ACCOUNT, hostAccountId: '1099' });
    await w.clock.advance(MESSAGE_THROTTLE_MS);
    expect(await w.arbiter.handleIncoming('tab-2', { ...stray, sentAt: new Date(w.clock.now()).toISOString() })).toBe('played');
  });

  it('[SN-005] a first snapshot and a reconnect are silent per tab and account — on a second report, a late page and a slow resync too; a closed tab starts over', async () => {
    const w = world();
    const ago = (ms: number): string => new Date(w.clock.now() - ms).toISOString();
    const snapshot = fact({ source: 'store', sentAt: ago(100_000) });
    expect(await w.arbiter.handleIncoming('tab-1', snapshot)).toBe('first-snapshot');
    expect(await w.arbiter.handleIncoming('tab-1', fact({ source: 'store', sentAt: ago(60_000) }))).toBe('first-snapshot');
    // After the burst: the same fact reported again, then an older chat from the next page of the list.
    await w.clock.advance(2000);
    expect(await w.arbiter.handleIncoming('tab-1', snapshot)).toBe('first-snapshot');
    await w.clock.advance(3000);
    expect(await w.arbiter.handleIncoming('tab-1', fact({ source: 'store', sentAt: ago(120_000) }))).toBe('first-snapshot');
    // A message sent after the tab began to listen rings even when the store hands it over 40 s late.
    await w.clock.advance(60_000);
    expect(await w.arbiter.handleIncoming('tab-1', fact({ source: 'store', sentAt: ago(40_000) }))).toBe('played');
    await w.clock.advance(MESSAGE_THROTTLE_MS);
    // The socket came back: what it missed is silent, in the burst and in a resync five seconds later.
    expect(await w.arbiter.handleIncoming('tab-1', fact({ source: 'store', sentAt: ago(60_000), socketEpoch: 2 }))).toBe('reconnect');
    await w.clock.advance(5000);
    expect(await w.arbiter.handleIncoming('tab-1', fact({ source: 'store', sentAt: ago(100_000), socketEpoch: 2 }))).toBe('reconnect');
    // Another account of the same tab has its own first snapshot.
    expect(await w.arbiter.handleIncoming('tab-1', fact({ source: 'store', sentAt: ago(60_000), hostAccountId: '1002' }))).toBe('first-snapshot');
    w.arbiter.tabGone('tab-1');
    expect(await w.arbiter.handleIncoming('tab-1', fact({ source: 'store', sentAt: ago(60_000), socketEpoch: 2 }))).toBe('first-snapshot');
    expect(w.played).toHaveLength(1);
    expect(w.arbiter.diagnostics().outcomes).toEqual({ 'first-snapshot': 6, reconnect: 2, played: 1 });
  });

  it('[SN-005] a pushed frame first does not make the store\'s snapshot or its refetch after a reconnect live', async () => {
    const w = world();
    const ago = (ms: number): string => new Date(w.clock.now() - ms).toISOString();
    expect(await w.arbiter.handleIncoming('tab-1', fact({}, w))).toBe('played');
    await w.clock.advance(MESSAGE_THROTTLE_MS);
    expect(await w.arbiter.handleIncoming('tab-1', fact({ source: 'store', sentAt: ago(60_000), platformFanId: '2003' }))).toBe('first-snapshot');
    await w.clock.advance(300_000);
    expect(await w.arbiter.handleIncoming('tab-1', fact({ socketEpoch: 2 }, w))).toBe('played');
    await w.clock.advance(MESSAGE_THROTTLE_MS);
    expect(await w.arbiter.handleIncoming('tab-1', fact({ source: 'store', sentAt: ago(60_000), socketEpoch: 2 }))).toBe('reconnect');
    expect(w.played).toHaveLength(2);
  });

  it('[SN-005] a tab is heard from its first fact on, a duplicate included: what was sent after it is live from that tab', async () => {
    const w = world();
    const message = fact({}, w);
    expect(await w.arbiter.handleIncoming('tab-1', message)).toBe('played');
    expect(await w.arbiter.handleIncoming('tab-2', { ...message, source: 'store' })).toBe('duplicate');
    await w.clock.advance(60_000);
    expect(await w.arbiter.handleIncoming('tab-2', fact({ source: 'store', sentAt: new Date(w.clock.now() - 40_000).toISOString() }))).toBe('played');
  });

  it('[SN-011] the audio may take 1.5 s to wake: everything is looked at again after it, and a player that will not wake is an audio error', async () => {
    const w = world();
    w.page.wakeMs = 1200;
    const pending = w.arbiter.handleIncoming('tab-1', fact());
    await settle();
    // While the audio wakes the person opens that very chat.
    w.page.focused = 'chatspace:1001:2002';
    await w.clock.advance(1200);
    expect(await pending).toBe('open-chat');
    w.page.focused = null;
    // …or switches the sound off, mutes the model, closes the last tab.
    for (const [change, outcome] of [
      [() => (w.page.sound = sound({ messages: { on: false, tone: 'chime' } })), 'disabled'],
      [() => (w.page.sound = sound({ mutedAccounts: ['chatspace:1001'] })), 'muted'],
      [() => (w.page.tabs = 0), 'tab-closed'],
    ] as const) {
      w.page.sound = DEFAULT_SETTINGS.sound;
      w.page.tabs = 1;
      const waiting = w.arbiter.handleIncoming('tab-1', fact({}, w));
      await settle();
      change();
      await w.clock.advance(1200);
      expect(await waiting).toBe(outcome);
    }
    expect(w.played).toEqual([]);
    w.page.sound = DEFAULT_SETTINGS.sound;
    w.page.tabs = 1;
    w.page.wakeMs = null;
    expect(await w.arbiter.handleIncoming('tab-1', fact({}, w))).toBe('audio-error');
    // A message that grew stale while the audio woke does not ring.
    w.page.wakeMs = 1200;
    const ageing = w.arbiter.handleIncoming('tab-1', fact({ sentAt: new Date(w.clock.now() - 179_500).toISOString() }, w));
    await w.clock.advance(1200);
    expect(await ageing).toBe('stale');
  });

  it('[SN-014] a player without prepare() is woken by play itself: one look, then the sound', async () => {
    const w = world({ prepare: false });
    expect(await w.arbiter.handleIncoming('tab-1', fact())).toBe('played');
    expect(w.page.prepares).toBe(0);
  });
});

const batch = (events: SubscriberBatch['events'], patch: Partial<SubscriberBatch> = {}): SubscriberBatch => ({ pageKey: '11', platform: 'onlyfans', platformAccountId: '3003', hub: true, events, ...patch });
const sub = (ref: string, msAgo = 20_000, w?: World): SubscriberBatch['events'][number] => ({ eventRef: ref, subscribedAt: new Date((w?.clock.now() ?? NOW) - msAgo).toISOString() });

describe('the sound arbiter: subscribers', () => {
  it('[SN-012] a new subscriber rings its own tone — after the first poll set the baseline; a row seen before never rings again', async () => {
    const w = world();
    expect(await w.arbiter.handleSubscribers(batch([sub('e1'), sub('e2')]))).toEqual(['first-snapshot', 'first-snapshot']);
    expect(w.played).toEqual([]);
    expect(await w.arbiter.handleSubscribers(batch([sub('e3'), sub('e1'), sub('e2')]))).toEqual(['played']);
    expect(w.played).toEqual([{ tone: TONES.double, level: volumeToGain(50), at: NOW }]);
    // The same list again, hours later (the window is 48 h): nothing is new.
    await w.clock.advance(3 * 60 * 60_000);
    expect(await w.arbiter.handleSubscribers(batch([sub('e3'), sub('e1'), sub('e2')]))).toEqual([]);
    // An empty first poll is a baseline too: the next row is news.
    const fresh = world();
    expect(await fresh.arbiter.handleSubscribers(batch([]))).toEqual([]);
    expect(await fresh.arbiter.handleSubscribers(batch([sub('e9')]))).toEqual(['played']);
  });

  it('[SN-012] subscribers ring at most once per 10 s, never over a message, and never take a message\'s sound', async () => {
    const w = world();
    await w.arbiter.handleSubscribers(batch([]));
    expect(await w.arbiter.handleSubscribers(batch([sub('e1'), sub('e2'), sub('e3')]))).toEqual(['played', 'throttled', 'throttled']);
    // A message right after the subscriber sound still rings.
    expect(await w.arbiter.handleIncoming('tab-1', fact())).toBe('played');
    await w.clock.advance(SUBSCRIBER_THROTTLE_MS - 1);
    expect(await w.arbiter.handleSubscribers(batch([sub('e4', 20_000, w)]))).toEqual(['throttled']);
    await w.clock.advance(1);
    expect(await w.arbiter.handleIncoming('tab-1', fact({}, w))).toBe('played');
    // Within 2 s of a message a subscriber waits: it never rings over it.
    expect(await w.arbiter.handleSubscribers(batch([sub('e5', 20_000, w)]))).toEqual(['throttled']);
    await w.clock.advance(MESSAGE_THROTTLE_MS);
    expect(await w.arbiter.handleSubscribers(batch([sub('e6', 20_000, w)]))).toEqual(['played']);
    expect(w.played.map((entry) => entry.tone)).toEqual([TONES.double, TONES.chime, TONES.chime, TONES.double]);
  });

  it('[SN-012] the subscriber sound needs the hub, a working tab and a known creator; an old subscription is history', async () => {
    const w = world();
    await w.arbiter.handleSubscribers(batch([]));
    expect(await w.arbiter.handleSubscribers(batch([sub('e1')], { hub: false }))).toEqual(['no-hub']);
    w.page.tabs = 0;
    expect(await w.arbiter.handleSubscribers(batch([sub('e2')]))).toEqual(['tab-closed']);
    w.page.tabs = 1;
    expect(await w.arbiter.handleSubscribers(batch([sub('e3', STALE_SUBSCRIBER_MS + 1)]))).toEqual(['stale']);
    expect(await w.arbiter.handleSubscribers(batch([sub('e4')], { pageKey: '12', platformAccountId: '3999' }))).toEqual(['first-snapshot']);
    expect(await w.arbiter.handleSubscribers(batch([sub('e5')], { pageKey: '12', platformAccountId: '3999' }))).toEqual(['account-unknown']);
    expect(await w.arbiter.handleSubscribers(batch([sub('e6')], { pageKey: '13', platformAccountId: null }))).toEqual(['first-snapshot']);
    expect(await w.arbiter.handleSubscribers(batch([sub('e7')], { pageKey: '13', platformAccountId: null }))).toEqual(['account-unknown']);
    w.page.sound = sound({ subscribers: { on: false, tone: 'double' } });
    expect(await w.arbiter.handleSubscribers(batch([sub('e8')]))).toEqual(['disabled']);
    expect(w.played).toEqual([]);
  });

  it('[ST-075] the model\'s switch silences both sounds of that model and nothing else', async () => {
    const w = world();
    w.page.sound = sound({ mutedAccounts: ['chatspace:1001'] });
    await w.arbiter.handleSubscribers(batch([]));
    await w.arbiter.handleSubscribers(batch([], { pageKey: '12', platformAccountId: '3004' }));
    expect(await w.arbiter.handleIncoming('tab-1', fact())).toBe('muted');
    expect(await w.arbiter.handleSubscribers(batch([sub('e1')]))).toEqual(['muted']);
    expect(await w.arbiter.handleSubscribers(batch([sub('e2')], { pageKey: '12', platformAccountId: '3004' }))).toEqual(['played']);
    await w.clock.advance(MESSAGE_THROTTLE_MS);
    expect(await w.arbiter.handleIncoming('tab-1', fact({ hostAccountId: '1002' }, w))).toBe('played');
  });

  it('[SN-012] the audio is woken for a subscriber as for a message, with a fresh look after; sign-out forgets the baselines', async () => {
    const w = world();
    await w.arbiter.handleSubscribers(batch([]));
    w.page.wakeMs = 1000;
    const pending = w.arbiter.handleSubscribers(batch([sub('e1')]));
    await settle();
    w.page.sound = sound({ subscribers: { on: false, tone: 'double' } });
    await w.clock.advance(1000);
    expect(await pending).toEqual(['disabled']);
    w.page.sound = DEFAULT_SETTINGS.sound;
    w.page.wakeMs = null;
    expect(await w.arbiter.handleSubscribers(batch([sub('e2', 20_000, w)]))).toEqual(['audio-error']);
    w.page.wakeMs = 0;
    w.arbiter.forgetSubscribers();
    expect(await w.arbiter.handleSubscribers(batch([sub('e3', 20_000, w)]))).toEqual(['first-snapshot']);
    // The baseline is bounded: the newest refs are kept.
    const many = Array.from({ length: SUBSCRIBER_BASELINE_MAX + 20 }, (_, index) => sub(`m${index}`, 20_000, w));
    await w.arbiter.handleSubscribers(batch(many, { pageKey: '20' }));
    await w.arbiter.flush();
    const stored = w.store.data.get(SOUND_SESSION_KEY) as { pages: Record<string, string[]> };
    expect(stored.pages['20']).toHaveLength(SUBSCRIBER_BASELINE_MAX);
    expect(stored.pages['20']?.[0]).toBe('m20');
  });
});

describe('the sound arbiter: state, diagnostics and the protocol', () => {
  it('[SN-010] seen events, the throttle and the baselines survive an event-page unload in storage.session', async () => {
    const first = world();
    const message = fact();
    await first.arbiter.handleSubscribers(batch([sub('e1')]));
    expect(await first.arbiter.handleIncoming('tab-1', message)).toBe('played');
    // Written once, a moment later, not per event.
    expect(first.store.writes).toBe(0);
    await first.clock.advance(1000);
    expect(first.store.writes).toBe(1);
    // The event page unloads and wakes: a new arbiter over the same session storage.
    const second = world({ store: first.store, clock: first.clock });
    await second.arbiter.restore();
    expect(await second.arbiter.handleIncoming('tab-9', { ...message, sentAt: new Date(first.clock.now()).toISOString() })).toBe('duplicate');
    expect(await second.arbiter.handleIncoming('tab-9', fact({}, first))).toBe('throttled');
    expect(await second.arbiter.handleSubscribers(batch([sub('e1')]))).toEqual([]);
    expect(second.played).toEqual([]);
  });

  it('a damaged or unreadable session state starts empty and never silences everything; a failed write is tried again', async () => {
    const store = new MemoryStore();
    store.data.set(SOUND_SESSION_KEY, { v: 1, seen: 'x', throttle: { lastMessageAt: NOW + 10 * 60_000, lastSubscriberAt: 'x' }, pages: { '11': 'x', '12': [1, 'e1'] } });
    const w = world({ store });
    await w.arbiter.restore();
    // A ring «in the future» is clamped to now: the pause is 2 s, not ten minutes.
    expect(await w.arbiter.handleIncoming('tab-1', fact())).toBe('throttled');
    await w.clock.advance(MESSAGE_THROTTLE_MS);
    expect(await w.arbiter.handleIncoming('tab-1', fact({}, w))).toBe('played');
    expect(await w.arbiter.handleSubscribers(batch([sub('e1', 20_000, w)], { pageKey: '12' }))).toEqual([]);

    for (const junk of [null, 'text', { v: 2 }]) {
      const other = new MemoryStore();
      other.data.set(SOUND_SESSION_KEY, junk);
      const o = world({ store: other });
      await o.arbiter.restore();
      expect(await o.arbiter.handleIncoming('tab-1', fact())).toBe('played');
    }
    const failing = world();
    failing.store.failReads = true;
    await failing.arbiter.restore();
    expect(failing.log.entries.map((entry) => entry.code)).toEqual(['CG-STORAGE-READ']);
    failing.store.failWrites = true;
    await failing.arbiter.handleIncoming('tab-1', fact());
    await failing.arbiter.flush();
    expect(failing.log.entries.map((entry) => entry.code)).toEqual(['CG-STORAGE-READ', 'CG-STORAGE-WRITE']);
    failing.store.failWrites = false;
    await failing.arbiter.flush();
    expect(failing.store.writes).toBe(1);
    // Nothing but codes in the log: no ids of fans or messages.
    for (const entry of failing.log.entries) expect(entry.fields).toBeUndefined();
  });

  it('[SN-010] the arbiter works without session storage; a subscription event is decided once whatever page reports it; the per-tab memory is bounded', async () => {
    const clock = new FakeClock(NOW);
    const played: number[] = [];
    const bare = new SoundArbiter({
      clock,
      audio: { play: () => (played.push(clock.now()), Promise.resolve({ played: true })) },
      presence: { listeningTabs: () => 1, isChatInFocus: () => false, accounts: () => [ACCOUNT] },
      settings: () => DEFAULT_SETTINGS.sound,
      ownerSwitch: () => null,
      hostPermission: () => Promise.reject(new Error('permissions API failed')),
    });
    await bare.restore();
    // A permission check that throws is «no permission», never a crash and never a sound.
    expect(await bare.handleIncoming('tab-1', fact())).toBe('no-permission');
    await bare.flush();
    bare.forgetSubscribers();
    expect(clock.pending).toBe(0);

    const w = world();
    await w.arbiter.handleSubscribers(batch([]));
    await w.arbiter.handleSubscribers(batch([], { pageKey: '12' }));
    expect(await w.arbiter.handleSubscribers(batch([sub('e1')]))).toEqual(['played']);
    // The same hub event under another page key of the same creator: already decided.
    expect(await w.arbiter.handleSubscribers(batch([sub('e1')], { pageKey: '12' }))).toEqual(['duplicate']);
    // Six hundred tabs' worth of sources: the oldest are forgotten (their next store fact is a first snapshot again).
    for (let i = 0; i < 600; i += 1) await w.arbiter.handleIncoming(`tab-${i}`, fact({ fromFan: false }));
    await w.clock.advance(60_000);
    expect(await w.arbiter.handleIncoming('tab-0', fact({ source: 'store', sentAt: new Date(w.clock.now() - 60_000).toISOString() }, w))).toBe('first-snapshot');
  });

  it('[SN-015] [ST-133] diagnostics: how many tabs listen, the last incoming, the outcome counters of both sounds', async () => {
    const w = world();
    w.page.tabs = 3;
    expect(w.arbiter.diagnostics()).toEqual({ listeningTabs: 3, lastIncomingAt: null, lastPlayedAt: null, outcomes: {} });
    await w.arbiter.handleIncoming('tab-1', fact());
    await w.arbiter.handleIncoming('tab-1', fact());
    await w.arbiter.handleIncoming('tab-1', fact({ tip: true }));
    w.arbiter.recordInvalid();
    w.arbiter.recordInvalid('subscriber');
    await w.arbiter.handleSubscribers(batch([sub('e1')]));
    await w.clock.advance(5000);
    await w.arbiter.handleIncoming('tab-2', fact({ fromFan: false }, w));
    const diagnostics = w.arbiter.diagnostics();
    expect(diagnostics).toEqual({
      listeningTabs: 3,
      lastIncomingAt: new Date(NOW + 5000).toISOString(),
      lastPlayedAt: new Date(NOW).toISOString(),
      outcomes: { played: 1, throttled: 1, tip: 1, invalid: 1, 'subscriber.invalid': 1, 'subscriber.first-snapshot': 1, 'not-fan': 1 },
    });
    // Every counter name is a known one, and fits the diagnostics snapshot's schema.
    for (const name of Object.keys(diagnostics.outcomes)) expect(SOUND_COUNTER_NAMES).toContain(name);
    for (const name of SOUND_COUNTER_NAMES) expect(name.length).toBeLessThanOrEqual(64);
  });

  it('[SN-016] the protocol: a fact comes only from a ChatSpace tab, the test sound only from a page; both answers fit their schemas', async () => {
    const w = world();
    const handlers = soundRequestHandlers(w.arbiter);
    const message = fact();
    expect(TAB_REQUESTS['sound.event'].from).toEqual(['tab']);
    expect(TAB_REQUESTS['sound.preview']).toMatchObject({ from: ['page'], pages: ['options'] });
    const played = await handlers['sound.event']({ fact: message }, { kind: 'tab', tabSessionId: 'tab-1' });
    expect(played).toEqual({ ok: true, payload: { played: true } });
    const again = await handlers['sound.event']({ fact: message }, { kind: 'tab', tabSessionId: 'tab-2' });
    expect(again).toEqual({ ok: true, payload: { played: false, reason: 'duplicate' } });
    for (const answer of [played, again]) expect(answer.ok && TAB_REQUESTS['sound.event'].res.safeParse(answer.payload).success).toBe(true);
    // A page of the extension has no chat behind it: it cannot report a fact.
    expect(await handlers['sound.event']({ fact: fact() }, { kind: 'page' })).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } });
    expect(w.played).toHaveLength(1);
  });

  it('[ST-131] «Проверить звук» plays the chosen tone at the chosen volume past every rule, and says when the audio is blocked', async () => {
    const w = world();
    const handlers = soundRequestHandlers(w.arbiter);
    // Everything that would silence a real event: off, muted, no tabs, throttled.
    w.page.sound = sound({ messages: { on: false, tone: 'chime' }, subscribers: { on: false, tone: 'double' }, mutedAccounts: ['chatspace:1001'] });
    w.page.tabs = 0;
    expect(await handlers['sound.preview']({ tone: 'knock', volume: 80 })).toEqual({ ok: true, payload: { played: true } });
    expect(await handlers['sound.preview']({ tone: 'soft', volume: 5 })).toEqual({ ok: true, payload: { played: true } });
    expect(w.played.map((entry) => [entry.tone, entry.level])).toEqual([[TONES.knock, volumeToGain(80)], [TONES.soft, volumeToGain(5)]]);
    w.page.playResult = { played: false, code: 'CG-AUDIO-BLOCKED', reason: 'suspended' };
    const blocked = await handlers['sound.preview']({ tone: 'bell', volume: 50 });
    expect(blocked).toEqual({ ok: true, payload: { played: false, code: 'CG-AUDIO-BLOCKED' } });
    expect(blocked.ok && TAB_REQUESTS['sound.preview'].res.safeParse(blocked.payload).success).toBe(true);
    w.page.playResult = 'throw';
    expect(await w.arbiter.preview('bell', 50)).toEqual({ played: false, code: 'CG-AUDIO-BLOCKED' });
    // A test sound is not an event: it leaves no counter and no pause behind.
    expect(w.arbiter.diagnostics().outcomes).toEqual({});
  });
});

// ── the subscriber poll ──

const PAGE: SubscriberPage = { pageId: 11, pageLabel: 'model-one', platform: 'onlyfans', platformAccountId: '3003' };
const audience = (items: { ref: string; kind?: string; msAgo?: number }[], now: number): AudienceNewPage =>
  ({ pageLabel: PAGE.pageLabel, items: items.map((item) => ({ eventRef: item.ref, kind: item.kind ?? 'new', subscribedAt: new Date(now - (item.msAgo ?? 20_000)).toISOString() })) }) as unknown as AudienceNewPage;

describe('the subscriber poll', () => {
  function poll(options: { pages?: SubscriberPage[] } = {}) {
    const w = world();
    const state = { enabled: true, answers: [] as (AudienceNewPage | Error)[], reads: [] as { label: string; hours: number }[] };
    const poller = createSubscriberPoller({
      clock: w.clock,
      pages: () => options.pages ?? [PAGE],
      read: (page, hours) => {
        state.reads.push({ label: page.pageLabel, hours });
        const answer = state.answers.shift() ?? audience([], w.clock.now());
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      },
      presence: { listeningTabs: () => w.page.tabs, accounts: () => w.page.accounts },
      enabled: () => state.enabled,
      sink: w.arbiter,
      log: w.log,
    });
    return { w, state, poller };
  }

  it('[SN-012] «Новые» of the hub is asked once a minute while a ChatSpace tab works; a new row rings, a renewal is not in the list at all', async () => {
    const { w, state, poller } = poll();
    state.answers.push(audience([{ ref: 'e1' }], NOW));
    poller.start();
    await settle();
    expect(state.reads).toEqual([{ label: 'model-one', hours: 48 }]);
    expect(w.played).toEqual([]);
    state.answers.push(audience([{ ref: 'e2' }, { ref: 'e3', kind: 'renewed' }, { ref: 'e1' }], NOW + 60_000));
    await w.clock.advance(59_999);
    expect(state.reads).toHaveLength(1);
    await w.clock.advance(1);
    expect(state.reads).toHaveLength(2);
    // One sound for e2; the unknown kind is not even offered to the arbiter.
    expect(w.played).toHaveLength(1);
    expect(w.arbiter.diagnostics().outcomes).toEqual({ 'subscriber.first-snapshot': 1, 'subscriber.played': 1 });
    expect(poller.running).toBe(true);
    poller.stop();
    await w.clock.advance(300_000);
    expect(state.reads).toHaveLength(2);
    expect(poller.running).toBe(false);
  });

  it('[SN-012] nothing is asked with no tab, with the sound off, or for a creator this browser does not have open; a failed poll rings nothing and is asked again', async () => {
    const { w, state, poller } = poll({ pages: [PAGE, { pageId: 12, pageLabel: 'stranger', platform: 'onlyfans', platformAccountId: '3999' }, { pageId: 13, pageLabel: 'no-id', platform: 'fansly', platformAccountId: null }] });
    w.page.tabs = 0;
    await poller.tick();
    state.enabled = false;
    w.page.tabs = 1;
    await poller.tick();
    expect(state.reads).toEqual([]);
    state.enabled = true;
    state.answers.push(new Error('hub down'));
    await poller.tick();
    expect(state.reads).toEqual([{ label: 'model-one', hours: 48 }]);
    expect(w.log.entries).toEqual([{ level: 'warn', scope: 'bg.sound', msg: 'subscriber poll failed', fields: { pageId: 11 } }]);
    // The failed poll set no baseline: the next one is the first snapshot.
    state.answers.push(audience([{ ref: 'e1' }], NOW));
    await poller.tick();
    expect(w.arbiter.diagnostics().outcomes).toEqual({ 'subscriber.first-snapshot': 1 });
    // Two ticks at once are one round.
    const before = state.reads.length;
    await Promise.all([poller.tick(), poller.tick()]);
    expect(state.reads).toHaveLength(before + 1);
    // start() twice is one timer.
    poller.start();
    poller.start();
    await settle();
    await w.clock.advance(60_000);
    expect(state.reads).toHaveLength(before + 3);
    poller.stop();
  });
});
