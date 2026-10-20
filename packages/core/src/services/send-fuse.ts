// What MAIN saw after an X8 send that one click of ours never does — another
// text, a second message of one click, another chat or account (decision
// X25's fuse, `send.fuse` of a tab).
//
// Since 2026-10-21 it holds nothing (2026-10-20 restrictions, item 4; the
// owner on X25: «просто забить, пока не сломается»): the preview send stays
// on in every tab, nothing is kept or told to the tabs, and a run of unknown
// outcomes trips nothing. What a tab saw is logged and counted in
// client_health (CG-SEND-FUSE), so a break shows in the logs. A fuse an older
// version kept in storage.local (`send.fuse`) is dropped at the first load.
//
// It never sends, never retries and never touches an attempt: an outcome
// stays what it was, the hub's custody is reported as before. The wire
// (`send.fuse`, `send.fuseState`, `send.fuseReset`) stays as it is: a state
// that is always «no fuse».

import { type SendFuseFact, type SendFuseState } from '@cg/contracts/send';

import { LOCAL_KEYS } from '../domain/storage';
import { NO_LOG, WriteQueue, type Clock, type KeyValueStore, type LogSink, type TabEventSink } from './ports';

/** storage.local: where an older version kept a tripped fuse; cleared at the first load. */
export const SEND_FUSE_KEY = LOCAL_KEYS.sendFuse;

const NONE: SendFuseState = { fuse: null, resetAt: null };

export interface SendFuseDeps {
  readonly clock: Pick<Clock, 'now'>;
  /** storage.local; omitted — nothing to clear. */
  readonly store?: KeyValueStore;
  /** Kept for the composition's wiring: nothing is told to the tabs any more. */
  readonly events?: TabEventSink;
  readonly log?: LogSink;
  /** What a tab saw (client_health counts CG-SEND-FUSE). */
  readonly onTrip?: (trip: SendFuseTrip) => void;
}

/** What a tab's MAIN saw after a send, and the tab's build. */
export type SendFuseTrip = Pick<SendFuseFact, 'reason' | 'where'> & { readonly attemptId: string | null; readonly build: string | null };

export class SendFuseKeeper {
  private loading: Promise<void> | null = null;
  private readonly writes = new WriteQueue();
  private readonly log: LogSink;

  constructor(private readonly deps: SendFuseDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  /** Drops a fuse an older version kept. Never rejects. */
  load(): Promise<void> {
    this.loading ??= this.clear();
    return this.loading;
  }

  private async clear(): Promise<void> {
    const store = this.deps.store;
    if (store === undefined) return;
    try {
      if ((await store.get(SEND_FUSE_KEY)) === undefined) return;
      await this.writes.run(() => store.set(SEND_FUSE_KEY, null));
    } catch {
      // Nothing reads it any more: a value left behind holds nothing.
    }
  }

  /** Always «no fuse» (`send.fuseState`, diagnostics). */
  current(): SendFuseState {
    return NONE;
  }

  /** `send.fuse` of a tab: logged and counted; the preview send stays on. */
  async trip(trip: SendFuseTrip): Promise<SendFuseState> {
    await this.load();
    this.log.write({
      level: 'warn',
      scope: 'bg.send',
      msg: 'preview send: MAIN saw what one click does not do (nothing switched off)',
      fields: { reason: trip.reason, where: trip.where, build: trip.build },
      ...(trip.attemptId === null ? {} : { ctx: { attemptId: trip.attemptId } }),
    });
    this.deps.onTrip?.(trip);
    return NONE;
  }

  /** «Сбросить предохранитель» of an older «Статус»: there is nothing to reset. */
  async reset(): Promise<SendFuseState> {
    await this.load();
    return NONE;
  }

  /** Resolves when every write so far settled. */
  idle(): Promise<void> {
    return this.writes.idle();
  }
}
