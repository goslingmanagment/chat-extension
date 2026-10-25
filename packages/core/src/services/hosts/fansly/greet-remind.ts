// The greeting reminder on Fansly (2026-10-25; the owner: «уведомление что не поприветствовали челика спустя 10 мин
// фолоу … чето как будто не ловит»): the reminder of 2026-10-24 (services/sound/greetings.ts) reads the hub's «Новые»,
// which Fansly does not have. Here a new follower whom nobody greeted ten minutes after the follow, and who did not
// write, is the same toast «Ждёт приветствия · {фан}» with «Hi» in a tab of the creator.
//
// The follow is the tab's socket fact (3/2, the one the subscriber sound hears through `fansly.sound.batch`), kept by
// its id; its moment is the id's (a snowflake). Ten minutes on, while a tab of the creator is open and the page's
// «Новые» are on (`target`), the pass's check of that one fan (newcomers.ts `remind`) reads the chat: a few requests
// of the creator's lane, one check per follow, never repeated, one at a time. A fan who writes meanwhile (the socket
// again) is not checked. An hour after the follow is late news: such a fan is only the window's to show. Kept in
// storage.session, so an event page that unloads neither forgets a follow nor reminds twice. It sends nothing and
// generates nothing: «Hi» is the person's click.

import { type SoundBatch } from '@cg/contracts/sound';
import { type BackgroundToast } from '@cg/contracts/tab-messages';
import { NATIVE_ID_PATTERN } from '@cg/contracts/primitives';

import { snowflakeMs } from '../../../domain/hosts/fansly/newcomers/pass-rules';
import { GREET_REMIND_AFTER_MS, GREET_REMIND_UNTIL_MS, GREET_REMINDED_MAX } from '../../../domain/newcomers/remind';
import { type Clock, type KeyValueStore, type TimerHandle } from '../../ports';
import { NO_LOG, type ServiceLog } from '../../storage/ports';
import { type FanslyRemindVerdict } from './newcomers';

/** storage.session: the follows heard, oldest first (`Follow[]`). */
export const FANSLY_GREET_SESSION_KEY = 'fansly.greet.follows';
/** A follow due while no tab of its creator can be told is looked at again this much later. */
export const FANSLY_GREET_RETRY_MS = 60_000;

/** One follow as kept: the creator, the fan, the follow's id, its moment (epoch ms); `d` — settled, `w` — the fan wrote. */
interface Follow {
  readonly c: string;
  readonly f: string;
  readonly e: string;
  readonly at: number;
  d: boolean;
  w?: true;
}

export interface FanslyGreetReminderDeps {
  /** The check of one fan (newcomers.ts `remind`). */
  readonly check: (creator: string, fanRef: string, followedAt: number) => Promise<FanslyRemindVerdict | null>;
  /**
   * Where a reminder about the creator's fan goes now: a tab of the creator and the creator's hub page; null — nowhere
   * (no tab, the page's «Новые» off, Fansly off).
   */
  readonly target: (creator: string) => { readonly tabSessionId: string; readonly pageId: number } | null;
  /** The followed account is the creator (or an alias of theirs): a follow of another account is nobody's here. */
  readonly sameAccount?: (creator: string, accountId: string) => boolean;
  readonly toast: (tabSessionId: string, toast: BackgroundToast) => void;
  readonly session?: KeyValueStore;
  readonly clock: Clock;
  readonly uuid: () => string;
  readonly log?: ServiceLog;
}

export interface FanslyGreetReminder {
  /** Readiness: the follows an earlier event page kept. */
  restore(): Promise<void>;
  /** A tab's socket facts (`fansly.sound.batch`): its follows, and the messages of fans who wrote. */
  heard(batch: SoundBatch): void;
  dispose(): void;
}

function followOf(value: unknown): Follow | null {
  if (typeof value !== 'object' || value === null) return null;
  const { c, f, e, at, d, w } = value as Record<string, unknown>;
  if (typeof c !== 'string' || typeof f !== 'string' || typeof e !== 'string' || !NATIVE_ID_PATTERN.test(c) || !NATIVE_ID_PATTERN.test(f) || !NATIVE_ID_PATTERN.test(e)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at) || typeof d !== 'boolean') return null;
  return { c, f, e, at, d, ...(w === true ? { w } : {}) };
}

export function createFanslyGreetReminder(deps: FanslyGreetReminderDeps): FanslyGreetReminder {
  const log = deps.log ?? NO_LOG;
  const same = deps.sameAccount ?? ((creator: string, accountId: string) => creator === accountId);
  /** Oldest first. */
  let follows: Follow[] = [];
  let timer: TimerHandle | null = null;
  let running = false;
  let disposed = false;
  /** The last round: a follow due while nobody could be told waits FANSLY_GREET_RETRY_MS after it. */
  let lookedAt = Number.NEGATIVE_INFINITY;

  const persist = (): void => {
    void deps.session?.set(FANSLY_GREET_SESSION_KEY, follows).catch(() => log({ level: 'warn', scope: 'bg.fansly.greet', msg: 'greeting reminders unsaved', code: 'CG-STORAGE-WRITE' }));
  };

  /** An hour after the follow it is late news; the store keeps at most GREET_REMINDED_MAX follows. */
  const prune = (now: number): void => {
    follows = follows.filter((follow) => now - follow.at < GREET_REMIND_UNTIL_MS).slice(-GREET_REMINDED_MAX);
  };

  /** The next look: ten minutes after the first follow not settled, no sooner than a minute after the last round. */
  function schedule(): void {
    if (disposed || running) return;
    if (timer !== null) deps.clock.clearTimer(timer);
    timer = null;
    let next = Number.POSITIVE_INFINITY;
    for (const follow of follows) if (!follow.d) next = Math.min(next, Math.max(follow.at + GREET_REMIND_AFTER_MS, lookedAt + FANSLY_GREET_RETRY_MS));
    if (next === Number.POSITIVE_INFINITY) return;
    timer = deps.clock.setTimer(Math.max(0, next - deps.clock.now()), () => {
      timer = null;
      void round();
    });
  }

  /** Every follow due now whose creator has a tab, one check at a time. */
  async function round(): Promise<void> {
    if (disposed || running) return;
    running = true;
    try {
      for (;;) {
        const now = deps.clock.now();
        prune(now);
        const follow = follows.find((entry) => !entry.d && now - entry.at >= GREET_REMIND_AFTER_MS && deps.target(entry.c) !== null);
        if (follow === undefined) break;
        // One check per follow: whatever it answers, never again.
        follow.d = true;
        persist();
        const verdict = await deps.check(follow.c, follow.f, follow.at);
        if (disposed) return;
        if (verdict?.s !== 'due' || follow.w === true) continue;
        const target = deps.target(follow.c);
        if (target === null) continue;
        const fanLabel = verdict.fanLabel === null ? null : verdict.fanLabel.slice(0, 256);
        deps.toast(target.tabSessionId, { toastId: deps.uuid(), kind: 'info', scope: `greet.${follow.f}`, fanLabel, greet: { pageId: target.pageId, fanRef: follow.f } });
        log({ level: 'info', scope: 'bg.fansly.greet', msg: 'greeting reminded', fields: { pageId: target.pageId } });
      }
    } finally {
      running = false;
      lookedAt = deps.clock.now();
      persist();
      schedule();
    }
  }

  return {
    async restore() {
      let kept: Follow[] = [];
      try {
        const raw = await deps.session?.get(FANSLY_GREET_SESSION_KEY);
        if (Array.isArray(raw)) kept = raw.map(followOf).filter((follow): follow is Follow => follow !== null);
      } catch {
        log({ level: 'warn', scope: 'bg.fansly.greet', msg: 'greeting reminders unreadable, starting empty', code: 'CG-STORAGE-READ' });
      }
      if (disposed) return;
      const heard = new Set(follows.map((follow) => follow.e));
      follows = [...kept.filter((follow) => !heard.has(follow.e)), ...follows].sort((a, b) => a.at - b.at);
      prune(deps.clock.now());
      schedule();
    },
    heard(batch) {
      if (disposed) return;
      const now = deps.clock.now();
      const creator = batch.hostAccountId;
      let changed = false;
      for (const event of batch.events) {
        if (event.kind === 'subscriber') {
          if (event.followerId === creator || !same(creator, event.accountId)) continue;
          // Each tab of the creator hears the same follow; a fan already waiting is not waited for twice.
          if (follows.some((follow) => follow.e === event.id || (!follow.d && follow.c === creator && follow.f === event.followerId))) continue;
          const at = snowflakeMs(event.id, now) ?? now;
          if (now - at >= GREET_REMIND_UNTIL_MS) continue;
          follows.push({ c: creator, f: event.followerId, e: event.id, at, d: false });
          changed = true;
        } else if (event.fromFan) {
          // A fan who wrote needs no greeting reminder.
          for (const follow of follows) {
            if (follow.c !== creator || follow.f !== event.senderId || follow.w === true) continue;
            follow.d = true;
            follow.w = true;
            changed = true;
          }
        }
      }
      if (!changed) return;
      follows.sort((a, b) => a.at - b.at);
      prune(now);
      persist();
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer !== null) deps.clock.clearTimer(timer);
      timer = null;
    },
  };
}
