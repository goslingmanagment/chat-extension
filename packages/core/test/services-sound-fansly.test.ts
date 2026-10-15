// The one sound arbiter with Fansly's facts (R20 P14a; docs/project-unite/
// architecture.md §8.12; FS-SND-1, FS-SND-2): the shared rules decide a
// message of Fansly's socket the site names the author of, and a new
// subscriber its page heard itself — with no hub, beside ChatSpace's facts,
// on one chain, one throttle and one memory of what was decided. The ids are
// synthetic; the site's tones come as the composition root gives them.

import { DEFAULT_SETTINGS, type HostAccount, type IncomingFact, type SettingsV1 } from '@cg/contracts';
import { MESSAGE_THROTTLE_MS, SUBSCRIBER_THROTTLE_MS, TONES, ownAccountIds, type SoundTone, type SoundTones } from '@cg/core/domain/sound';
import { SoundArbiter, type PageFollow } from '@cg/core/services/sound';
import { describe, expect, it } from 'vitest';

import { FakeClock, MemoryStore } from './support/clock';

const NOW = Date.parse('2026-10-15T10:00:00.000Z');
const CREATOR = '801000000000000001';
const MODEL_TWO = '801000000000000002';
/** The creator's other name in the site's session (a legacy id, AU-032). */
const LEGACY = '42424242';
const FAN = '802000000000000011';
const FANSLY: HostAccount = { host: 'fansly-web', hostAccountId: CREATOR, platform: 'fansly', platformAccountId: CREATOR, username: 'model_one', displayName: 'Model One' };
const FANSLY_TWO: HostAccount = { host: 'fansly-web', hostAccountId: MODEL_TWO, platform: 'fansly', platformAccountId: MODEL_TWO, username: 'model_two', displayName: 'Model Two' };
/** A ChatSpace account whose OnlyFans creator id is the number of a Fansly fan: another platform, not ours there. */
const CHATSPACE: HostAccount = { host: 'chatspace', hostAccountId: '1001', platform: 'onlyfans', platformAccountId: FAN, username: 'of_model', displayName: 'OF Model' };
/** Fansly's pair as the composition root gives it: the Fansly section of `settings.ext`, X26's chime and double untouched. */
const FANSLY_TONES: SoundTones = { message: 'chime', subscriber: 'double' };

interface World {
  readonly clock: FakeClock;
  readonly played: { tone: SoundTone; at: number }[];
  readonly page: { sound: SettingsV1['sound'] | null; ownerSwitch: boolean | null; tabs: number; focused: string | null; accounts: HostAccount[]; aliases: string[]; tones: SoundTones };
  readonly arbiter: SoundArbiter;
}

function world(): World {
  const clock = new FakeClock(NOW);
  const played: World['played'] = [];
  const page: World['page'] = { sound: DEFAULT_SETTINGS.sound, ownerSwitch: null, tabs: 1, focused: null, accounts: [FANSLY, FANSLY_TWO, CHATSPACE], aliases: [LEGACY], tones: FANSLY_TONES };
  const arbiter = new SoundArbiter({
    clock,
    audio: {
      prepare: () => Promise.resolve(true),
      play: (tone) => {
        played.push({ tone, at: clock.now() });
        return Promise.resolve({ played: true });
      },
    },
    presence: { listeningTabs: () => page.tabs, isChatInFocus: (chatKey) => chatKey === page.focused, accounts: () => page.accounts },
    settings: () => page.sound,
    ownerSwitch: () => page.ownerSwitch,
    hostPermission: () => true,
    session: new MemoryStore(),
    // As the composition root wires them: the site's pair and its session's aliases by the platform, none elsewhere.
    siteTones: (platform) => (platform === 'fansly' ? page.tones : null),
    aliases: (platform) => (platform === 'fansly' ? page.aliases : []),
  });
  return { clock, played, page, arbiter };
}

let nextId = 803000000000000100n;
const nextMessage = (): string => String((nextId += 1n));
/** A `5/1` of Fansly's socket as the background takes it: the creator's account, the group's fan, pushed now. */
const fact = (w: World, patch: Partial<IncomingFact> = {}): IncomingFact => ({
  host: 'fansly-web',
  hostAccountId: CREATOR,
  platformFanId: FAN,
  platformMessageId: nextMessage(),
  fromFan: true,
  automatic: false,
  tip: false,
  sentAt: new Date(w.clock.now() - 1000).toISOString(),
  socketEpoch: 0,
  fanSequence: 0,
  source: 'ws-tap',
  ...patch,
});
const follow = (patch: Partial<PageFollow> = {}): PageFollow => ({ host: 'fansly-web', hostAccountId: CREATOR, eventId: nextMessage(), accountId: CREATOR, followerId: '802000000000000077', ...patch });
const sound = (patch: Partial<SettingsV1['sound']>): SettingsV1['sound'] => ({ ...DEFAULT_SETTINGS.sound, ...patch });

describe('[host:fansly] the one arbiter with Fansly’s messages (R20 P14a)', () => {
  it('[host:fansly] [SN-001] [ST-127] a fan’s new message rings Fansly’s own message tone — chime untouched, the Fansly section’s choice when made — with no hub sign-in', async () => {
    const w = world();
    expect(await w.arbiter.handleIncoming('tab-f', fact(w), FAN)).toBe('played');
    expect(w.played.map((entry) => entry.tone)).toEqual([TONES.chime]);
    // The person's Fansly choice (settings.ext); ChatSpace's own choice in the settings does not reach Fansly.
    w.page.tones = { message: 'bell', subscriber: 'knock' };
    w.page.sound = sound({ messages: { on: true, tone: 'drop' } });
    await w.clock.advance(MESSAGE_THROTTLE_MS);
    expect(await w.arbiter.handleIncoming('tab-f', fact(w), FAN)).toBe('played');
    expect(w.played.map((entry) => entry.tone)).toEqual([TONES.chime, TONES.bell]);
  });

  it('[host:fansly] [SN-002] own and outgoing never ring: the creator’s message, another model this browser has seen, the creator under its legacy id; a fan of the same number on another platform is still a fan', async () => {
    const w = world();
    expect(await w.arbiter.handleIncoming('tab-f', fact(w, { fromFan: false }), CREATOR)).toBe('not-fan');
    // MAIN calls a message «the fan's» when its sender is not the tab's creator; the background knows the agency's other models.
    expect(await w.arbiter.handleIncoming('tab-f', fact(w, { platformFanId: MODEL_TWO }), MODEL_TWO)).toBe('not-fan');
    expect(await w.arbiter.handleIncoming('tab-f', fact(w), LEGACY)).toBe('not-fan');
    // A model this browser has seen a moment ago counts at once.
    w.page.accounts = [...w.page.accounts, { ...FANSLY_TWO, hostAccountId: '801000000000000003', platformAccountId: '801000000000000003' }];
    expect(await w.arbiter.handleIncoming('tab-f', fact(w), '801000000000000003')).toBe('not-fan');
    expect(w.played).toEqual([]);
    // FAN is the creator id of a ChatSpace (OnlyFans) account here — not an account of Fansly: the message rings.
    expect(ownAccountIds('fansly', w.page.accounts, w.page.aliases).has(FAN)).toBe(false);
    expect(await w.arbiter.handleIncoming('tab-f', fact(w), FAN)).toBe('played');
  });

  it('[host:fansly] [SN-003] [SN-004] an automated message (a welcome, a mass send) and a tip ring nothing, each counted with its name', async () => {
    const w = world();
    expect(await w.arbiter.handleIncoming('tab-f', fact(w, { automatic: true }), FAN)).toBe('automatic');
    expect(await w.arbiter.handleIncoming('tab-f', fact(w, { tip: true }), FAN)).toBe('tip');
    expect(w.played).toEqual([]);
    expect(w.arbiter.diagnostics().outcomes).toEqual({ automatic: 1, tip: 1 });
  });

  it('[host:fansly] [SN-005] [SN-006] older than 180 s is history; the model’s switch silences it — and only that model', async () => {
    const w = world();
    expect(await w.arbiter.handleIncoming('tab-f', fact(w, { sentAt: new Date(NOW - 181_000).toISOString() }), FAN)).toBe('stale');
    w.page.sound = sound({ mutedAccounts: [`fansly-web:${CREATOR}`] });
    expect(await w.arbiter.handleIncoming('tab-f', fact(w), FAN)).toBe('muted');
    expect(await w.arbiter.handleIncoming('tab-2', fact(w, { hostAccountId: MODEL_TWO }), FAN)).toBe('played');
    expect(w.played).toHaveLength(1);
  });

  it('[host:fansly] [SN-008] [SN-010] the chat open in a visible focused tab is silent; one message reported by two tabs of the model rings once; ChatSpace’s fact with the same number is another event', async () => {
    const w = world();
    w.page.focused = `fansly-web:${CREATOR}:${FAN}`;
    expect(await w.arbiter.handleIncoming('tab-f', fact(w), FAN)).toBe('open-chat');
    w.page.focused = null;
    const message = fact(w);
    expect(await w.arbiter.handleIncoming('tab-f', message, FAN)).toBe('played');
    expect(await w.arbiter.handleIncoming('tab-g', message, FAN)).toBe('duplicate');
    // The same id on ChatSpace is OnlyFans's: its own event (the key holds the platform and the account).
    await w.clock.advance(MESSAGE_THROTTLE_MS);
    expect(await w.arbiter.handleIncoming('tab-c', { ...message, host: 'chatspace', hostAccountId: '1001', sentAt: new Date(w.clock.now() - 1000).toISOString() })).toBe('played');
    expect(w.played.map((entry) => entry.tone)).toEqual([TONES.chime, TONES.blip]);
  });
});

describe('[host:fansly] the one arbiter with the subscribers Fansly’s page heard (R20 P14a)', () => {
  it('[host:fansly] [SN-012] [ST-129] a new subscriber of the model rings Fansly’s subscriber tone — double untouched, the Fansly section’s choice when made — with no hub and no baseline', async () => {
    const w = world();
    expect(await w.arbiter.handleFollow(follow())).toBe('played');
    expect(w.played.map((entry) => entry.tone)).toEqual([TONES.double]);
    w.page.tones = { message: 'bell', subscriber: 'knock' };
    await w.clock.advance(SUBSCRIBER_THROTTLE_MS);
    expect(await w.arbiter.handleFollow(follow())).toBe('played');
    expect(w.played.map((entry) => entry.tone)).toEqual([TONES.double, TONES.knock]);
    expect(w.arbiter.diagnostics().outcomes).toEqual({ 'subscriber.played': 2 });
  });

  it('[host:fansly] [SN-002] [SN-006] [SN-010] [SN-012] a model following a model is not a subscriber; a follow of an account not ours rings nothing; the model’s switch silences it; two tabs’ copies ring once', async () => {
    const w = world();
    expect(await w.arbiter.handleFollow(follow({ followerId: MODEL_TWO }))).toBe('not-fan');
    expect(await w.arbiter.handleFollow(follow({ followerId: LEGACY }))).toBe('not-fan');
    expect(await w.arbiter.handleFollow(follow({ accountId: '801000000000000099' }))).toBe('account-unknown');
    w.page.sound = sound({ mutedAccounts: [`fansly-web:${CREATOR}`] });
    expect(await w.arbiter.handleFollow(follow())).toBe('muted');
    w.page.sound = DEFAULT_SETTINGS.sound;
    const one = follow();
    expect(await w.arbiter.handleFollow(one)).toBe('played');
    expect(await w.arbiter.handleFollow({ ...one, hostAccountId: CREATOR })).toBe('duplicate');
    // An account not known in this tab yet leaves the event to a tab that knows it.
    const unknown = world();
    unknown.page.accounts = [];
    const early = follow();
    expect(await unknown.arbiter.handleFollow(early)).toBe('account-unknown');
    unknown.page.accounts = [FANSLY];
    expect(await unknown.arbiter.handleFollow(early)).toBe('played');
  });

  it('[host:fansly] [SN-007] [SN-009] [SN-012] off, the owner’s switch off, no tab left: silent; ten seconds between subscribers, never over a message, and a message right after still rings', async () => {
    const w = world();
    w.page.sound = sound({ subscribers: { on: false, tone: 'arpeggio' } });
    expect(await w.arbiter.handleFollow(follow())).toBe('disabled');
    w.page.sound = DEFAULT_SETTINGS.sound;
    w.page.ownerSwitch = false;
    expect(await w.arbiter.handleFollow(follow())).toBe('disabled');
    w.page.ownerSwitch = true;
    w.page.tabs = 0;
    expect(await w.arbiter.handleFollow(follow())).toBe('tab-closed');
    w.page.tabs = 1;
    expect(await w.arbiter.handleFollow(follow())).toBe('played');
    expect(await w.arbiter.handleFollow(follow())).toBe('throttled');
    expect(await w.arbiter.handleIncoming('tab-f', fact(w), FAN)).toBe('played');
    await w.clock.advance(SUBSCRIBER_THROTTLE_MS);
    // The subscriber's own pause is over, but a message just rang: the subscriber waits it out.
    expect(await w.arbiter.handleIncoming('tab-f', fact(w), FAN)).toBe('played');
    expect(await w.arbiter.handleFollow(follow())).toBe('throttled');
    await w.clock.advance(MESSAGE_THROTTLE_MS);
    expect(await w.arbiter.handleFollow(follow())).toBe('played');
    expect(w.played.map((entry) => entry.tone)).toEqual([TONES.double, TONES.chime, TONES.chime, TONES.double]);
  });
});
