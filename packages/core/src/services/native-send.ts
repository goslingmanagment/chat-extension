// The human sent it (architecture.md §6.6, §8.5, §6.7.13; hub H-7
// `registerNativeSend`). A part of a preview or of a «Новые» card went into
// the composer by «Открыть и вставить», and the person pressed ChatSpace's
// own Send: the tab proved it by the receipt and the echo with one id
// (`op.reportSent`). The hub is told, so that
// - a greeting counts as «поприветствован» for everyone, and
// - the part cannot be sent a second time from a preview.
// It needs no `previewSend` flag and gives no right to send anything else.
//
// A report of what already happened, never a send: it is repeated with the
// same attempt id only while the hub gives no answer (no connection, 429,
// 5xx) and the same person is signed in, a bounded number of times. Any
// answer of the hub ends it. The dock's own results are not registered:
// there is no preview custody for an open chat.

import { type ClaimOp, type HubFacade, type HubFailure } from '@cg/contracts/hub';
import { type PartRef } from '@cg/contracts/ids';
import { type OpView } from '@cg/contracts/ops';

import { reportRetryable } from '../domain/send';
import { NO_LOG, type Clock, type IdSource, type LogSink } from './ports';
import { REPORT_RETRY_DELAYS_MS } from './send-coordinator';

export type NativeSendOutcome =
  /** Not a result of a preview or a «Новые» card, or not one a part of which can be named. */
  | 'not-ours'
  | 'registered'
  /** The hub answered and did not take it (the part is already counted, the route is not there). */
  | 'refused'
  /** The hub gave no answer for as long as it was asked, or the person changed meanwhile. */
  | 'undelivered';

export interface NativeSendDeps {
  readonly clock: Pick<Clock, 'setTimer'>;
  readonly ids: Pick<IdSource, 'uuid'>;
  readonly hub: Pick<HubFacade, 'claim'>;
  /** This install's id for the hub's custody (`instanceId`). */
  readonly instanceId: () => string;
  /** The sign-in epoch now; null — nobody is signed in. */
  readonly epoch: () => number | null;
  readonly log?: LogSink;
}

/**
 * The hub's `registerNativeSend` for a part of `view`, or null when the
 * operation is not a finished preview or «Новые» result with that part.
 */
export type NativeSendClaim = ClaimOp & { readonly body: Extract<ClaimOp['body'], { readonly action: 'registerNativeSend' }> };

export function nativeSendClaim(view: OpView, part: PartRef, platformMessageId: string, ids: { readonly attemptId: string; readonly instanceId: string }): NativeSendClaim | null {
  if (view.surface !== 'preview' && view.surface !== 'newcomers') return null;
  if (view.state !== 'done' || view.generationRef === undefined || view.result === undefined) return null;
  const variant = part.variant ?? 0;
  const parts = view.result.kind === 'parts' ? (variant === 0 ? view.result.parts : undefined) : view.result.kind === 'variants' ? view.result.variants[variant] : undefined;
  if (parts === undefined || part.index >= parts.length) return null;
  return {
    pageLabel: view.target.binding.pageLabel,
    fanRef: view.target.fanRef,
    body: {
      action: 'registerNativeSend',
      attemptId: ids.attemptId,
      instanceId: ids.instanceId,
      purpose: view.surface === 'newcomers' ? 'greeting' : 'preview-reply',
      group: { generationRef: view.generationRef, variant, partCount: parts.length },
      partIndex: part.index,
      platformMessageId,
    },
  };
}

function failureOf(error: unknown): HubFailure | null {
  if (typeof error !== 'object' || error === null) return null;
  const failure = (error as { readonly name?: unknown; readonly failure?: unknown }).failure;
  return (error as { readonly name?: unknown }).name === 'HubCallError' && typeof failure === 'object' && failure !== null ? (failure as HubFailure) : null;
}

export class NativeSendRegistrar {
  /** Registrations in flight, by operation, part and message id: a second report of the same send joins the first. */
  private readonly running = new Map<string, Promise<NativeSendOutcome>>();
  private readonly log: LogSink;

  constructor(private readonly deps: NativeSendDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  /** `op.reportSent` of a tab: `view` is the operation the sent draft descends from. */
  register(view: OpView | null, part: PartRef, platformMessageId: string): Promise<NativeSendOutcome> {
    if (view === null) return Promise.resolve('not-ours');
    const key = `${view.opId}|${part.variant ?? 0}|${part.index}|${platformMessageId}`;
    const known = this.running.get(key);
    if (known !== undefined) return known;
    const op = nativeSendClaim(view, part, platformMessageId, { attemptId: this.deps.ids.uuid(), instanceId: this.deps.instanceId() });
    if (op === null) return Promise.resolve('not-ours');
    const run = this.deliver(op, view.opId).finally(() => this.running.delete(key));
    this.running.set(key, run);
    return run;
  }

  get inFlight(): number {
    return this.running.size;
  }

  private async deliver(op: NativeSendClaim, opId: string): Promise<NativeSendOutcome> {
    const epoch = this.deps.epoch();
    const done = (outcome: NativeSendOutcome, tries: number): NativeSendOutcome => {
      this.log.write({ level: outcome === 'registered' ? 'info' : 'warn', scope: 'bg.send', msg: 'native send registered', fields: { outcome, tries, purpose: op.body.purpose }, ctx: { opId, attemptId: op.body.attemptId } });
      return outcome;
    };
    for (let i = 0; ; i += 1) {
      // Another person, or nobody: the report was the previous sign-in's to make.
      if (epoch === null || this.deps.epoch() !== epoch) return done('undelivered', i);
      try {
        await this.deps.hub.claim(op);
        return done('registered', i + 1);
      } catch (error) {
        const failure = failureOf(error);
        // A refusal of the hub layer itself (no such route on this hub, signed out) or an answer of the hub: final.
        if (failure === null || !reportRetryable(failure)) return done('refused', i + 1);
        const delay = REPORT_RETRY_DELAYS_MS[i];
        if (delay === undefined) return done('undelivered', i + 1);
        await new Promise<void>((resolve) => this.deps.clock.setTimer(delay, resolve));
      }
    }
  }
}
