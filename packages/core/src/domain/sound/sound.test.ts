// Which events ring and how they sound (architecture.md §9.8): the pure
// policy, the eight tones, the duplicate guard. Test titles carry the parity
// rows; ids are synthetic.

import { DEFAULT_SETTINGS, SOUND_TONE_IDS, type IncomingFact, type SettingsV1 } from '@cg/contracts';
import { describe, expect, it } from 'vitest';

import {
  BURST_WINDOW_MS,
  HOST_PLATFORM,
  LIVE_EDGE_MS,
  MESSAGE_THROTTLE_MS,
  NO_RINGS,
  PLATFORM_DEFAULT_TONES,
  SEEN_MAX,
  SEEN_TTL_MS,
  SOUND_OUTCOMES,
  STALE_MESSAGE_MS,
  STALE_SUBSCRIBER_MS,
  SUBSCRIBER_THROTTLE_MS,
  SeenEvents,
  TONES,
  accountKeyOf,
  classifyFact,
  consumesEvent,
  gateMessage,
  gateSubscriber,
  isThrottled,
  isToneId,
  normalizeVolume,
  reserveRing,
  resolveTone,
  seenKey,
  timeOf,
  toneDurationMs,
  toneOf,
  volumeToGain,
  withAccountMuted,
  type MessageGate,
  type SubscriberGate,
} from './index';

const NOW = Date.parse('2026-10-03T10:00:00.000Z');
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();
const SOUND = DEFAULT_SETTINGS.sound;
const fact = (patch: Partial<IncomingFact> = {}): IncomingFact => ({
  host: 'chatspace',
  hostAccountId: '1001',
  platformFanId: '2002',
  platformMessageId: '4004',
  fromFan: true,
  automatic: false,
  tip: false,
  sentAt: iso(2000),
  socketEpoch: 1,
  fanSequence: 1,
  source: 'ws-tap',
  ...patch,
});
const gate = (patch: Partial<MessageGate> = {}): MessageGate => ({
  fact: fact(),
  now: NOW,
  sound: SOUND,
  ownerSwitch: null,
  hostPermission: true,
  phase: 'live',
  account: { known: true, key: 'chatspace:1001' },
  ...patch,
});
const withSound = (patch: Partial<SettingsV1['sound']>): SettingsV1['sound'] => ({ ...SOUND, ...patch });

describe('which messages ring', () => {
  it('[SN-001] a fresh message from a fan on a known, unmuted account is eligible — signed in to the hub or not', () => {
    expect(gateMessage(gate())).toBeNull();
    // The owner's switch is unknown before sign-in: the message sound needs no hub.
    expect(gateMessage(gate({ ownerSwitch: null }))).toBeNull();
    expect(gateMessage(gate({ ownerSwitch: true }))).toBeNull();
  });

  it('the sound is off, the owner switched it off, or there is no host permission: nothing rings', () => {
    expect(gateMessage(gate({ sound: withSound({ messages: { on: false, tone: 'chime' } }) }))).toBe('disabled');
    expect(gateMessage(gate({ ownerSwitch: false }))).toBe('disabled');
    expect(gateMessage(gate({ hostPermission: false }))).toBe('no-permission');
  });

  it('[SN-002] our own and outgoing messages never ring', () => {
    expect(gateMessage(gate({ fact: fact({ fromFan: false }) }))).toBe('not-fan');
  });

  it('[SN-003] queued and automatic messages never ring', () => {
    expect(gateMessage(gate({ fact: fact({ automatic: true }) }))).toBe('automatic');
  });

  it('[SN-004] tips ring nothing: ChatSpace has its own notification for money', () => {
    expect(gateMessage(gate({ fact: fact({ tip: true }) }))).toBe('tip');
  });

  it('[SN-005] only fresh events: older than 180 s or with no time at all is silent', () => {
    expect(STALE_MESSAGE_MS).toBe(180_000);
    expect(gateMessage(gate({ fact: fact({ sentAt: iso(STALE_MESSAGE_MS) }) }))).toBeNull();
    expect(gateMessage(gate({ fact: fact({ sentAt: iso(STALE_MESSAGE_MS + 1) }) }))).toBe('stale');
    expect(gateMessage(gate({ fact: fact({ sentAt: null }) }))).toBe('no-time');
    // A clock a little ahead on the other side is not «stale».
    expect(gateMessage(gate({ fact: fact({ sentAt: iso(-5000) }) }))).toBeNull();
    expect(timeOf('not a time')).toBeNull();
  });

  it('a first snapshot and a reconnect are not live events', () => {
    expect(gateMessage(gate({ phase: 'first-snapshot' }))).toBe('first-snapshot');
    expect(gateMessage(gate({ phase: 'reconnect' }))).toBe('reconnect');
  });

  it('[SN-006] [ST-075] a muted account is silent; an account this browser does not know is silent too', () => {
    expect(gateMessage(gate({ sound: withSound({ mutedAccounts: ['chatspace:1001'] }) }))).toBe('muted');
    expect(gateMessage(gate({ sound: withSound({ mutedAccounts: ['chatspace:1002', 'fansly-web:1001'] }) }))).toBeNull();
    expect(gateMessage(gate({ account: { known: false, key: 'chatspace:1001' } }))).toBe('account-unknown');
    expect(accountKeyOf(fact({ host: 'fansly-web', hostAccountId: '77' }))).toBe('fansly-web:77');
    // The model's switch: in and out, no repeats, the others untouched.
    expect(withAccountMuted(['chatspace:1002'], 'chatspace:1001', true)).toEqual(['chatspace:1002', 'chatspace:1001']);
    expect(withAccountMuted(['chatspace:1001', 'chatspace:1002'], 'chatspace:1001', true)).toEqual(['chatspace:1002', 'chatspace:1001']);
    expect(withAccountMuted(['chatspace:1001', 'chatspace:1002'], 'chatspace:1001', false)).toEqual(['chatspace:1002']);
  });

  it('the reasons are checked in a fixed order: the switch, then what the message is, then how fresh, then whose', () => {
    const everything = gate({ sound: withSound({ messages: { on: false, tone: 'chime' }, mutedAccounts: ['chatspace:1001'] }), hostPermission: false, fact: fact({ fromFan: false, automatic: true, tip: true, sentAt: null }), phase: 'reconnect', account: { known: false, key: 'chatspace:1001' } });
    expect(gateMessage(everything)).toBe('disabled');
    expect(gateMessage({ ...everything, sound: withSound({ mutedAccounts: ['chatspace:1001'] }) })).toBe('no-permission');
    expect(gateMessage(gate({ fact: fact({ fromFan: false, automatic: true, tip: true }) }))).toBe('not-fan');
    expect(gateMessage(gate({ fact: fact({ automatic: true, tip: true, sentAt: null }) }))).toBe('automatic');
    expect(gateMessage(gate({ fact: fact({ sentAt: iso(STALE_MESSAGE_MS * 2) }), phase: 'first-snapshot' }))).toBe('stale');
    expect(gateMessage(gate({ phase: 'first-snapshot', account: { known: false, key: 'chatspace:1001' } }))).toBe('first-snapshot');
  });
});

describe('[SN-005] is a fact live', () => {
  it('a frame the WS tap saw is a push that just happened: live from the first one, on any epoch', () => {
    const first = classifyFact(fact({ source: 'ws-tap', socketEpoch: 3 }), null, NOW);
    expect(first.phase).toBe('live');
    const next = classifyFact(fact({ source: 'ws-tap', socketEpoch: 4 }), first.next, NOW + 1000);
    expect([next.phase, next.next.socketEpoch, next.next.since]).toEqual(['live', 4, NOW + 1000]);
    // A late frame of the old socket is still a push, but the tab stays on the newer epoch.
    const late = classifyFact(fact({ source: 'ws-tap', socketEpoch: 3 }), next.next, NOW + 2000);
    expect([late.phase, late.next]).toEqual(['live', next.next]);
  });

  it('[SN-005] what the store held before the tab began to listen is its first snapshot — in the first burst, on a second report, on the next page of the list', () => {
    const first = classifyFact(fact({ source: 'store', sentAt: iso(100_000) }), null, NOW);
    expect(first.phase).toBe('first-snapshot');
    expect(first.next).toEqual({ socketEpoch: 1, since: NOW, quietUntil: NOW + BURST_WINDOW_MS, quietPhase: 'first-snapshot' });
    expect(classifyFact(fact({ source: 'store', sentAt: iso(100_000), platformMessageId: '4005' }), first.next, NOW + BURST_WINDOW_MS - 1).phase).toBe('first-snapshot');
    // The same fact reported again two seconds later; an older chat from the next page of the list after five.
    const again = classifyFact(fact({ source: 'store', sentAt: iso(100_000) }), first.next, NOW + 2000);
    expect([again.phase, again.next]).toEqual(['first-snapshot', first.next]);
    expect(classifyFact(fact({ source: 'store', sentAt: iso(120_000), platformMessageId: '4006' }), first.next, NOW + 5000).phase).toBe('first-snapshot');
    // The line is «sent LIVE_EDGE_MS before the tab began to listen», wherever the clock is now.
    expect(classifyFact(fact({ source: 'store', sentAt: iso(LIVE_EDGE_MS + 1) }), first.next, NOW + 60_000).phase).toBe('first-snapshot');
    expect(classifyFact(fact({ source: 'store', sentAt: iso(LIVE_EDGE_MS) }), first.next, NOW + 60_000).phase).toBe('live');
    // Sent after the tab began to listen: live even when the store hands it over late (a slow push, clocks apart).
    expect(classifyFact(fact({ source: 'store', sentAt: iso(-10_000) }), first.next, NOW + 60_000).phase).toBe('live');
    // The burst itself still covers what the line lets through: 14.5 s before the tab began, read one second in.
    expect(classifyFact(fact({ source: 'store', sentAt: iso(14_500) }), first.next, NOW + 1000).phase).toBe('first-snapshot');
    expect(classifyFact(fact({ source: 'store', sentAt: iso(14_500) }), first.next, NOW + BURST_WINDOW_MS).phase).toBe('live');
  });

  it('[SN-005] what the socket missed before a reconnect stays silent however slowly the resync brings it', () => {
    const first = classifyFact(fact({ source: 'store', sentAt: iso(100_000) }), null, NOW);
    const back = NOW + 600_000;
    const before = (ms: number): string => new Date(back - ms).toISOString();
    const reconnected = classifyFact(fact({ source: 'store', sentAt: before(60_000), socketEpoch: 2 }), first.next, back);
    expect(reconnected.phase).toBe('reconnect');
    expect(reconnected.next).toEqual({ socketEpoch: 2, since: back, quietUntil: back + BURST_WINDOW_MS, quietPhase: 'reconnect' });
    expect(classifyFact(fact({ source: 'store', sentAt: before(60_000), socketEpoch: 2 }), reconnected.next, back + 100).phase).toBe('reconnect');
    // A slow REST resync: five seconds after the socket came back, a message missed two minutes before it.
    expect(classifyFact(fact({ source: 'store', sentAt: before(120_000), socketEpoch: 2, platformMessageId: '4007' }), reconnected.next, back + 5000).phase).toBe('reconnect');
    // An older epoch arriving late starts no reconnect of its own and is judged by the same line.
    const late = classifyFact(fact({ source: 'store', sentAt: before(120_000), socketEpoch: 1 }), reconnected.next, back + 20_000);
    expect([late.phase, late.next]).toEqual(['reconnect', reconnected.next]);
    // Sent after the socket came back: live.
    expect(classifyFact(fact({ source: 'store', sentAt: before(-20_000), socketEpoch: 2 }), reconnected.next, back + 60_000).phase).toBe('live');
  });

  it('[SN-005] the verdict does not depend on which source reports first: a tap frame begins the epoch as a store fact does', () => {
    // First snapshot: one pushed frame, then the store's read of what was there before the tab.
    const tap = classifyFact(fact({ source: 'ws-tap', socketEpoch: 5 }), null, NOW);
    expect(tap.phase).toBe('live');
    expect(tap.next).toEqual({ socketEpoch: 5, since: NOW, quietUntil: NOW + BURST_WINDOW_MS, quietPhase: 'first-snapshot' });
    expect(classifyFact(fact({ source: 'store', socketEpoch: 5, sentAt: iso(60_000), platformFanId: '2003' }), tap.next, NOW + 10_000).phase).toBe('first-snapshot');
    // Reconnect: a pushed frame on the new epoch first, then the refetch of a message missed a minute before it.
    const back = NOW + 300_000;
    const again = classifyFact(fact({ source: 'ws-tap', socketEpoch: 6 }), tap.next, back);
    expect([again.phase, again.next.since, again.next.quietPhase]).toEqual(['live', back, 'reconnect']);
    expect(classifyFact(fact({ source: 'store', socketEpoch: 6, sentAt: new Date(back - 60_000).toISOString() }), again.next, back + 3000).phase).toBe('reconnect');
  });

  it('a message seconds old is news whatever brought it; without a time it cannot be', () => {
    expect(classifyFact(fact({ source: 'store', sentAt: iso(LIVE_EDGE_MS) }), null, NOW).phase).toBe('live');
    expect(classifyFact(fact({ source: 'store', sentAt: iso(LIVE_EDGE_MS + 1) }), null, NOW).phase).toBe('first-snapshot');
    expect(classifyFact(fact({ source: 'store', sentAt: null }), null, NOW).phase).toBe('first-snapshot');
    const begun = classifyFact(fact({ source: 'store' }), null, NOW);
    expect(begun.phase).toBe('live');
    expect(classifyFact(fact({ source: 'store', sentAt: null }), begun.next, NOW + 60_000).phase).toBe('first-snapshot');
  });
});

describe('[SN-009] [SN-012] the throttle', () => {
  it('[SN-009] at most one message sound per 2 s', () => {
    expect(isThrottled('message', NO_RINGS, NOW)).toBe(false);
    const rang = reserveRing('message', NO_RINGS, NOW);
    expect(isThrottled('message', rang, NOW + MESSAGE_THROTTLE_MS - 1)).toBe(true);
    expect(isThrottled('message', rang, NOW + MESSAGE_THROTTLE_MS)).toBe(false);
  });

  it('[SN-012] a subscriber rings at most once per 10 s, never over a message, and never takes a message\'s sound', () => {
    const subscriber = reserveRing('subscriber', NO_RINGS, NOW);
    expect(isThrottled('subscriber', subscriber, NOW + SUBSCRIBER_THROTTLE_MS - 1)).toBe(true);
    expect(isThrottled('subscriber', subscriber, NOW + SUBSCRIBER_THROTTLE_MS)).toBe(false);
    // A message right after a subscriber still rings…
    expect(isThrottled('message', subscriber, NOW + 1)).toBe(false);
    // …and a subscriber waits out a message's 2 s.
    const message = reserveRing('message', NO_RINGS, NOW);
    expect(isThrottled('subscriber', message, NOW + MESSAGE_THROTTLE_MS - 1)).toBe(true);
    expect(isThrottled('subscriber', message, NOW + MESSAGE_THROTTLE_MS)).toBe(false);
    expect(reserveRing('subscriber', message, NOW + 5).lastMessageAt).toBe(NOW);
  });
});

describe('[SN-012] which subscribers ring', () => {
  const subscriber = (patch: Partial<SubscriberGate> = {}): SubscriberGate => ({
    event: { eventRef: 'evt_1', platform: 'onlyfans', platformAccountId: '3003', subscribedAt: iso(30_000) },
    now: NOW,
    sound: SOUND,
    ownerSwitch: true,
    hub: true,
    firstSnapshot: false,
    accounts: ['chatspace:1001'],
    ...patch,
  });

  it('a new subscriber of a creator this browser works with rings; it needs the hub', () => {
    expect(gateSubscriber(subscriber())).toBeNull();
    expect(gateSubscriber(subscriber({ hub: false }))).toBe('no-hub');
    expect(gateSubscriber(subscriber({ sound: withSound({ subscribers: { on: false, tone: 'double' } }) }))).toBe('disabled');
    expect(gateSubscriber(subscriber({ ownerSwitch: false }))).toBe('disabled');
    // The message switch does not silence subscribers.
    expect(gateSubscriber(subscriber({ sound: withSound({ messages: { on: false, tone: 'chime' } }) }))).toBeNull();
  });

  it('[SN-012] news is what appeared since a recent look at the list: within 180 s of the last answer (by the hub’s clock) an event rings whatever its own `subscribedAt` — a subscription the hub recorded late is still news', () => {
    // Subscribed twelve minutes ago; the hub put it into the list only now.
    const late = { eventRef: 'evt_late', platform: 'onlyfans' as const, platformAccountId: '3003', subscribedAt: iso(12 * 60_000) };
    expect(gateSubscriber(subscriber({ event: late }))).toBe('stale');
    for (const sinceBaselineMs of [0, 30_000, 60_000, 180_000]) expect(gateSubscriber(subscriber({ event: late, sinceBaselineMs })), String(sinceBaselineMs)).toBeNull();
    // Without a time of its own it is news all the same: the list did not have it a minute ago.
    expect(gateSubscriber(subscriber({ event: { ...late, subscribedAt: 'x' }, sinceBaselineMs: 60_000 }))).toBeNull();
    // After a longer gap (a reconnect, a sleeping laptop), an unknown one, or a hub clock that went back: the
    // subscription's own age decides, as before.
    for (const sinceBaselineMs of [180_001, 3_600_000, null, -1]) {
      expect(gateSubscriber(subscriber({ event: late, sinceBaselineMs })), String(sinceBaselineMs)).toBe('stale');
      expect(gateSubscriber(subscriber({ sinceBaselineMs })), String(sinceBaselineMs)).toBeNull();
      expect(gateSubscriber(subscriber({ event: { ...late, subscribedAt: 'x' }, sinceBaselineMs })), String(sinceBaselineMs)).toBe('no-time');
    }
    // A recent look never overrides the other rules: the first snapshot, the switches, the mute.
    expect(gateSubscriber(subscriber({ event: late, sinceBaselineMs: 1_000, firstSnapshot: true }))).toBe('first-snapshot');
    expect(gateSubscriber(subscriber({ event: late, sinceBaselineMs: 1_000, ownerSwitch: false }))).toBe('disabled');
    expect(gateSubscriber(subscriber({ event: late, sinceBaselineMs: 1_000, hub: false }))).toBe('no-hub');
    expect(gateSubscriber(subscriber({ event: late, sinceBaselineMs: 1_000, accounts: [] }))).toBe('account-unknown');
  });

  it('the first poll of a page is its baseline; an old subscription and one without a time are history', () => {
    expect(gateSubscriber(subscriber({ firstSnapshot: true }))).toBe('first-snapshot');
    // §9.8 «событие старше 180 с»: one line for messages and subscriptions.
    expect(STALE_SUBSCRIBER_MS).toBe(STALE_MESSAGE_MS);
    const old = { eventRef: 'evt_2', platform: 'onlyfans' as const, platformAccountId: '3003', subscribedAt: iso(180_001) };
    expect(gateSubscriber(subscriber({ event: old }))).toBe('stale');
    expect(gateSubscriber(subscriber({ event: { ...old, subscribedAt: iso(180_000) } }))).toBeNull();
    expect(gateSubscriber(subscriber({ event: { ...old, subscribedAt: 'x' } }))).toBe('no-time');
  });

  it('[ST-075] the model\'s switch silences subscribers too; a creator with no known account is silent', () => {
    expect(gateSubscriber(subscriber({ sound: withSound({ mutedAccounts: ['chatspace:1001'] }) }))).toBe('muted');
    expect(gateSubscriber(subscriber({ accounts: ['chatspace:1001', 'chatspace:1002'], sound: withSound({ mutedAccounts: ['chatspace:1002'] }) }))).toBe('muted');
    expect(gateSubscriber(subscriber({ accounts: [] }))).toBe('account-unknown');
  });
});

describe('[SN-010] duplicates', () => {
  it('an event is decided once per 10 minutes by (platform, account, id)', () => {
    const seen = new SeenEvents();
    const key = seenKey('onlyfans', '1001', '4004');
    expect(key).toBe('onlyfans:1001:4004');
    expect(seen.has(key, NOW)).toBe(false);
    seen.consume(key, NOW);
    expect(seen.has(key, NOW + SEEN_TTL_MS - 1)).toBe(true);
    expect(seen.has(key, NOW + SEEN_TTL_MS)).toBe(false);
    // The same id on another account or platform is another event.
    expect(seen.has(seenKey('onlyfans', '1002', '4004'), NOW)).toBe(false);
    expect(seen.has(seenKey('fansly', '1001', '4004'), NOW)).toBe(false);
    expect(seen.size).toBe(0);
  });

  it('at most 2000 are kept: the oldest leave first, a repeated one moves to the newest', () => {
    const seen = new SeenEvents();
    for (let i = 0; i < SEEN_MAX; i += 1) seen.consume(`k${i}`, NOW);
    seen.consume('k0', NOW + 1);
    seen.consume('extra', NOW + 1);
    expect(seen.size).toBe(SEEN_MAX);
    expect(seen.has('k1', NOW + 2)).toBe(false);
    expect(seen.has('k0', NOW + 2)).toBe(true);
    expect(seen.has('extra', NOW + 2)).toBe(true);
  });

  it('the state survives an event-page unload as plain data; nothing malformed, expired or far in the future is trusted', () => {
    const seen = new SeenEvents();
    seen.consume('a', NOW);
    seen.consume('b', NOW + 1000);
    const stored = seen.snapshot(NOW + 2000);
    expect(stored).toEqual([['a', NOW + SEEN_TTL_MS], ['b', NOW + 1000 + SEEN_TTL_MS]]);
    const restored = new SeenEvents();
    expect(restored.restore(JSON.parse(JSON.stringify(stored)), NOW + 3000)).toBe(2);
    expect(restored.has('a', NOW + 3000)).toBe(true);
    const careful = new SeenEvents();
    expect(careful.restore([['old', NOW - 1], ['far', NOW + SEEN_TTL_MS * 2], ['', NOW + 10], [1, 2], 'x', ['ok', NOW + 5000]], NOW)).toBe(1);
    expect(careful.has('ok', NOW)).toBe(true);
    expect(careful.restore({ not: 'an array' }, NOW)).toBe(0);
    expect(new SeenEvents().snapshot(NOW)).toEqual([]);
  });

  it('only a fact about the event itself settles it; a fact about who reported it leaves the id free for another tab\'s live copy', () => {
    const settles = SOUND_OUTCOMES.filter(consumesEvent);
    expect(settles).toEqual(['duplicate', 'disabled', 'not-fan', 'automatic', 'tip', 'stale', 'muted', 'open-chat', 'throttled', 'played', 'audio-error']);
    for (const outcome of ['first-snapshot', 'reconnect', 'account-unknown', 'no-time', 'tab-closed', 'no-permission', 'no-hub', 'invalid'] as const) expect(consumesEvent(outcome)).toBe(false);
  });
});

describe('[SN-013] the eight tones', () => {
  it('chime, drop, bell, arpeggio, knock, double, soft, blip — every tone id of the settings has its table', () => {
    expect(Object.keys(TONES).sort()).toEqual([...SOUND_TONE_IDS].sort());
    expect(SOUND_TONE_IDS).toHaveLength(8);
    for (const id of SOUND_TONE_IDS) {
      const tone = toneOf(id);
      expect(tone.notes.length).toBeGreaterThan(0);
      expect(toneDurationMs(tone)).toBeLessThan(1000);
      for (const note of tone.notes) {
        expect(note.frequencyHz).toBeGreaterThanOrEqual(200);
        expect(note.frequencyHz).toBeLessThanOrEqual(4000);
        expect(note.attackMs).toBeLessThan(note.durationMs);
        // A glide has both its target and its time, and is over before the note is.
        expect(note.endFrequencyHz === undefined).toBe(note.glideMs === undefined);
        if (note.glideMs !== undefined) expect(note.glideMs).toBeLessThanOrEqual(note.durationMs);
      }
    }
    expect(isToneId('bell')).toBe(true);
    expect(isToneId('gong')).toBe(false);
  });

  it('the tables are the Fansly extension\'s, note for note; blip is the OnlyFans desktop app\'s', () => {
    expect(TONES.blip).toEqual({ notes: [{ wave: 'sine', startMs: 0, durationMs: 180, frequencyHz: 880, endFrequencyHz: 1320, glideMs: 80, attackMs: 20 }] });
    expect(TONES.chime.notes).toEqual([
      { wave: 'sine', startMs: 0, durationMs: 160, frequencyHz: 1047, attackMs: 10 },
      { wave: 'sine', startMs: 110, durationMs: 300, frequencyHz: 1760, attackMs: 10 },
    ]);
    expect(TONES.double.notes.map((note) => [note.startMs, note.frequencyHz])).toEqual([[0, 1320], [130, 1320]]);
    expect(TONES.arpeggio.notes.map((note) => note.frequencyHz)).toEqual([880, 1109, 1319]);
    expect(TONES.bell.notes.map((note) => [note.frequencyHz, note.durationMs])).toEqual([[1568, 700], [3136, 250]]);
    expect(TONES.drop.notes[0]).toMatchObject({ frequencyHz: 1400, endFrequencyHz: 520, glideMs: 100 });
    expect(TONES.knock.notes.map((note) => [note.wave, note.startMs])).toEqual([['triangle', 0], ['triangle', 140]]);
    expect(TONES.soft.notes[0]).toMatchObject({ wave: 'triangle', frequencyHz: 660, endFrequencyHz: 990, durationMs: 350 });
    expect(toneDurationMs(TONES.chime)).toBe(410);
  });

  it('[SN-013] the volume is 5–100 in steps of 5 and maps to loudness the way ears expect: 50 is the desktop blip\'s 0.06', () => {
    expect(volumeToGain(50)).toBeCloseTo(0.06, 6);
    expect(volumeToGain(100)).toBeCloseTo(0.24, 6);
    expect(volumeToGain(5)).toBeCloseTo(0.0006, 6);
    expect(normalizeVolume(52)).toBe(50);
    expect(normalizeVolume(0)).toBe(5);
    expect(normalizeVolume(1000)).toBe(100);
    expect(normalizeVolume('loud')).toBe(50);
    expect(normalizeVolume(Number.NaN)).toBe(50);
  });

  it('[SN-013] OnlyFans and Fansly have different default tones; an explicit choice wins on both', () => {
    // The pilot host rings exactly what the settings page shows by default.
    expect(PLATFORM_DEFAULT_TONES.onlyfans).toEqual({ message: SOUND.messages.tone, subscriber: SOUND.subscribers.tone });
    expect(PLATFORM_DEFAULT_TONES.fansly).not.toEqual(PLATFORM_DEFAULT_TONES.onlyfans);
    // Each platform rings what its own old client rang: the desktop app's pair on OnlyFans, the Fansly extension's on Fansly (X26).
    expect(resolveTone('message', 'onlyfans', SOUND, SOUND)).toBe('blip');
    expect(resolveTone('subscriber', 'onlyfans', SOUND, SOUND)).toBe('arpeggio');
    expect(resolveTone('message', 'fansly', SOUND, SOUND)).toBe('chime');
    expect(resolveTone('subscriber', 'fansly', SOUND, SOUND)).toBe('double');
    // A tone stored before 1.12.0 (the old default) is a choice of its own: it rings on.
    const before = withSound({ messages: { on: true, tone: 'chime' }, subscribers: { on: true, tone: 'double' } });
    expect(resolveTone('message', 'onlyfans', before, SOUND)).toBe('chime');
    expect(resolveTone('subscriber', 'onlyfans', before, SOUND)).toBe('double');
    const chosen = withSound({ messages: { on: true, tone: 'bell' }, subscribers: { on: true, tone: 'knock' } });
    for (const platform of ['onlyfans', 'fansly'] as const) {
      expect(resolveTone('message', platform, chosen, SOUND)).toBe('bell');
      expect(resolveTone('subscriber', platform, chosen, SOUND)).toBe('knock');
    }
    expect(HOST_PLATFORM).toEqual({ chatspace: 'onlyfans', 'fansly-web': 'fansly' });
  });
});
