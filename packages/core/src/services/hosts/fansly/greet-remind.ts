// The greeting reminder on Fansly (2026-10-25; the owner: «уведомление что не поприветствовали челика спустя 10 мин
// фолоу … чето как будто не ловит»): the reminder of 2026-10-24 (services/sound/greetings.ts) reads the hub's «Новые»,
// which Fansly does not have. Here a new follower whom nobody greeted three, ten and fifteen minutes after the follow
// (2026-10-29, the owner: «первый алерт ... через 3 мин после фолоу, второй через 10, и третий красный через 15»), and
// who did not write, is the same toast «Ждёт приветствия · {фан}» with «Hi» in a tab of the creator; the third is red.
//
// The follow is the tab's socket fact (3/2, the one the subscriber sound hears through `fansly.sound.batch`), kept by
// its id; its moment is the id's (a snowflake). At each reminder's minute, while a tab of the creator is open and the
// page's «Новые» are on (`target`), the creator's due follows are checked together (newcomers.ts `remind`): reads
// only — the start of the inbox and the chats it names —, never a chat made. A fan the check cannot tell about yet
// (the creator's lane cools down, a failed read) is asked again a minute later; one check at a time; a check that is
// late shows the newest reminder due, never the ones it missed. A fan somebody greeted, who wrote (the socket again,
// and then is not checked) or whom nobody may write to has no more reminders. An hour after the follow is late news:
// such a fan is only the window's to show. Kept in storage.session, so an event page that unloads neither forgets a
// follow nor reminds twice. It sends nothing and generates nothing: «Hi» is the person's click.
//
// Where the toast stands (the owner, 2026-10-25: «может приходит только в одно окно активное? … у Никиты приходят не
// всегда»): in the creator's tab the person looks at (else their last), and also in every other tab on screen — a
// chatter on another model's tab sees it there, with the model's name, and its «Hi» brings the model's tab forward and
// greets there (`fansly.greet.handover`).

import { type SoundBatch } from '@cg/contracts/sound';
import { type BackgroundToast } from '@cg/contracts/tab-messages';
import { NATIVE_ID_PATTERN } from '@cg/contracts/primitives';

import { snowflakeMs } from '../../../domain/hosts/fansly/newcomers/pass-rules';
import { GREET_REMIND_STEPS_MS, GREET_REMIND_UNTIL_MS, GREET_REMINDED_MAX, greetRemindStep, greetRemindUrgent, nextGreetRemindAt } from '../../../domain/newcomers/remind';
import { type Clock, type KeyValueStore, type TimerHandle } from '../../ports';
import { NO_LOG, type ServiceLog } from '../../storage/ports';
import { type FanslyRemindFollow, type FanslyRemindVerdict } from './newcomers';

/** storage.session: the follows heard, oldest first (`Follow[]`). */
export const FANSLY_GREET_SESSION_KEY = 'fansly.greet.follows';
/** A follow not told about yet, or due while no tab of its creator can be told, is looked at again this much later. */
export const FANSLY_GREET_RETRY_MS = 60_000;

/**
 * One follow as kept: the creator, the fan, the follow's id, its moment (epoch ms); `d` — settled (no more reminders),
 * `w` — the fan wrote, `n` — not looked at again before this moment, `s` — the reminders shown (1…3; absent — none).
 */
interface Follow {
  readonly c: string;
  readonly f: string;
  readonly e: string;
  readonly at: number;
  d: boolean;
  w?: true;
  n?: number;
  s?: number;
}

export interface FanslyGreetReminderDeps {
  /** The check of a creator's due follows (newcomers.ts `remind`): per fan, a verdict or null — not told yet. */
  readonly check: (creator: string, follows: readonly FanslyRemindFollow[]) => Promise<ReadonlyMap<string, FanslyRemindVerdict | null>>;
  /**
   * Where a reminder about the creator's fan goes now: a tab of the creator and the creator's hub page; null — nowhere
   * (no tab, the page's «Новые» off, Fansly off). `elsewhere` — the other tabs on screen, `foreign` — of another model
   * (the toast names the creator's page there: `page`).
   */
  readonly target: (creator: string) => {
    readonly tabSessionId: string;
    readonly pageId: number;
    readonly page?: string | null;
    readonly elsewhere?: readonly { readonly tabSessionId: string; readonly foreign: boolean }[];
  } | null;
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
  /** 2026-10-29: when the fan followed the creator, as heard (the reminder's Hi keeps it); null — not heard within the hour. */
  followedAt(creator: string, fanRef: string): number | null;
  dispose(): void;
}

function followOf(value: unknown): Follow | null {
  if (typeof value !== 'object' || value === null) return null;
  const { c, f, e, at, d, w, n, s } = value as Record<string, unknown>;
  if (typeof c !== 'string' || typeof f !== 'string' || typeof e !== 'string' || !NATIVE_ID_PATTERN.test(c) || !NATIVE_ID_PATTERN.test(f) || !NATIVE_ID_PATTERN.test(e)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at) || typeof d !== 'boolean') return null;
  const shown = typeof s === 'number' && Number.isInteger(s) && s >= 1 && s <= GREET_REMIND_STEPS_MS.length ? { s } : {};
  return { c, f, e, at, d, ...(w === true ? { w } : {}), ...(typeof n === 'number' && Number.isFinite(n) ? { n } : {}), ...shown };
}

export function createFanslyGreetReminder(deps: FanslyGreetReminderDeps): FanslyGreetReminder {
  const log = deps.log ?? NO_LOG;
  const same = deps.sameAccount ?? ((creator: string, accountId: string) => creator === accountId);
  /** Oldest first. */
  let follows: Follow[] = [];
  let timer: TimerHandle | null = null;
  let running = false;
  let disposed = false;

  const persist = (): void => {
    void deps.session?.set(FANSLY_GREET_SESSION_KEY, follows).catch(() => log({ level: 'warn', scope: 'bg.fansly.greet', msg: 'greeting reminders unsaved', code: 'CG-STORAGE-WRITE' }));
  };

  /** An hour after the follow it is late news; the store keeps at most GREET_REMINDED_MAX follows. */
  const prune = (now: number): void => {
    follows = follows.filter((follow) => now - follow.at < GREET_REMIND_UNTIL_MS).slice(-GREET_REMINDED_MAX);
  };

  /** A follow's next reminder is due now: one more of the three has come since the last shown. */
  const dueAt = (follow: Follow, now: number): boolean => greetRemindStep(now - follow.at) > (follow.s ?? 0);

  /** The next look: the next reminder of a follow not settled, or when it may be looked at again. */
  function schedule(): void {
    if (disposed || running) return;
    if (timer !== null) deps.clock.clearTimer(timer);
    timer = null;
    let next = Number.POSITIVE_INFINITY;
    for (const follow of follows) {
      const at = follow.d ? null : nextGreetRemindAt(follow.at, follow.s ?? 0);
      if (at !== null) next = Math.min(next, Math.max(at, follow.n ?? 0));
    }
    if (next === Number.POSITIVE_INFINITY) return;
    timer = deps.clock.setTimer(Math.max(0, next - deps.clock.now()), () => {
      timer = null;
      void round();
    });
  }

  /** The follows due now, one creator at a time; a creator with no tab to tell waits a minute. */
  async function round(): Promise<void> {
    if (disposed || running) return;
    running = true;
    try {
      for (;;) {
        const now = deps.clock.now();
        prune(now);
        const due = follows.filter((follow) => !follow.d && dueAt(follow, now) && (follow.n ?? 0) <= now);
        let creator: string | null = null;
        for (const follow of due) {
          if (creator === follow.c) continue;
          if (creator === null && deps.target(follow.c) !== null) creator = follow.c;
          else if (deps.target(follow.c) === null) follow.n = now + FANSLY_GREET_RETRY_MS;
        }
        if (creator === null) break;
        const batch = due.filter((follow) => follow.c === creator);
        let verdicts: ReadonlyMap<string, FanslyRemindVerdict | null>;
        try {
          verdicts = await deps.check(creator, batch.map((follow) => ({ fanRef: follow.f, followedAt: follow.at })));
        } catch {
          verdicts = new Map();
        }
        if (disposed) return;
        const later = deps.clock.now() + FANSLY_GREET_RETRY_MS;
        const target = deps.target(creator);
        let reminded = 0;
        for (const follow of batch) {
          // The fan wrote while the check ran: settled already.
          if (follow.w === true) continue;
          const verdict = verdicts.get(follow.f) ?? null;
          if (verdict === null || (verdict.s === 'due' && target === null)) {
            follow.n = later;
            continue;
          }
          // Greeted, wrote, nobody may write: no more reminders.
          if (verdict.s !== 'due' || target === null) {
            follow.d = true;
            continue;
          }
          // The newest reminder due when the round began; the third one is the last, and red.
          const step = greetRemindStep(now - follow.at);
          follow.s = step;
          if (greetRemindUrgent(step)) follow.d = true;
          const fanLabel = verdict.fanLabel === null ? null : verdict.fanLabel.slice(0, 256);
          const username = verdict.username?.slice(0, 64) ?? null;
          const greet = { pageId: target.pageId, fanRef: follow.f, username, avatarUrl: verdict.avatarUrl ?? null, since: new Date(follow.at).toISOString(), ...(greetRemindUrgent(step) ? { urgent: true as const } : {}) };
          deps.toast(target.tabSessionId, { toastId: deps.uuid(), kind: 'info', scope: `greet.${follow.f}`, fanLabel, greet });
          const page = target.page?.trim().slice(0, 256) || null;
          for (const other of target.elsewhere ?? []) {
            if (other.tabSessionId === target.tabSessionId) continue;
            const named = other.foreign && page !== null ? { ...greet, page } : greet;
            deps.toast(other.tabSessionId, { toastId: deps.uuid(), kind: 'info', scope: `greet.${follow.f}`, fanLabel, greet: named });
          }
          reminded += 1;
        }
        persist();
        log({ level: 'info', scope: 'bg.fansly.greet', msg: 'greeting checked', fields: { follows: batch.length, reminded } });
      }
    } finally {
      running = false;
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
    followedAt(creator, fanRef) {
      // The newest follow of the fan (oldest first here).
      for (let at = follows.length - 1; at >= 0; at -= 1) {
        const follow = follows[at];
        if (follow !== undefined && follow.c === creator && follow.f === fanRef) return follow.at;
      }
      return null;
    },
    dispose() {
      disposed = true;
      if (timer !== null) deps.clock.clearTimer(timer);
      timer = null;
    },
  };
}
