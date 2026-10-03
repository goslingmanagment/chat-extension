// The subscriber sound's source (architecture.md §9.8, §8.5; SN-012): new
// rows of the hub's «Новые» (`client/audience-new`), polled slowly — once a
// minute — while a working ChatSpace tab lives and the subscriber sound is
// on. The first poll of a page only sets the baseline; a renewal is not in
// the list at all (the hub lists `new` and `returning`). One poll per page
// at a time, nothing retried before the next tick.

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
  readonly log?: LogSink;
  readonly intervalMs?: number;
  readonly windowHours?: number;
}

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
  let timer: TimerHandle | null = null;
  let running = false;
  let inFlight: Promise<void> | null = null;

  const round = async (): Promise<void> => {
    // Only for a person at work, and only pages whose creator this browser has open somewhere.
    if (!deps.enabled() || deps.presence.listeningTabs() === 0) return;
    const accounts = deps.presence.accounts();
    for (const page of deps.pages()) {
      if (page.platformAccountId === null || !accounts.some((account) => account.platform === page.platform && account.platformAccountId === page.platformAccountId)) continue;
      try {
        const answer = await deps.read(page, windowHours);
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
  };

  const tick = (): Promise<void> => {
    inFlight ??= round().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const schedule = (): void => {
    if (!running) return;
    timer = deps.clock.setTimer(intervalMs, () => {
      timer = null;
      void tick().finally(schedule);
    });
  };

  return {
    start() {
      if (running) return;
      running = true;
      void tick().finally(schedule);
    },
    stop() {
      running = false;
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
