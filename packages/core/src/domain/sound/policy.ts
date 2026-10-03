// Which events ring (architecture.md §9.8 «Политика»; SN-002…SN-012): pure
// rules. The one arbiter of the extension (core/services/sound) owns the
// order of the asynchronous steps around them — audio wake-up, the fresh
// look at settings and presence, the single synchronous throttle section.
//
// Everything is decided on facts without text: who wrote, whether it was
// automatic, a tip, when, on which account. A reason the event stays silent
// is an outcome with a name; the options page shows the counters (SN-015).

import { type IncomingFact } from '@cg/contracts/host';
import { type HostKind, type Platform } from '@cg/contracts/ids';
import { hostAccountKeyOf, type HostAccountKey, type SettingsV1 } from '@cg/contracts/settings';

import { type SoundKind } from './tones';

export const SOUND_OUTCOMES = [
  /** The fact did not pass its schema. */
  'invalid',
  /** Already decided in the last 10 minutes (SN-010). */
  'duplicate',
  /** The sound of this kind is off, or the owner's switch is. */
  'disabled',
  /** No host permission for this site: nothing of ours runs there. */
  'no-permission',
  /** Not from the fan: our own or an outgoing message (SN-002). */
  'not-fan',
  /** Queued or automatic (SN-003). */
  'automatic',
  /** A tip (SN-004): ChatSpace has its own notification for money. */
  'tip',
  /** No time on the event: its age cannot be judged (SN-005). */
  'no-time',
  /** Older than 180 s: a redelivery, not news (SN-005). */
  'stale',
  /** The first snapshot of a tab's store, not a live event. */
  'first-snapshot',
  /** Came with a reconnect: what the socket missed, not what just happened. */
  'reconnect',
  /** The account is not one this browser knows: its mute cannot be checked (SN-006). */
  'account-unknown',
  /** The account's sounds are muted (SN-006, ST-075). */
  'muted',
  /** Subscribers need the hub: not signed in, or the page has no «Новые». */
  'no-hub',
  /** No ChatSpace tab is open any more (SN-007). */
  'tab-closed',
  /** The chat is open in a visible tab that has the focus (SN-008). */
  'open-chat',
  /** Inside the pause after the last sound (SN-009, SN-012). */
  'throttled',
  'played',
  /** The audio would not start (CG-AUDIO-BLOCKED). */
  'audio-error',
] as const;
export type SoundOutcome = (typeof SOUND_OUTCOMES)[number];

/** SN-005: older than this is not news. */
export const STALE_MESSAGE_MS = 180_000;
/** A subscription seen by a poll may be a poll period old already; beyond this it is history. */
export const STALE_SUBSCRIBER_MS = 300_000;
/** SN-009: at most one message sound per 2 s. */
export const MESSAGE_THROTTLE_MS = 2000;
/** SN-012: a wave of subscriptions must not ring non-stop. */
export const SUBSCRIBER_THROTTLE_MS = 10_000;
/** A store fact this fresh is a live message even when it arrives with a snapshot or a reconnect. */
export const LIVE_EDGE_MS = 15_000;

/** The platform a host shows: ChatSpace is OnlyFans, fansly.com is Fansly. */
export const HOST_PLATFORM: Readonly<Record<HostKind, Platform>> = { chatspace: 'onlyfans', 'fansly-web': 'fansly' };

/** How a fact reached the arbiter, as far as «is this live» goes. */
export type FactPhase = 'live' | 'first-snapshot' | 'reconnect';

export interface AccountView {
  /** This browser has seen the account in a ChatSpace tab. */
  readonly known: boolean;
  readonly key: HostAccountKey;
}

export interface MessageGate {
  readonly fact: IncomingFact;
  readonly now: number;
  readonly sound: SettingsV1['sound'];
  /** The owner's `sound` switch from bootstrap; null — unknown (not signed in): message sound does not need the hub. */
  readonly ownerSwitch: boolean | null;
  readonly hostPermission: boolean;
  readonly phase: FactPhase;
  readonly account: AccountView;
}

/** Epoch ms of an ISO time; null — unreadable. */
export function timeOf(iso: string | null): number | null {
  if (iso === null) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

export function isMuted(sound: SettingsV1['sound'], key: HostAccountKey): boolean {
  return sound.mutedAccounts.includes(key);
}

/**
 * The synchronous part of a message decision, in order; null — still
 * eligible (the arbiter then looks at the open chat, wakes the audio and
 * throttles).
 */
export function gateMessage(input: MessageGate): SoundOutcome | null {
  const { fact, sound } = input;
  if (!sound.messages.on || input.ownerSwitch === false) return 'disabled';
  if (!input.hostPermission) return 'no-permission';
  if (!fact.fromFan) return 'not-fan';
  if (fact.automatic) return 'automatic';
  if (fact.tip) return 'tip';
  const sentAt = timeOf(fact.sentAt);
  if (sentAt === null) return 'no-time';
  if (input.now - sentAt > STALE_MESSAGE_MS) return 'stale';
  if (input.phase !== 'live') return input.phase;
  if (!input.account.known) return 'account-unknown';
  if (isMuted(sound, input.account.key)) return 'muted';
  return null;
}

export interface SubscriberEvent {
  /** The hub's `eventRef`: the stable key that keeps the sound from repeating. */
  readonly eventRef: string;
  readonly platform: Platform;
  /** The creator's id on the platform: the page's binding key. */
  readonly platformAccountId: string;
  readonly subscribedAt: string;
}

export interface SubscriberGate {
  readonly event: SubscriberEvent;
  readonly now: number;
  readonly sound: SettingsV1['sound'];
  readonly ownerSwitch: boolean | null;
  /** Signed in and the page has «Новые»: the subscriber sound needs the hub. */
  readonly hub: boolean;
  /** The first poll of the page: what was there before we looked. */
  readonly firstSnapshot: boolean;
  /** Host accounts of this browser bound to the page's creator; empty — the mute cannot be checked. */
  readonly accounts: readonly HostAccountKey[];
}

export function gateSubscriber(input: SubscriberGate): SoundOutcome | null {
  const { sound } = input;
  if (!sound.subscribers.on || input.ownerSwitch === false) return 'disabled';
  if (!input.hub) return 'no-hub';
  if (input.firstSnapshot) return 'first-snapshot';
  const at = timeOf(input.event.subscribedAt);
  if (at === null) return 'no-time';
  if (input.now - at > STALE_SUBSCRIBER_MS) return 'stale';
  if (input.accounts.length === 0) return 'account-unknown';
  // The model's switch silences both sounds (ST-075); every account of the creator must be unmuted to ring.
  if (input.accounts.some((key) => isMuted(sound, key))) return 'muted';
  return null;
}

export interface ThrottleState {
  /** Monotonic ms of the last message ring; -Infinity — none yet. */
  readonly lastMessageAt: number;
  readonly lastSubscriberAt: number;
}

export const NO_RINGS: ThrottleState = { lastMessageAt: Number.NEGATIVE_INFINITY, lastSubscriberAt: Number.NEGATIVE_INFINITY };

/**
 * SN-009, SN-012: messages answer only to the last message ring (a
 * subscriber never takes a message's sound); a subscriber waits out both the
 * message pause — it never rings over a message — and its own longer one.
 */
export function isThrottled(kind: SoundKind, state: ThrottleState, at: number): boolean {
  if (at - state.lastMessageAt < MESSAGE_THROTTLE_MS) return true;
  return kind === 'subscriber' && at - state.lastSubscriberAt < SUBSCRIBER_THROTTLE_MS;
}

export function reserveRing(kind: SoundKind, state: ThrottleState, at: number): ThrottleState {
  return kind === 'message' ? { ...state, lastMessageAt: at } : { ...state, lastSubscriberAt: at };
}

/**
 * Outcomes that are facts about the event itself and settle it for every
 * tab and source. The others are facts about who reported it (a tab's first
 * snapshot, an unknown account, a missing time): another tab's live copy of
 * the same event must still be able to ring, so they leave the id free.
 */
export function consumesEvent(outcome: SoundOutcome): boolean {
  return !(
    outcome === 'invalid' ||
    outcome === 'no-time' ||
    outcome === 'first-snapshot' ||
    outcome === 'reconnect' ||
    outcome === 'account-unknown' ||
    outcome === 'no-permission' ||
    outcome === 'no-hub' ||
    outcome === 'tab-closed'
  );
}

// ── is this fact live ──────────────────────────────────────────────────────

/** What the arbiter remembers per tab and account. */
export interface SourceState {
  readonly socketEpoch: number;
  /** A snapshot or reconnect burst is assumed to last until here (epoch ms). */
  readonly quietUntil: number;
  readonly quietPhase: Exclude<FactPhase, 'live'>;
}

/** Store facts arriving this soon after a detected snapshot or reconnect belong to it. */
export const BURST_WINDOW_MS = 1500;

/**
 * A frame the WS tap saw is a push that just happened: always live. A fact
 * read from ChatSpace's stores is live only after the tab's first read of
 * that account on this socket epoch — the first read is a snapshot, the
 * first after a new epoch is a reconnect — unless the message itself is
 * seconds old (`LIVE_EDGE_MS`): then it is news whatever brought it.
 */
export function classifyFact(fact: IncomingFact, previous: SourceState | null, now: number): { readonly phase: FactPhase; readonly next: SourceState } {
  if (fact.source === 'ws-tap') {
    return { phase: 'live', next: previous !== null && previous.socketEpoch >= fact.socketEpoch ? previous : { socketEpoch: fact.socketEpoch, quietUntil: 0, quietPhase: 'reconnect' } };
  }
  const sentAt = timeOf(fact.sentAt);
  const fresh = sentAt !== null && now - sentAt <= LIVE_EDGE_MS;
  if (previous === null || fact.socketEpoch > previous.socketEpoch) {
    const quietPhase = previous === null ? 'first-snapshot' : 'reconnect';
    const next: SourceState = { socketEpoch: fact.socketEpoch, quietUntil: now + BURST_WINDOW_MS, quietPhase };
    return { phase: fresh ? 'live' : quietPhase, next };
  }
  if (now < previous.quietUntil && !fresh) return { phase: previous.quietPhase, next: previous };
  return { phase: 'live', next: previous };
}

/** `chatspace:<OnlyMonster account id>` of a fact. */
export function accountKeyOf(fact: Pick<IncomingFact, 'host' | 'hostAccountId'>): HostAccountKey {
  return hostAccountKeyOf(fact.host, fact.hostAccountId);
}

/** ST-075: the model's switch — the new `mutedAccounts` with the account in or out, order kept, no repeats. */
export function withAccountMuted(muted: readonly HostAccountKey[], key: HostAccountKey, mute: boolean): HostAccountKey[] {
  const without = muted.filter((item) => item !== key);
  return mute ? [...without, key] : without;
}
