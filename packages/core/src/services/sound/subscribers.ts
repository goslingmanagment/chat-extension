// The subscriber sound's source (architecture.md §9.8, §8.5; SN-012): new
// rows of the hub's «Новые» (`client/audience-new`), polled slowly — once a
// minute — while a working ChatSpace tab lives and the subscriber sound is
// on. The first poll of a page only sets the baseline; a renewal is not in
// the list at all (the hub lists `new` and `returning`). One poll per page
// at a time, nothing retried before the next tick.
//
// §8.5 «с разбросом и паузами офлайн»: every pause is the period ±10 %, so
// browsers do not ask the hub in step; nothing is asked while the browser is
// offline; and after a round in which the hub answered nothing the pause
// doubles (up to eight periods) until it answers again.

import { type HostAccount, type Platform } from '@cg/contracts/ids';
import { AUDIENCE_KINDS, AUDIENCE_LIMITS, type AudienceNewPage } from '@cg/contracts/hub';

import { NO_LOG, type Clock, type LogSink, type TimerHandle } from '../ports';
import { type SubscriberBatch } from './arbiter';

/** A hub page whose new subscribers may ring. */
export interface SubscriberPage {
  readonly pageId: number;
  readonly pageLabel: string;
  readonly platform: Platform;
  readonly platformAccountId: string | null;
}

export interface SubscriberPollerDeps {
  readonly clock: Clock;
  /** Signed-in pages with «Новые» available; empty when signed out or the feature is off. */
  readonly pages: () => readonly SubscriberPage[];
  /** One page of «Новые» from the hub facade (`audienceNew`), the newest rows. */
  readonly read: (page: SubscriberPage, windowHours: number) => Promise<AudienceNewPage>;
  readonly presence: { listeningTabs(): number; accounts(): readonly HostAccount[] };
  /** `settings.sound.subscribers.on` and the owner's switch: off — no polling at all. */
  readonly enabled: () => boolean;
  readonly sink: { handleSubscribers(batch: SubscriberBatch): Promise<unknown> };
  /** The browser has a network (`navigator.onLine`); false — nothing is asked until it is back. Omitted — always. */
  readonly online?: () => boolean;
  /** 0 ≤ x < 1, for the spread of the pause. Omitted — `Math.random`. */
  readonly random?: () => number;
  readonly log?: LogSink;
  readonly intervalMs?: number;
  readonly windowHours?: number;
}

/** Each pause is the period ± this share of it. */
export const SUBSCRIBER_POLL_JITTER = 0.1;
/** After rounds in which the hub answered nothing the pause doubles, up to this many periods. */
export const SUBSCRIBER_POLL_BACKOFF_MAX = 8;

export interface SubscriberPoller {
  /** Starts the timer; the first poll runs at once. */
  start(): void;
  stop(): void;
  /** One round now; resolves when every page was asked. */
  tick(): Promise<void>;
  readonly running: boolean;
}

/** Subscription kinds that ring: a new fan and a fan who came back; a kind this build does not know stays silent. */
const RINGING_KINDS: readonly string[] = AUDIENCE_KINDS;

export function createSubscriberPoller(deps: SubscriberPollerDeps): SubscriberPoller {
  const log = deps.log ?? NO_LOG;
  const intervalMs = deps.intervalMs ?? AUDIENCE_LIMITS.pollSoundMs;
  const windowHours = deps.windowHours ?? AUDIENCE_LIMITS.defaultWindowHours;
  const random = deps.random ?? Math.random;
  let timer: TimerHandle | null = null;
  let running = false;
  /** Changes with every start() and stop(): what an earlier start left behind — a timer, a round still in flight — schedules nothing. */
  let generation = 0;
  /** Rounds in a row in which every page asked failed. */
  let failures = 0;
  let inFlight: Promise<void> | null = null;

  const round = async (): Promise<void> => {
    // Only for a person at work, with a network, and only pages whose creator this browser has open somewhere.
    if (!deps.enabled() || deps.presence.listeningTabs() === 0 || deps.online?.() === false) return;
    const accounts = deps.presence.accounts();
    let asked = 0;
    let answered = 0;
    for (const page of deps.pages()) {
      if (page.platformAccountId === null || !accounts.some((account) => account.platform === page.platform && account.platformAccountId === page.platformAccountId)) continue;
      asked += 1;
      try {
        const answer = await deps.read(page, windowHours);
        answered += 1;
        await deps.sink.handleSubscribers({
          pageKey: String(page.pageId),
          platform: page.platform,
          platformAccountId: page.platformAccountId,
          hub: true,
          events: answer.items.filter((item) => RINGING_KINDS.includes(item.kind)).map((item) => ({ eventRef: item.eventRef, subscribedAt: item.subscribedAt })),
        });
      } catch {
        // The next tick asks again; a failed poll is never a reason to ring or to forget the baseline.
        log.write({ level: 'warn', scope: 'bg.sound', msg: 'subscriber poll failed', fields: { pageId: page.pageId } });
      }
    }
    if (asked > 0) failures = answered === 0 ? failures + 1 : 0;
  };

  const tick = (): Promise<void> => {
    inFlight ??= round().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  /** The period, longer after silent rounds, ± the spread. */
  const pause = (): number => {
    const base = Math.min(intervalMs * 2 ** failures, intervalMs * SUBSCRIBER_POLL_BACKOFF_MAX);
    return Math.round(base * (1 + (random() * 2 - 1) * SUBSCRIBER_POLL_JITTER));
  };

  /** The one place a timer is set: only for the start that is still the current one. */
  const schedule = (mine: number): void => {
    if (mine !== generation) return;
    timer = deps.clock.setTimer(pause(), () => {
      timer = null;
      if (mine !== generation) return;
      void tick().finally(() => schedule(mine));
    });
  };

  return {
    start() {
      if (running) return;
      running = true;
      generation += 1;
      const mine = generation;
      void tick().finally(() => schedule(mine));
    },
    stop() {
      running = false;
      generation += 1;
      failures = 0;
      if (timer !== null) {
        deps.clock.clearTimer(timer);
        timer = null;
      }
    },
    tick,
    get running() {
      return running;
    },
  };
}
