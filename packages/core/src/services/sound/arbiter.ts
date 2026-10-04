// The one sound arbiter of the extension (architecture.md §9.8; SN-001…
// SN-016, ST-075, ST-131, ST-133): the background decides whether an
// incoming fan message or a new subscriber rings.
//
// Candidates are decided ONE AT A TIME — a serial chain, no queue of delayed
// sounds: two events can never pass the throttle on the same stale
// timestamp, and a copy of an event delivered by a second tab or source
// waits behind the first and finds it already settled. Order of one decision:
//   the tab is heard (its socket epoch begins with its first fact, a
//   duplicate included) → duplicate → the pure gate (off, not a fan,
//   automatic, a tip, stale, snapshot or reconnect, unknown or muted account)
//   → a tab still listens, the chat is not open in focus → the audio wakes up
//   (≤ 1.5 s, SN-011) → a fresh look at everything that may have changed
//   meanwhile → one synchronous section: throttle, reserve, start.
//
// The message sound needs no hub sign-in: a live ChatSpace identity, the
// host permission and the switch are enough. The subscriber sound comes from
// the hub's «Новые» and needs it. Nothing here reads or logs a message.

import { type CgCode } from '@cg/contracts/errors';
import { type IncomingFact } from '@cg/contracts/host';
import { chatKeyOf, type ChatKey, type HostAccount, type HostKind, type Platform } from '@cg/contracts/ids';
import { DEFAULT_SETTINGS, hostAccountKeyOf, type SettingsV1, type ToneId } from '@cg/contracts/settings';

import {
  HOST_PLATFORM,
  NO_RINGS,
  SOUND_OUTCOMES,
  SeenEvents,
  accountKeyOf,
  classifyFact,
  consumesEvent,
  gateMessage,
  gateSubscriber,
  isThrottled,
  reserveRing,
  resolveTone,
  seenKey,
  toneOf,
  volumeToGain,
  type FactPhase,
  type SoundKind,
  type SoundOutcome,
  type SoundTone,
  type SourceState,
  type SubscriberEvent,
  type ThrottleState,
} from '../../domain/sound';
import { NO_LOG, WriteQueue, type Clock, type KeyValueStore, type LogSink, type TimerHandle } from '../ports';

export type SoundPlayResult = { readonly played: true } | { readonly played: false; readonly code: 'CG-AUDIO-BLOCKED'; readonly reason: string };

/** The background's audio (`@cg/platform` createAudioPlayer has this shape). */
export interface SoundAudioPort {
  /** Wakes the AudioContext within its 1.5 s (SN-011, SN-014); false — it will not run. Optional: without it `play` wakes it. */
  prepare?(): Promise<boolean>;
  /** `level` is the peak gain, `volumeToGain(settings.sound.volume)`. */
  play(tone: SoundTone, level: number): Promise<SoundPlayResult>;
}

/** Tabs and accounts as the presence service knows them. */
export interface SoundPresencePort {
  /** Registered ChatSpace tabs, reported or not. */
  listeningTabs(): number;
  /** The chat is open in a visible tab that has the focus. */
  isChatInFocus(chatKey: ChatKey): boolean;
  /** Host accounts this browser has seen in a tab. */
  accounts(): readonly HostAccount[];
}

export interface SoundArbiterDeps {
  readonly clock: Clock;
  readonly audio: SoundAudioPort;
  readonly presence: SoundPresencePort;
  /** The current `settings.sound`; null — settings are not readable: nothing rings. */
  readonly settings: () => SettingsV1['sound'] | null;
  /** The owner's `sound` switch of bootstrap; null — unknown (signed out, no bootstrap yet). */
  readonly ownerSwitch: () => boolean | null;
  /** The extension may run on this host (`permissions.contains`). */
  readonly hostPermission: (host: HostKind) => boolean | Promise<boolean>;
  /** storage.session: seen events, the throttle and the subscriber baselines survive an event-page unload. */
  readonly session?: KeyValueStore;
  readonly log?: LogSink;
  /** The defaults the settings were created with: an untouched tone follows the platform (resolveTone). */
  readonly defaults?: SettingsV1['sound'];
  /** Session state is written at most this often. */
  readonly persistAfterMs?: number;
}

/** One poll of a page's «Новые», as the subscriber sound needs it. */
export interface SubscriberBatch {
  /** Stable key of the hub page (its pageId as text). */
  readonly pageKey: string;
  readonly platform: Platform;
  /** The creator's id on the platform; null — the page has none: its mute cannot be checked. */
  readonly platformAccountId: string | null;
  /** Signed in and «Новые» is available for the page. */
  readonly hub: boolean;
  readonly events: readonly { readonly eventRef: string; readonly subscribedAt: string }[];
}

export interface SoundDiagnostics {
  readonly listeningTabs: number;
  /** ISO time of the last fact any tab reported. */
  readonly lastIncomingAt: string | null;
  readonly lastPlayedAt: string | null;
  /** Message outcomes by name, subscriber outcomes as `subscriber.<name>`; zero counters are left out. */
  readonly outcomes: Readonly<Record<string, number>>;
}

export const SOUND_SESSION_KEY = 'sound.state';
/** Known subscription events per page: enough for several polls of 50–100 rows. */
export const SUBSCRIBER_BASELINE_MAX = 300;
const PERSIST_AFTER_MS = 1000;
/** Per-tab source states kept at most (tabs come and go; a forgotten one is a first snapshot again). */
const SOURCES_MAX = 500;

interface StoredState {
  readonly v: 1;
  readonly seen: unknown;
  readonly throttle: { readonly lastMessageAt: number | null; readonly lastSubscriberAt: number | null };
  readonly pages: Readonly<Record<string, readonly string[]>>;
}

const finiteOr = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

export class SoundArbiter {
  private readonly seen = new SeenEvents();
  private readonly chain = new WriteQueue();
  private readonly sources = new Map<string, SourceState>();
  private readonly pages = new Map<string, string[]>();
  private readonly counts = new Map<string, number>();
  private readonly log: LogSink;
  private readonly defaults: SettingsV1['sound'];
  private throttle: ThrottleState = NO_RINGS;
  private lastIncomingAt: number | null = null;
  private lastPlayedAt: number | null = null;
  private persistTimer: TimerHandle | null = null;
  private dirty = false;

  constructor(private readonly deps: SoundArbiterDeps) {
    this.log = deps.log ?? NO_LOG;
    this.defaults = deps.defaults ?? DEFAULT_SETTINGS.sound;
  }

  /** Reads the session state after the event page woke up; a damaged one starts empty. */
  async restore(): Promise<void> {
    if (this.deps.session === undefined) return;
    let raw: unknown;
    try {
      raw = await this.deps.session.get(SOUND_SESSION_KEY);
    } catch {
      this.log.write({ level: 'warn', scope: 'bg.sound', msg: 'sound state unreadable, starting empty', code: 'CG-STORAGE-READ' });
      return;
    }
    if (raw === null || typeof raw !== 'object') return;
    const stored = raw as Partial<StoredState>;
    if (stored.v !== 1) return;
    const now = this.deps.clock.now();
    this.seen.restore(stored.seen, now);
    // A ring «in the future» (a clock that went back) must not silence everything: clamp to now.
    this.throttle = {
      lastMessageAt: Math.min(now, finiteOr(stored.throttle?.lastMessageAt, Number.NEGATIVE_INFINITY)),
      lastSubscriberAt: Math.min(now, finiteOr(stored.throttle?.lastSubscriberAt, Number.NEGATIVE_INFINITY)),
    };
    if (stored.pages !== null && typeof stored.pages === 'object') {
      for (const [pageKey, refs] of Object.entries(stored.pages)) {
        if (Array.isArray(refs)) this.pages.set(pageKey, refs.filter((ref): ref is string => typeof ref === 'string').slice(-SUBSCRIBER_BASELINE_MAX));
      }
    }
  }

  /** `sound.event` (SN-016): a fact from the top frame of a ChatSpace tab; the RPC already checked the sender and the schema. */
  handleIncoming(tabSessionId: string, fact: IncomingFact): Promise<SoundOutcome> {
    this.lastIncomingAt = this.deps.clock.now();
    return this.chain
      .run(() => this.decideMessage(tabSessionId, fact))
      .then(
        (outcome) => this.count('message', outcome),
        () => this.count('message', 'audio-error'),
      );
  }

  /** A payload that failed its schema before it got here (the RPC rejects it; counted for the status line). */
  recordInvalid(kind: SoundKind = 'message'): void {
    this.count(kind, 'invalid');
  }

  /** New rows of a page's «Новые» poll (SN-012): one outcome per event that was not known before. */
  handleSubscribers(batch: SubscriberBatch): Promise<readonly SoundOutcome[]> {
    return this.chain.run(() => this.decideSubscribers(batch));
  }

  /** «Проверить звук» (ST-131): through the same player, minus every rule. */
  async preview(tone: ToneId, volume: number): Promise<{ readonly played: boolean; readonly code?: CgCode }> {
    try {
      const result = await this.deps.audio.play(toneOf(tone), volumeToGain(volume));
      return result.played ? { played: true } : { played: false, code: result.code };
    } catch {
      return { played: false, code: 'CG-AUDIO-BLOCKED' };
    }
  }

  /** A tab closed or reloaded: its next facts are a first snapshot again. */
  tabGone(tabSessionId: string): void {
    const prefix = `${tabSessionId}|`;
    for (const key of [...this.sources.keys()]) if (key.startsWith(prefix)) this.sources.delete(key);
  }

  /** Sign-out, another hub user: the subscriber baselines belong to the previous sign-in. */
  forgetSubscribers(): void {
    if (this.pages.size === 0) return;
    this.pages.clear();
    this.touch();
  }

  /** SN-015, ST-031, ST-133: what the status line and `diagnostics.get` show. */
  diagnostics(): SoundDiagnostics {
    return {
      listeningTabs: this.deps.presence.listeningTabs(),
      lastIncomingAt: this.lastIncomingAt === null ? null : new Date(this.lastIncomingAt).toISOString(),
      lastPlayedAt: this.lastPlayedAt === null ? null : new Date(this.lastPlayedAt).toISOString(),
      outcomes: Object.fromEntries(this.counts),
    };
  }

  /** Writes the session state now (shutdown, tests). */
  async flush(): Promise<void> {
    if (this.persistTimer !== null) {
      this.deps.clock.clearTimer(this.persistTimer);
      this.persistTimer = null;
    }
    if (!this.dirty || this.deps.session === undefined) return;
    this.dirty = false;
    const value: StoredState = {
      v: 1,
      seen: this.seen.snapshot(this.deps.clock.now()),
      throttle: {
        lastMessageAt: Number.isFinite(this.throttle.lastMessageAt) ? this.throttle.lastMessageAt : null,
        lastSubscriberAt: Number.isFinite(this.throttle.lastSubscriberAt) ? this.throttle.lastSubscriberAt : null,
      },
      pages: Object.fromEntries(this.pages),
    };
    try {
      await this.deps.session.set(SOUND_SESSION_KEY, value);
    } catch {
      this.dirty = true;
      this.log.write({ level: 'warn', scope: 'bg.sound', msg: 'sound state write failed', code: 'CG-STORAGE-WRITE' });
    }
  }

  // ── messages ──

  private async decideMessage(tabSessionId: string, fact: IncomingFact): Promise<SoundOutcome> {
    const platform = HOST_PLATFORM[fact.host];
    const key = seenKey(platform, fact.hostAccountId, fact.platformMessageId);
    const settle = (outcome: SoundOutcome): SoundOutcome => {
      if (consumesEvent(outcome)) {
        this.seen.consume(key, this.deps.clock.now());
        this.touch();
      }
      return outcome;
    };
    // The tab is heard from this fact on, whatever becomes of it: a duplicate too tells when the tab began to listen.
    const sourceKey = `${tabSessionId}|${accountKeyOf(fact)}`;
    const classified = classifyFact(fact, this.sources.get(sourceKey) ?? null, this.deps.clock.now());
    this.remember(sourceKey, classified.next);
    if (this.seen.has(key, this.deps.clock.now())) return 'duplicate';

    const gated = await this.gate(fact, classified.phase);
    if (gated !== null) return settle(gated);
    const before = this.surroundings(fact);
    if (before !== null) return settle(before);

    // SN-011: the audio may take up to 1.5 s to wake; everything is looked at again after it.
    if (this.deps.audio.prepare !== undefined) {
      if (!(await this.wake())) return settle('audio-error');
      const regated = await this.gate(fact, classified.phase);
      if (regated !== null) return settle(regated);
      const after = this.surroundings(fact);
      if (after !== null) return settle(after);
    }

    const sound = this.deps.settings();
    if (sound === null) return settle('disabled');
    return settle(await this.ring('message', resolveTone('message', platform, sound, this.defaults), sound.volume));
  }

  private async gate(fact: IncomingFact, phase: FactPhase): Promise<SoundOutcome | null> {
    const sound = this.deps.settings();
    if (sound === null) return 'disabled';
    const hostPermission = await Promise.resolve()
      .then(() => this.deps.hostPermission(fact.host))
      .catch(() => false);
    const accountKey = accountKeyOf(fact);
    const known = this.deps.presence.accounts().some((account) => hostAccountKeyOf(account.host, account.hostAccountId) === accountKey);
    return gateMessage({
      fact,
      now: this.deps.clock.now(),
      sound,
      ownerSwitch: this.deps.ownerSwitch(),
      hostPermission,
      phase,
      account: { known, key: accountKey },
    });
  }

  /** SN-007, SN-008: somebody still listens, and the chat is not the one in front of the person. */
  private surroundings(fact: IncomingFact): SoundOutcome | null {
    if (this.deps.presence.listeningTabs() === 0) return 'tab-closed';
    const chatKey = chatKeyOf({ host: fact.host, hostAccountId: fact.hostAccountId, platformFanId: fact.platformFanId });
    return this.deps.presence.isChatInFocus(chatKey) ? 'open-chat' : null;
  }

  // ── subscribers ──

  private async decideSubscribers(batch: SubscriberBatch): Promise<readonly SoundOutcome[]> {
    const known = this.pages.get(batch.pageKey);
    const firstSnapshot = known === undefined;
    const knownSet = new Set(known ?? []);
    const fresh = batch.events.filter((event) => !knownSet.has(event.eventRef));
    const outcomes: SoundOutcome[] = [];
    for (const event of fresh) {
      let outcome: SoundOutcome;
      try {
        outcome = await this.decideSubscriber(batch, event, firstSnapshot);
      } catch {
        outcome = 'audio-error';
      }
      outcomes.push(this.count('subscriber', outcome));
    }
    if (firstSnapshot || fresh.length > 0) {
      const merged = [...(known ?? []), ...fresh.map((event) => event.eventRef)];
      this.pages.set(batch.pageKey, merged.slice(-SUBSCRIBER_BASELINE_MAX));
      this.touch();
    }
    return outcomes;
  }

  private async decideSubscriber(batch: SubscriberBatch, item: SubscriberBatch['events'][number], firstSnapshot: boolean): Promise<SoundOutcome> {
    const accountId = batch.platformAccountId ?? `page-${batch.pageKey}`;
    // Subscription events and messages are different things with their own id spaces: keep them apart.
    const key = seenKey(batch.platform, accountId, `sub:${item.eventRef}`);
    const settle = (outcome: SoundOutcome): SoundOutcome => {
      if (consumesEvent(outcome)) {
        this.seen.consume(key, this.deps.clock.now());
        this.touch();
      }
      return outcome;
    };
    if (this.seen.has(key, this.deps.clock.now())) return 'duplicate';
    const event: SubscriberEvent = { eventRef: item.eventRef, platform: batch.platform, platformAccountId: accountId, subscribedAt: item.subscribedAt };
    const gate = (): SoundOutcome | null => {
      const sound = this.deps.settings();
      if (sound === null) return 'disabled';
      const accounts =
        batch.platformAccountId === null
          ? []
          : this.deps.presence
              .accounts()
              .filter((account) => account.platform === batch.platform && account.platformAccountId === batch.platformAccountId)
              .map((account) => hostAccountKeyOf(account.host, account.hostAccountId));
      const gated = gateSubscriber({ event, now: this.deps.clock.now(), sound, ownerSwitch: this.deps.ownerSwitch(), hub: batch.hub, firstSnapshot, accounts });
      if (gated !== null) return gated;
      // No push after every ChatSpace tab closed (§9.8): the sound is for a person at work.
      return this.deps.presence.listeningTabs() === 0 ? 'tab-closed' : null;
    };
    const gated = gate();
    if (gated !== null) return settle(gated);
    if (this.deps.audio.prepare !== undefined) {
      if (!(await this.wake())) return settle('audio-error');
      const regated = gate();
      if (regated !== null) return settle(regated);
    }
    const sound = this.deps.settings();
    if (sound === null) return settle('disabled');
    return settle(await this.ring('subscriber', resolveTone('subscriber', batch.platform, sound, this.defaults), sound.volume));
  }

  // ── the one synchronous section: throttle, reserve, start (SN-009) ──

  private async ring(kind: SoundKind, tone: ToneId, volume: number): Promise<SoundOutcome> {
    const at = this.deps.clock.now();
    if (isThrottled(kind, this.throttle, at)) return 'throttled';
    const before = this.throttle;
    // Reserved before the player is asked: decisions are serial, so nothing else reads the throttle meanwhile.
    this.throttle = reserveRing(kind, before, at);
    const played = await Promise.resolve()
      .then(() => this.deps.audio.play(toneOf(tone), volumeToGain(volume)))
      .then(
        (result) => result.played,
        () => false,
      );
    if (!played) {
      // The pause is only for a sound that actually started.
      this.throttle = before;
      return 'audio-error';
    }
    this.lastPlayedAt = this.deps.clock.now();
    this.touch();
    return 'played';
  }

  /** SN-011: the player's own wake-up, bounded by its 1.5 s; a player that throws is a player that will not run. */
  private wake(): Promise<boolean> {
    const audio = this.deps.audio;
    return Promise.resolve()
      .then(() => (audio.prepare === undefined ? true : audio.prepare()))
      .catch(() => false);
  }

  // ── bookkeeping ──

  private count(kind: SoundKind, outcome: SoundOutcome): SoundOutcome {
    const name = kind === 'message' ? outcome : `subscriber.${outcome}`;
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    return outcome;
  }

  private remember(key: string, state: SourceState): void {
    this.sources.delete(key);
    this.sources.set(key, state);
    while (this.sources.size > SOURCES_MAX) {
      const oldest = this.sources.keys().next();
      if (oldest.done === true) break;
      this.sources.delete(oldest.value);
    }
  }

  private touch(): void {
    this.dirty = true;
    if (this.deps.session === undefined || this.persistTimer !== null) return;
    this.persistTimer = this.deps.clock.setTimer(this.deps.persistAfterMs ?? PERSIST_AFTER_MS, () => {
      this.persistTimer = null;
      void this.flush();
    });
  }
}

/** Every outcome name the counters can carry, for a status line that lists them in a fixed order. */
export const SOUND_COUNTER_NAMES: readonly string[] = [...SOUND_OUTCOMES, ...SOUND_OUTCOMES.map((outcome) => `subscriber.${outcome}`)];
