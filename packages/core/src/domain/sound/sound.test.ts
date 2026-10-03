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

describe('is a fact live', () => {
  it('a frame the WS tap saw is a push that just happened: live from the first one, on any epoch', () => {
    const first = classifyFact(fact({ source: 'ws-tap', socketEpoch: 3 }), null, NOW);
    expect(first.phase).toBe('live');
    expect(classifyFact(fact({ source: 'ws-tap', socketEpoch: 4 }), first.next, NOW).phase).toBe('live');
  });

  it('the first read of a tab\'s store is a snapshot and the first after a reconnect is a reconnect — with everything that comes in the same burst', () => {
    const old = iso(60_000);
    const first = classifyFact(fact({ source: 'store', sentAt: old }), null, NOW);
    expect(first.phase).toBe('first-snapshot');
    expect(classifyFact(fact({ source: 'store', sentAt: old, platformMessageId: '4005' }), first.next, NOW + BURST_WINDOW_MS - 1).phase).toBe('first-snapshot');
    // After the burst the store's facts are live.
    expect(classifyFact(fact({ source: 'store', sentAt: old }), first.next, NOW + BURST_WINDOW_MS).phase).toBe('live');
    const reconnected = classifyFact(fact({ source: 'store', sentAt: old, socketEpoch: 2 }), first.next, NOW + 60_000);
    expect(reconnected.phase).toBe('reconnect');
    expect(classifyFact(fact({ source: 'store', sentAt: old, socketEpoch: 2 }), reconnected.next, NOW + 60_100).phase).toBe('reconnect');
    // An older epoch arriving late is not a reconnect.
    expect(classifyFact(fact({ source: 'store', sentAt: old, socketEpoch: 1 }), reconnected.next, NOW + 120_000).phase).toBe('live');
  });

  it('a message seconds old is news whatever brought it; without a time it cannot be', () => {
    expect(classifyFact(fact({ source: 'store', sentAt: iso(LIVE_EDGE_MS) }), null, NOW).phase).toBe('live');
    expect(classifyFact(fact({ source: 'store', sentAt: iso(LIVE_EDGE_MS + 1) }), null, NOW).phase).toBe('first-snapshot');
    expect(classifyFact(fact({ source: 'store', sentAt: null }), null, NOW).phase).toBe('first-snapshot');
    // The tap after the store: the tap's epoch is remembered, the store's next fact on it is live.
    const tap = classifyFact(fact({ source: 'ws-tap', socketEpoch: 5 }), null, NOW);
    expect(classifyFact(fact({ source: 'store', socketEpoch: 5, sentAt: iso(60_000) }), tap.next, NOW + 10_000).phase).toBe('live');
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

  it('the first poll of a page is its baseline; an old subscription and one without a time are history', () => {
    expect(gateSubscriber(subscriber({ firstSnapshot: true }))).toBe('first-snapshot');
    const old = { eventRef: 'evt_2', platform: 'onlyfans' as const, platformAccountId: '3003', subscribedAt: iso(STALE_SUBSCRIBER_MS + 1) };
    expect(gateSubscriber(subscriber({ event: old }))).toBe('stale');
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
    expect(resolveTone('message', 'onlyfans', SOUND, SOUND)).toBe('chime');
    expect(resolveTone('subscriber', 'onlyfans', SOUND, SOUND)).toBe('double');
    expect(resolveTone('message', 'fansly', SOUND, SOUND)).toBe('blip');
    expect(resolveTone('subscriber', 'fansly', SOUND, SOUND)).toBe('arpeggio');
    const chosen = withSound({ messages: { on: true, tone: 'bell' }, subscribers: { on: true, tone: 'knock' } });
    for (const platform of ['onlyfans', 'fansly'] as const) {
      expect(resolveTone('message', platform, chosen, SOUND)).toBe('bell');
      expect(resolveTone('subscriber', platform, chosen, SOUND)).toBe('knock');
    }
    expect(HOST_PLATFORM).toEqual({ chatspace: 'onlyfans', 'fansly-web': 'fansly' });
  });
});
