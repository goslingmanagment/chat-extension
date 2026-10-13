// The human sent it (architecture.md §6.6, §8.5, §6.7.13; hub H-7
// `registerNativeSend`). A part of a preview or of a «Новые» card went into
// the composer by «Открыть и вставить», and the person pressed ChatSpace's
// own Send: the tab proved it by the receipt and the echo with one id
// (`op.reportSent`). The hub is told, so that
// - a greeting counts as «поприветствован» for everyone, and
// - the part cannot be sent a second time from a preview.
// It needs no `previewSend` flag and gives no right to send anything else.
//
// A report of what already happened, never a send. The hub takes a repeat
// with the same attempt id as a read (H-7), so the registration is OWED until
// the hub answers: it is journaled before the first call (ids only — the
// page, the fan, the generation, the part, the message id) and delivered
// again by the next instance of the event page, after a sign-in of the same
// person, and whenever the hub is heard again (`resume`). Within one run it
// is repeated on the custody report's schedule and then waits for the next
// such moment. Any answer of the hub ends it. While X8 is off this is the
// only thing that marks a fan greeted (§8.5): a registration lost with the
// event page would leave the fan open for a second greeting.
//
// What is owed belongs to the person who sent: it is delivered only under
// their sign-in, survives their sign-out (like an open X8 attempt) and is
// given up after NATIVE_SEND_KEEP_MS. The dock's own results are not
// registered: there is no preview custody for an open chat.

import { type ClaimOp, type HubFacade, type HubFailure } from '@cg/contracts/hub';
import { type PartRef } from '@cg/contracts/ids';
import { type OpView } from '@cg/contracts/ops';

import { REPORT_RETRY_DELAYS_MS, nativePartOf, reportRetryable } from '../domain/send';
import { LOCAL_KEYS } from '../domain/storage';
import { NO_LOG, WriteQueue, type Clock, type IdSource, type KeyValueStore, type LogSink } from './ports';

/** storage.local: the registrations of human sends the hub has not answered yet (ids only, never a text). */
export const NATIVE_SENDS_KEY = LOCAL_KEYS.nativeSends;
/** Registrations kept at most; beyond it the oldest go. */
export const NATIVE_SENDS_MAX = 200;
/** A registration nobody could deliver for this long is given up (the «Новые» window is long over). */
export const NATIVE_SEND_KEEP_MS = 7 * 24 * 60 * 60_000;

export type NativeSendOutcome =
  /** Not a result of a preview or a «Новые» card, or not one a part of which can be named. */
  | 'not-ours'
  | 'registered'
  /** The hub answered and did not take it (the part is already counted, the route is not there). */
  | 'refused'
  /** The hub gave no answer for as long as it was asked, or the person is not signed in: it stays owed. */
  | 'undelivered';

export interface NativeSendDeps {
  readonly clock: Pick<Clock, 'setTimer' | 'now'>;
  readonly ids: Pick<IdSource, 'uuid'>;
  readonly hub: Pick<HubFacade, 'claim'>;
  /** This install's id for the hub's custody (`instanceId`). */
  readonly instanceId: () => string;
  /** Who is signed in — `hubOrigin|userId`; null — nobody. A registration is its sender's to make. */
  readonly owner: () => string | null;
  /** storage.local; omitted — memory only. */
  readonly store?: KeyValueStore;
  readonly log?: LogSink;
}

/**
 * The hub's `registerNativeSend` for a part of `view`, or null when the
 * operation is not a finished preview or «Новые» result with that part.
 */
export type NativeSendClaim = ClaimOp & { readonly body: Extract<ClaimOp['body'], { readonly action: 'registerNativeSend' }> };

export function nativeSendClaim(view: OpView, part: PartRef, platformMessageId: string, ids: { readonly attemptId: string; readonly instanceId: string }): NativeSendClaim | null {
  const sent = nativePartOf(view, part);
  if (sent === null) return null;
  return {
    pageLabel: view.target.binding.pageLabel,
    fanRef: view.target.fanRef,
    body: {
      action: 'registerNativeSend',
      attemptId: ids.attemptId,
      instanceId: ids.instanceId,
      purpose: sent.purpose,
      group: sent.group,
      partIndex: sent.partIndex,
      platformMessageId,
    },
  };
}

function failureOf(error: unknown): HubFailure | null {
  if (typeof error !== 'object' || error === null) return null;
  const failure = (error as { readonly name?: unknown; readonly failure?: unknown }).failure;
  return (error as { readonly name?: unknown }).name === 'HubCallError' && typeof failure === 'object' && failure !== null ? (failure as HubFailure) : null;
}

/** One owed registration as it is journaled: who owes it, since when, and the hub's own request (ids only). */
interface Owed {
  /** The operation, the variant, the part and the message id: a second report of the same send is the same registration. */
  readonly key: string;
  readonly owner: string;
  readonly opId: string;
  readonly at: number;
  readonly op: NativeSendClaim;
}

const isText = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

function isOwed(value: unknown): value is Owed {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<Record<keyof Owed, unknown>>;
  if (!isText(item.key) || !isText(item.owner) || !isText(item.opId) || typeof item.at !== 'number' || !Number.isFinite(item.at)) return false;
  const op = item.op as { readonly pageLabel?: unknown; readonly fanRef?: unknown; readonly body?: unknown } | null | undefined;
  if (typeof op !== 'object' || op === null || !isText(op.pageLabel) || !isText(op.fanRef)) return false;
  const body = op.body as Partial<Record<keyof NativeSendClaim['body'], unknown>> | null | undefined;
  if (typeof body !== 'object' || body === null || body.action !== 'registerNativeSend') return false;
  if (!isText(body.attemptId) || !isText(body.instanceId) || (body.purpose !== 'greeting' && body.purpose !== 'preview-reply') || !isCount(body.partIndex) || !isText(body.platformMessageId)) return false;
  const group = body.group as { readonly generationRef?: unknown; readonly variant?: unknown; readonly partCount?: unknown } | null | undefined;
  return typeof group === 'object' && group !== null && isText(group.generationRef) && isCount(group.variant) && isCount(group.partCount);
}

export class NativeSendRegistrar {
  /** What the hub has not answered yet, by registration key; journaled. */
  private readonly owed = new Map<string, Owed>();
  /** Deliveries in flight, by registration key: a second report of the same send joins the first. */
  private readonly running = new Map<string, Promise<NativeSendOutcome>>();
  /** What the hub already answered, while this event page lives: a late repeat of the same report asks nothing again. */
  private readonly answered = new Map<string, NativeSendOutcome>();
  private readonly writes = new WriteQueue();
  private readonly log: LogSink;

  constructor(private readonly deps: NativeSendDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  /** After the event page woke up: what the previous instance still owed is delivered under the sender's sign-in. */
  async restore(): Promise<number> {
    const store = this.deps.store;
    if (store === undefined) return 0;
    let raw: unknown;
    try {
      raw = await store.get(NATIVE_SENDS_KEY);
    } catch {
      this.log.write({ level: 'warn', scope: 'bg.send', msg: 'owed native sends unreadable, starting empty', code: 'CG-STORAGE-READ' });
      return 0;
    }
    const stored = typeof raw === 'object' && raw !== null && (raw as { v?: unknown }).v === 1 ? (raw as { owed?: unknown }).owed : undefined;
    if (!Array.isArray(stored)) return 0;
    const now = this.deps.clock.now();
    let dropped = 0;
    for (const item of stored.slice(-NATIVE_SENDS_MAX)) {
      if (!isOwed(item) || now - item.at > NATIVE_SEND_KEEP_MS) dropped += 1;
      else if (!this.owed.has(item.key)) this.owed.set(item.key, item);
    }
    if (dropped > 0 || stored.length > NATIVE_SENDS_MAX) this.save();
    if (this.owed.size > 0) this.log.write({ level: 'info', scope: 'bg.send', msg: 'owed native sends restored', fields: { owed: this.owed.size, dropped } });
    this.resume();
    return this.owed.size;
  }

  /** `op.reportSent` of a tab: `view` is the operation the sent draft descends from. */
  register(view: OpView | null, part: PartRef, platformMessageId: string): Promise<NativeSendOutcome> {
    // The dock's own results have no preview custody: nothing of them is registered, journaled or remembered.
    if (view === null || (view.surface !== 'preview' && view.surface !== 'newcomers')) return Promise.resolve('not-ours');
    const key = `${view.opId}|${part.variant ?? 0}|${part.index}|${platformMessageId}`;
    const known = this.running.get(key);
    if (known !== undefined) return known;
    // The same send reported again (the tab repeated a report the lost port never acknowledged): the same attempt
    // id while it is owed, and nothing at all once the hub has answered it.
    const settled = this.answered.get(key);
    if (settled !== undefined) return Promise.resolve(settled);
    const before = this.owed.get(key);
    if (before !== undefined) return this.start(before);
    const owner = this.deps.owner();
    const op = nativeSendClaim(view, part, platformMessageId, { attemptId: this.deps.ids.uuid(), instanceId: this.deps.instanceId() });
    if (op === null) return Promise.resolve('not-ours');
    // Nobody is signed in: there is nobody whose registration this could be.
    if (owner === null) return Promise.resolve('undelivered');
    const owed: Owed = { key, owner, opId: view.opId, at: this.deps.clock.now(), op };
    this.owed.set(key, owed);
    while (this.owed.size > NATIVE_SENDS_MAX) {
      const oldest = this.owed.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      this.owed.delete(oldest);
    }
    this.save();
    return this.start(owed);
  }

  /**
   * The hub was heard again (a bootstrap arrived), the same person signed in, the event page woke: every
   * registration owed by the person who is signed in now and not on its way is delivered again.
   */
  resume(): number {
    const owner = this.deps.owner();
    if (owner === null) return 0;
    let started = 0;
    for (const owed of [...this.owed.values()]) {
      if (owed.owner !== owner || this.running.has(owed.key)) continue;
      void this.start(owed);
      started += 1;
    }
    return started;
  }

  get inFlight(): number {
    return this.running.size;
  }

  /** Registrations the hub has not answered (diagnostics, tests). */
  get pending(): number {
    return this.owed.size;
  }

  /** Resolves when every journal write so far settled (tests, shutdown). */
  idle(): Promise<void> {
    return this.writes.idle();
  }

  private start(owed: Owed): Promise<NativeSendOutcome> {
    const known = this.running.get(owed.key);
    if (known !== undefined) return known;
    const run = this.deliver(owed).finally(() => this.running.delete(owed.key));
    this.running.set(owed.key, run);
    return run;
  }

  private async deliver(owed: Owed): Promise<NativeSendOutcome> {
    const { op } = owed;
    const done = (outcome: NativeSendOutcome, tries: number): NativeSendOutcome => {
      // The hub answered: nothing is owed any more. No answer — it stays in the journal for the next `resume`.
      if (outcome !== 'undelivered') {
        if (this.owed.delete(owed.key)) this.save();
        this.answered.set(owed.key, outcome);
        if (this.answered.size > NATIVE_SENDS_MAX) this.answered.delete(this.answered.keys().next().value ?? '');
      }
      this.log.write({ level: outcome === 'registered' ? 'info' : 'warn', scope: 'bg.send', msg: 'native send registered', fields: { outcome, tries, purpose: op.body.purpose, owed: this.owed.size }, ctx: { opId: owed.opId, attemptId: op.body.attemptId } });
      return outcome;
    };
    // The journal first: an event page unloaded before the hub answers leaves the registration to its successor.
    await this.writes.idle();
    for (let i = 0; ; i += 1) {
      // Another person, or nobody: the report is its sender's to make, and waits for their sign-in.
      if (this.deps.owner() !== owed.owner) return done('undelivered', i);
      try {
        await this.deps.hub.claim(op);
        return done('registered', i + 1);
      } catch (error) {
        const failure = failureOf(error);
        // The sign-in ended under the call: nothing was refused, the registration waits for the person.
        if (this.deps.owner() !== owed.owner) return done('undelivered', i + 1);
        // A refusal of the hub layer itself (no such route on this hub) or an answer of the hub: final.
        if (failure === null || !reportRetryable(failure)) return done('refused', i + 1);
        const delay = REPORT_RETRY_DELAYS_MS[i];
        if (delay === undefined) return done('undelivered', i + 1);
        await new Promise<void>((resolve) => this.deps.clock.setTimer(delay, resolve));
      }
    }
  }

  private save(): void {
    const store = this.deps.store;
    if (store === undefined) return;
    void this.writes
      .run(() => store.set(NATIVE_SENDS_KEY, { v: 1, owed: [...this.owed.values()] }))
      .catch(() => this.log.write({ level: 'warn', scope: 'bg.send', msg: 'owed native sends not saved', code: 'CG-STORAGE-WRITE' }));
  }
}
