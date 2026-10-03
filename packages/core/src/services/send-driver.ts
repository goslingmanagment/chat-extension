// The tab side of a preview send (architecture.md §6.7.7; SP-054, NF-019,
// RB-007). One human click of «Отправить» on one part: the side-effect-free
// preflight in MAIN, then `send.begin` in the background (journal, locks,
// hub `dispatch`), then exactly one queue call in MAIN with the hub's
// ticket, then every state MAIN observes is reported back. A click while the
// same part is in flight joins it (twenty fast clicks are one attempt). A
// bridge failure of the queue call is `uncertain` and the command is never
// sent again — not after a timeout, not with the same attemptId. After an
// `uncertain` the driver keeps listening to MAIN (bounded): the late linked
// receipt and echo are the only automatic way out of it (§6.7.8, NF-022).
// It stops listening at a final state, at the bound, or on dispose().

import { type DispatchTicket, type PreviewSendPort, type PreviewSendRequest, type SendAttemptView } from '@cg/contracts/send';
import { type SendAttemptState } from '@cg/contracts/send-rules';
import { type SendBegin } from '@cg/contracts/tab-messages';

import { attemptKeyOf } from '../domain/send';
import { type Clock, type IdSource, type TimerHandle } from './ports';

/** How long MAIN is listened to after the queue call, for the late linked pair of an uncertain send. */
export const LATE_PAIR_LISTEN_MS = 10 * 60_000;

/** States after which MAIN has nothing more to say about an attempt. */
const FINAL_STATES: readonly SendAttemptState[] = ['sentObserved', 'rejected', 'held', 'notEnqueued'];

/** The background half, over the tab protocol (`send.begin`, `send.report`). */
export interface BackgroundSendPort {
  begin(begin: SendBegin): Promise<{ readonly ok: true; readonly ticket: DispatchTicket } | { readonly ok: false; readonly view: SendAttemptView }>;
  report(view: SendAttemptView, pendingId?: string): Promise<void>;
}

/** What the preview controller knows at the click (the part, its frozen operation and checkpoint, the click's cause). */
export type SendClick = Omit<SendBegin, 'attemptId'> & Pick<PreviewSendRequest, 'plainText' | 'isAiGenerated'>;

export interface SendDriverDeps {
  /** HostPort.previewSend; null — X8 is off on this page or build. */
  readonly port: PreviewSendPort | null;
  readonly background: BackgroundSendPort;
  readonly ids: Pick<IdSource, 'uuid'>;
  /** Every view the driver learns, for the preview's «Отправить» row. */
  readonly onView?: (view: SendAttemptView) => void;
  /** Bounds the listening (LATE_PAIR_LISTEN_MS); without a clock it lasts until a final state or dispose(). */
  readonly clock?: Pick<Clock, 'setTimer' | 'clearTimer'>;
  readonly lateListenMs?: number;
}

interface Subscription {
  readonly unsubscribe: () => void;
  timer: TimerHandle | null;
}

export class PreviewSendDriver {
  private readonly inflight = new Map<string, Promise<SendAttemptView>>();
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(private readonly deps: SendDriverDeps) {}

  /** One click of «Отправить»; resolves with the attempt's state once the queue call answered. */
  send(click: SendClick): Promise<SendAttemptView> {
    const key = attemptKeyOf({ generationRef: click.group.generationRef, variant: click.group.variant, partIndex: click.part.index, previewRevision: click.previewRevision });
    const running = this.inflight.get(key);
    if (running !== undefined) return running;
    const work = this.run(click).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, work);
    return work;
  }

  /** Stops listening to MAIN's states (the preview closed; the background keeps the attempt). */
  dispose(): void {
    for (const attemptId of [...this.subscriptions.keys()]) this.stop(attemptId);
  }

  /** Attempts whose MAIN states are still listened to (diagnostics, tests). */
  get listening(): number {
    return this.subscriptions.size;
  }

  private listen(attemptId: string, port: PreviewSendPort): void {
    const subscription: Subscription = {
      unsubscribe: port.onState(attemptId, (view) => {
        this.deps.onView?.(view);
        this.deps.background.report(view).catch(() => undefined);
        if (FINAL_STATES.includes(view.state)) this.stop(attemptId);
      }),
      timer: null,
    };
    this.subscriptions.set(attemptId, subscription);
    const clock = this.deps.clock;
    if (clock !== undefined) subscription.timer = clock.setTimer(this.deps.lateListenMs ?? LATE_PAIR_LISTEN_MS, () => this.stop(attemptId));
  }

  private stop(attemptId: string): void {
    const subscription = this.subscriptions.get(attemptId);
    if (subscription === undefined) return;
    this.subscriptions.delete(attemptId);
    subscription.unsubscribe();
    if (subscription.timer !== null) this.deps.clock?.clearTimer(subscription.timer);
  }

  private async run(click: SendClick): Promise<SendAttemptView> {
    const attemptId = this.deps.ids.uuid();
    const port = this.deps.port;
    const request: PreviewSendRequest = {
      attemptId,
      target: click.target,
      generationRef: click.group.generationRef,
      part: click.part,
      previewRevision: click.previewRevision,
      plainText: click.plainText,
      isAiGenerated: click.isAiGenerated,
      checkpoint: click.checkpoint,
      cause: click.cause,
    };
    if (port === null) return this.local({ attemptId, state: 'held', code: 'CG-SEND-HOST' });
    let preflight;
    try {
      preflight = await port.preflight(request);
    } catch {
      preflight = { ok: false as const, code: 'CG-SEND-HOST' as const };
    }
    if (!preflight.ok) return this.local({ attemptId, state: 'held', code: preflight.code });

    const { plainText: _text, isAiGenerated: _ai, ...rest } = click;
    const begun = await this.deps.background.begin({ ...rest, attemptId });
    if (!begun.ok) {
      this.deps.onView?.(begun.view);
      return begun.view;
    }
    // Listen before the queue call: an early state must not be lost.
    this.listen(attemptId, port);
    let view: SendAttemptView;
    let pendingId: string | undefined;
    try {
      const commit = await port.commit(request, begun.ticket);
      switch (commit.state) {
        case 'nativeEnqueued':
          view = { attemptId, state: 'nativeEnqueued' };
          pendingId = commit.pendingId;
          break;
        case 'notEnqueued':
        case 'held':
        case 'uncertain':
          view = { attemptId, state: commit.state, code: commit.code };
          break;
      }
    } catch {
      // The queue call may have run: uncertain, never sent again (BRIDGE_WRITE_FAILURES); MAIN may still see its pair.
      view = { attemptId, state: 'uncertain', code: 'CG-SEND-UNCERTAIN' };
    }
    // Nothing reached the queue: MAIN has nothing more to say. Enqueued or uncertain: keep listening.
    if (FINAL_STATES.includes(view.state)) this.stop(attemptId);
    this.deps.onView?.(view);
    try {
      await this.deps.background.report(view, pendingId);
    } catch {
      // A lost report: the background's silence deadline makes the attempt uncertain; nothing is re-sent.
    }
    return view;
  }

  /** Nothing reached the background: a refusal of this click only. */
  private local(view: SendAttemptView): SendAttemptView {
    this.deps.onView?.(view);
    return view;
  }
}
