// The X8 fuse of this browser (decision X25; architecture.md §6.2, §6.7.6).
// The owner lets the preview send run on any ChatSpace build («until
// something breaks»): the receipt gate passes the hub's «any build»
// sentinel. What protects instead is this fuse. It trips when
// - a tab reports what MAIN saw after an X8 send whose outcome is known (`send.fuse`):
//   another text, a second message of one click, another chat or account;
// - SEND_FUSE_UNCERTAIN_RUN sends in a row end `uncertain` here (the outcome
//   of a send restored after a restart does not count).
//
// A tripped fuse is kept in storage.local (`send.fuse`): machine values only
// — when, why, where it was seen, the ChatSpace build, the attempt id; never
// a text. It holds X8 off in every tab of this browser that runs the build it
// names (sendFuseHolds) — the coordinator refuses `send.begin` with
// CG-SEND-FUSE, and every tab is told (`send.fuse`) so its host adapter turns
// the capability off. Another build lifts it by itself; the person lifts it
// with «Сбросить предохранитель» in «Статус» (`send.fuseReset`). The first
// trip on a build stands: a later one on the same build changes nothing. A
// trip on another build while the fuse still holds one (two builds in a row,
// or two tabs on two builds) makes it hold every build: then only the reset
// lifts it — two breaks in a row are not ChatSpace's build alone.
//
// The fuse never sends, never retries and never touches an attempt: an
// outcome stays what it was, the hub's custody is reported as before.

import { SendFuseStateSchema, type SendFuse, type SendFuseFact, type SendFuseState } from '@cg/contracts/send';
import { SEND_FUSE_UNCERTAIN_RUN, sendFuseHolds, type SendAttemptState } from '@cg/contracts/send-rules';

import { LOCAL_KEYS } from '../domain/storage';
import { NO_LOG, WriteQueue, type Clock, type KeyValueStore, type LogSink, type TabEventSink } from './ports';

/** storage.local: the fuse, its last reset and the run of unknown outcomes. */
export const SEND_FUSE_KEY = LOCAL_KEYS.sendFuse;

const NONE: SendFuseState = { fuse: null, resetAt: null };

interface Stored {
  readonly v: 1;
  readonly state: SendFuseState;
  readonly uncertainRun: number;
}

export interface SendFuseDeps {
  readonly clock: Pick<Clock, 'now'>;
  /** storage.local; omitted — memory only. */
  readonly store?: KeyValueStore;
  /** `send.fuse` to every tab and page. */
  readonly events: TabEventSink;
  readonly log?: LogSink;
  /** The fuse tripped (client_health counts CG-SEND-FUSE). */
  readonly onTrip?: (fuse: SendFuse) => void;
}

/** What tripped the fuse: MAIN's fact and the tab's build, or the background's run of unknown outcomes. */
export type SendFuseTrip = Pick<SendFuseFact, 'reason' | 'where'> & { readonly attemptId: string | null; readonly build: string | null };

export class SendFuseKeeper {
  private state: SendFuseState = NONE;
  private uncertainRun = 0;
  private loading: Promise<void> | null = null;
  private readonly writes = new WriteQueue();
  private readonly log: LogSink;

  constructor(private readonly deps: SendFuseDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  /** Reads the stored fuse once; a value that does not read is no fuse (and is logged). Never rejects. */
  load(): Promise<void> {
    this.loading ??= this.restore();
    return this.loading;
  }

  private async restore(): Promise<void> {
    if (this.deps.store === undefined) return;
    let raw: unknown;
    try {
      raw = await this.deps.store.get(SEND_FUSE_KEY);
    } catch {
      this.log.write({ level: 'warn', scope: 'bg.send', msg: 'send fuse not read', code: 'CG-STORAGE-READ' });
      return;
    }
    if (raw === undefined || raw === null) return;
    const record = typeof raw === 'object' ? (raw as Partial<Record<keyof Stored, unknown>>) : {};
    const state = SendFuseStateSchema.safeParse(record.state);
    if (record.v !== 1 || !state.success) {
      this.log.write({ level: 'warn', scope: 'bg.send', msg: 'send fuse unreadable, dropped', code: 'CG-STORAGE-VERSION' });
      return;
    }
    // A trip or a reset since the event page woke is newer than what was stored.
    if (this.state === NONE) this.state = state.data;
    const run = record.uncertainRun;
    if (typeof run === 'number' && Number.isSafeInteger(run) && run >= 0) this.uncertainRun = Math.max(this.uncertainRun, Math.min(run, SEND_FUSE_UNCERTAIN_RUN));
  }

  /** The fuse as kept now (`send.fuseState`, diagnostics). */
  current(): SendFuseState {
    return this.state;
  }

  /** Whether the fuse holds X8 off on a tab of this ChatSpace build (undefined or null — not known: it holds). */
  holds(build: string | null | undefined): boolean {
    return sendFuseHolds(this.state.fuse, build);
  }

  /** `send.fuse` of a tab, or the run of outcomes: the first trip on a build stands. */
  async trip(trip: SendFuseTrip): Promise<SendFuseState> {
    await this.load();
    if (this.holds(trip.build)) {
      this.log.write({ level: 'info', scope: 'bg.send', msg: 'send fuse already tripped', fields: { reason: trip.reason, where: trip.where }, ...(trip.attemptId === null ? {} : { ctx: { attemptId: trip.attemptId } }) });
      return this.state;
    }
    // Tripped on another build while the fuse holds one: it holds every build until the person resets it.
    const build = this.state.fuse === null ? trip.build : null;
    const fuse: SendFuse = { trippedAt: this.deps.clock.now(), reason: trip.reason, where: trip.where, build, attemptId: trip.attemptId };
    this.state = { fuse, resetAt: this.state.resetAt };
    this.uncertainRun = 0;
    // One trip, one count of the day: a tab's trip was counted by the tab's own record (`tab.host` `x8-fuse`); the run of
    // outcomes is seen here only.
    this.log.write({
      level: 'warn',
      scope: 'bg.send',
      msg: 'send fuse tripped: preview send off',
      ...(trip.where === 'outcomes' ? { code: 'CG-SEND-FUSE' as const } : {}),
      fields: { reason: fuse.reason, where: fuse.where, build: fuse.build },
      ...(fuse.attemptId === null ? {} : { ctx: { attemptId: fuse.attemptId } }),
    });
    this.deps.onTrip?.(fuse);
    await this.changed();
    return this.state;
  }

  /** «Сбросить предохранитель»: X8 is on again (until the fuse trips again); the run of outcomes starts over. */
  async reset(): Promise<SendFuseState> {
    await this.load();
    const had = this.state.fuse;
    this.state = { fuse: null, resetAt: this.deps.clock.now() };
    this.uncertainRun = 0;
    this.log.write({ level: 'info', scope: 'bg.send', msg: 'send fuse reset by the person', fields: { had: had === null ? null : had.reason } });
    await this.changed();
    return this.state;
  }

  /**
   * An attempt of this install moved (the coordinator's one place of state change). `uncertain` adds to the run of
   * unknown outcomes, a known outcome (`sentObserved`, `rejected`) ends it; at SEND_FUSE_UNCERTAIN_RUN the fuse
   * trips with reason `uncertain`. An attempt restored after a restart is not counted: its outcome was unknown
   * because the browser went away, not because of ChatSpace.
   */
  outcome(change: { readonly state: SendAttemptState; readonly restored: boolean; readonly build: string | null | undefined }): void {
    if (change.state === 'sentObserved' || change.state === 'rejected') {
      if (this.uncertainRun === 0) return;
      this.uncertainRun = 0;
      void this.save();
      return;
    }
    if (change.state !== 'uncertain' || change.restored) return;
    this.uncertainRun += 1;
    if (this.uncertainRun < SEND_FUSE_UNCERTAIN_RUN) {
      void this.save();
      return;
    }
    void this.trip({ reason: 'uncertain', where: 'outcomes', attemptId: null, build: change.build ?? null });
  }

  /** Resolves when every write so far settled. */
  idle(): Promise<void> {
    return this.writes.idle();
  }

  private async changed(): Promise<void> {
    this.deps.events.emit(null, 'send.fuse', this.state);
    await this.save();
  }

  private save(): Promise<void> {
    const store = this.deps.store;
    if (store === undefined) return Promise.resolve();
    const value: Stored = { v: 1, state: this.state, uncertainRun: this.uncertainRun };
    return this.writes
      .run(() => store.set(SEND_FUSE_KEY, value))
      .catch(() => {
        // The fuse holds in memory for this event page; the next one starts without it.
        this.log.write({ level: 'error', scope: 'bg.send', msg: 'send fuse write failed', code: 'CG-STORAGE-WRITE' });
      });
  }
}
