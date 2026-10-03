// The tab side of a preview send (architecture.md §6.7.7; SP-054, NF-019,
// RB-007). One human click of «Отправить» on one part: the side-effect-free
// preflight in MAIN, then `send.begin` in the background (journal, locks,
// hub `dispatch`), then exactly one queue call in MAIN with the hub's
// ticket, then every state MAIN observes is reported back. A click while the
// same part is in flight joins it (twenty fast clicks are one attempt). A
// bridge failure of the queue call is `uncertain` and the command is never
// sent again — not after a timeout, not with the same attemptId.

import { type DispatchTicket, type PreviewSendPort, type PreviewSendRequest, type SendAttemptView } from '@cg/contracts/send';
import { type SendBegin } from '@cg/contracts/tab-messages';

import { attemptKeyOf } from '../domain/send';
import { type IdSource } from './ports';

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
}

export class PreviewSendDriver {
  private readonly inflight = new Map<string, Promise<SendAttemptView>>();
  private readonly subscriptions = new Map<string, () => void>();

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
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
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
    const unsubscribe = port.onState(attemptId, (view) => {
      this.deps.onView?.(view);
      this.deps.background.report(view).catch(() => undefined);
    });
    this.subscriptions.set(attemptId, unsubscribe);
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
      // The queue call may have run: uncertain, never sent again (BRIDGE_WRITE_FAILURES).
      view = { attemptId, state: 'uncertain', code: 'CG-SEND-UNCERTAIN' };
    }
    if (view.state !== 'nativeEnqueued') {
      unsubscribe();
      this.subscriptions.delete(attemptId);
    }
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
