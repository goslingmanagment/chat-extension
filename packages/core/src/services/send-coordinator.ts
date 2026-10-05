// The send coordinator of the background (architecture.md §6.7.4–§6.7.11;
// SP-054, NF-019, NF-022, RB-007, X8-01, X8-07, X8-08, X8-09). A preview
// send is not an AI operation: it is one part of one finished generation,
// sent on one human click through ChatSpace's own queue in the page. The
// background spends the click's `send` token, checks its own conditions,
// lets one attempt at a time through per (hubOrigin, pageId, platform,
// fanRef) and one per generation part and preview revision, writes the
// attempt journal BEFORE asking the hub, and asks `dispatch` exactly once
// per attempt. Only the hub's one-time ticket lets the tab call MAIN. What
// MAIN observed comes back as reports; an ended attempt is reported to the
// hub custody only on proof. An attempt that may have reached the queue and
// is not proven stays `uncertain`: it holds the fan, is never re-sent, and
// only the late linked receipt/echo pair or the hub's audited `resolve`
// ends it. A restart never re-sends: it waits for the tab's report, then
// calls the attempt uncertain; the hub's custody is read (a safe read) to
// learn what positive knowledge exists. Reports come only from the tab
// session that began the attempt (a restored attempt follows the first tab
// that reports it). A custody report is repeated with the same attemptId
// until the hub answers, within the time the hub can still take it; after a
// restart, an ended attempt whose custody still waits is reported again.
// Ended attempts age out of memory and the journal with the results.
//
// One kind of record is not an attempt of ours at all (§6.6): a part the
// person sent with ChatSpace's own Send after «Открыть и вставить», proven
// by the tab (receipt and echo with one id). It is journaled as delivered —
// so the preview shows it «Отправлено», the group's next part is offered,
// and the part is never offered for a second send — and that is all: no
// ticket, no lock, no custody report (`nativeSent`).

import { type CgCode } from '@cg/contracts/errors';
import { type Surface } from '@cg/contracts/features';
import { type Bootstrap, type ClaimBody, type ClaimState, type CustodyState, type HubFacade, type HubFailure, type ResolveHubError } from '@cg/contracts/hub';
import { type PartRef } from '@cg/contracts/ids';
import { BRIDGE_LIMITS, OP_LIMITS } from '@cg/contracts/limits';
import { type OpView } from '@cg/contracts/ops';
import { sendLockKey, type DispatchTicket, type FreshnessCheckpoint, type SendAttemptView, type SendJournalEntry, type SendLockKey } from '@cg/contracts/send';
import { isRetryableEnd } from '@cg/contracts/send-rules';
import { STORAGE_KEYS } from '@cg/contracts/settings';
import { SEND_LIST_MAX, type SendBegin, type SendListItem } from '@cg/contracts/tab-messages';

import { flagUsable, type OpEnvTag, type OpsEnvironment } from '../domain/ops';
import {
  NATIVE_SEND_DOCUMENT,
  PURPOSE_SURFACE,
  REPORT_GRACE_MS,
  SendLockTable,
  applyAttemptInput,
  applyReportedView,
  attemptKeyOf,
  beginCondition,
  custodyBlocks,
  custodyReport,
  dispatchBody,
  holdsLock,
  isNativeSendEntry,
  journalEntryOf,
  journalWithView,
  nativePartOf,
  newAttempt,
  parseJournal,
  partBlock,
  readDispatch,
  reportAccepted,
  reportRetryable,
  restoreAction,
  silenceDeadline,
  type AttemptTrack,
  type FanAttempt,
  type OpForSend,
  type SendGate,
} from '../domain/send';
import { type ActionTokens } from './tokens';
import { NO_LOG, WriteQueue, type Clock, type KeyValueStore, type LogSink, type TabEventSink, type TimerHandle } from './ports';

/** Pauses between repeats of one custody report the hub did not answer (the same attemptId, never a dispatch); the last one repeats. */
export const REPORT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000] as const;

/** The ticket lifetime assumed while no bootstrap is cached. */
export const FALLBACK_TICKET_SEC = 10;

export type BeginResult = { readonly ok: true; readonly ticket: DispatchTicket } | { readonly ok: false; readonly view: SendAttemptView };

/** The page's switches and limits for X8, read from the bootstrap at the click. */
export interface SendPageGate extends Omit<SendGate, 'session' | 'personaDefinitionId' | 'bindingRevision'> {
  readonly flagRevision: number;
  readonly ticketSec: number;
  readonly pageLabel: string | null;
}

/** Reads the X8 switches of a page from the environment (§6.7.11: the hub re-checks the flag on every dispatch). */
export function sendPageGate(bootstrap: Bootstrap | null, pageId: number): SendPageGate {
  if (bootstrap === null) return { previewSend: false, newcomers: false, receiptProfiles: 0, flagRevision: 0, ticketSec: 0, pageLabel: null };
  return {
    previewSend: flagUsable(bootstrap, pageId, 'previewSend'),
    newcomers: flagUsable(bootstrap, pageId, 'newcomers'),
    receiptProfiles: bootstrap.limits.previewSendReceiptProfiles.length,
    flagRevision: bootstrap.configRevision,
    ticketSec: bootstrap.limits.dispatchTicketSec,
    pageLabel: bootstrap.pages.find((page) => page.pageId === pageId)?.pageLabel ?? null,
  };
}

export interface SendCoordinatorDeps {
  readonly clock: Clock;
  readonly hub: Pick<HubFacade, 'claim' | 'claimStatus'>;
  readonly resolve: ResolveHubError;
  readonly tokens: Pick<ActionTokens, 'redeem'>;
  readonly events: TabEventSink;
  /** storage.local (`send.journal`). */
  readonly store: KeyValueStore;
  /** The operation a send comes from (the scheduler). */
  readonly ops: { forSend(opId: string): { readonly view: OpView; readonly checkpoint: FreshnessCheckpoint | null; readonly tag: OpEnvTag } | null };
  readonly environment: () => OpsEnvironment;
  /** This install's id (H-7 `instanceId`). */
  readonly instanceId: string;
  readonly log?: LogSink;
  /** sentObserved: telemetry `sent` via preview, «поприветствован» (R18, R12). */
  readonly onSent?: (fact: { readonly attemptId: string; readonly opId: string; readonly purpose: SendBegin['purpose']; readonly part: number; readonly variant: number; readonly generationRef: string; readonly platformMessageId: string }) => void;
  /** How long an ended attempt is kept (memory and journal); the results' lifetime by default. */
  readonly keepEndedMs?: number;
}

interface Attempt {
  track: AttemptTrack;
  entry: SendJournalEntry | null;
  readonly key: string;
  readonly lockKey: SendLockKey;
  /** The page label is looked up from this on every use: a bootstrap may arrive after a restore. */
  readonly pageId: number;
  readonly fanRef: string;
  readonly purpose: SendBegin['purpose'];
  readonly group: SendBegin['group'];
  readonly partIndex: number;
  readonly opId: string;
  /** The tab session that began it, the only one whose reports count; null — restored, bound to the first that reports. */
  ownerTab: string | null;
  /** `dispatch` went to the hub (or may have: its answer was lost). */
  dispatched: boolean;
  /** A custody report was computed for it (at most one per attempt). */
  reported: boolean;
  /** That report, while the hub has not answered it. */
  owed: ClaimBody | null;
  delivering: boolean;
  /** The ticket's own deadline on the local clock. */
  ticketExpiresAt: number | null;
  silence: TimerHandle | null;
  /** Rebuilt from the journal after a restart. */
  readonly restored: boolean;
  readonly createdAt: number;
  updatedAt: number;
  resolved?: 'sent' | 'not-sent';
}

/**
 * Whether a new click of the same part (same attempt key) may make a new
 * attempt after `prior`: the frozen retryable ends and a hub resolve «not
 * sent». A hold by another unresolved send to the fan (CG-SEND-UNCERTAIN) is
 * not liftable by a click (SEND_HOLD_CODES_WITHOUT_RETRY): only the hub's
 * resolve lifts it, so the click reads the custody (a safe read, never a
 * dispatch) and goes on only when nothing blocks the fan any more.
 */
function mayTryAgain(prior: Attempt): boolean | 'ask-hub' {
  const view = prior.track.view;
  if (prior.resolved !== undefined) return prior.resolved === 'not-sent';
  if (isRetryableEnd(view.state, view.code)) return true;
  return view.state === 'held' && view.code === 'CG-SEND-UNCERTAIN' ? 'ask-hub' : false;
}

function isHubCallError(error: unknown): error is { readonly name: 'HubCallError'; readonly failure: HubFailure; readonly epoch: number } {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'HubCallError' && typeof (error as { failure?: unknown }).failure === 'object';
}

const reportDelay = (i: number): number => REPORT_RETRY_DELAYS_MS[Math.min(i, REPORT_RETRY_DELAYS_MS.length - 1)] ?? 60_000;

export class SendCoordinator {
  private readonly attempts = new Map<string, Attempt>();
  private readonly byKey = new Map<string, string>();
  private readonly locks = new SendLockTable();
  private readonly writes = new WriteQueue();
  private readonly deliveries = new Set<Promise<void>>();
  private readonly lifting = new Map<string, Promise<boolean>>();
  /** Fans whose custody could not be read or reported for want of a page label (no bootstrap yet). */
  private readonly parked = new Set<SendLockKey>();
  private readonly log: LogSink;
  private readonly keepEndedMs: number;

  constructor(private readonly deps: SendCoordinatorDeps) {
    this.log = deps.log ?? NO_LOG;
    this.keepEndedMs = deps.keepEndedMs ?? OP_LIMITS.resultTtlMs;
  }

  // ── begin ───────────────────────────────────────────────────────────────

  /** `send.begin`: journal first, then `dispatch`; the answer is the one-time ticket or the reason to hold. */
  async begin(tabSessionId: string, begin: SendBegin): Promise<BeginResult> {
    const { clock } = this.deps;
    this.sweep(clock.now());
    // X8-01: the same attempt never gets a second ticket.
    const same = this.attempts.get(begin.attemptId);
    if (same !== undefined) return { ok: false, view: same.track.view };
    const key = attemptKeyOf({ generationRef: begin.group.generationRef, variant: begin.group.variant, partIndex: begin.part.index, previewRevision: begin.previewRevision });
    // One generation part and preview revision is one attempt, however many clicks arrive.
    const previous = this.byKey.get(key);
    let prior = previous === undefined ? undefined : this.attempts.get(previous);
    if (prior !== undefined) {
      const again = mayTryAgain(prior);
      if (again === false) return { ok: false, view: prior.track.view };
      if (again === 'ask-hub') {
        const lifted = await this.holdLifted(prior);
        // Another click of this part may have made its attempt meanwhile.
        const current = this.attempts.get(this.byKey.get(key) ?? '');
        if (current !== undefined && current !== prior) return { ok: false, view: current.track.view };
        if (!lifted) return { ok: false, view: prior.track.view };
      }
    }
    const raced = this.attempts.get(begin.attemptId);
    if (raced !== undefined) return { ok: false, view: raced.track.view };
    prior = previous === undefined ? undefined : this.attempts.get(previous);

    const env = this.deps.environment();
    const page = sendPageGate(env.bootstrap, begin.target.binding.pageId);
    const lockKey = sendLockKey({ hubOrigin: begin.target.binding.hubOrigin, pageId: begin.target.binding.pageId, platform: begin.target.binding.platform, fanRef: begin.target.fanRef });
    const now = clock.now();
    const attempt: Attempt = {
      track: applyAttemptInput(newAttempt(begin.attemptId), { type: 'click', cause: begin.cause }).track,
      entry: null,
      key,
      lockKey,
      pageId: begin.target.binding.pageId,
      fanRef: begin.target.fanRef,
      purpose: begin.purpose,
      group: begin.group,
      partIndex: begin.part.index,
      opId: begin.opId,
      ownerTab: tabSessionId,
      dispatched: false,
      reported: false,
      owed: null,
      delivering: false,
      ticketExpiresAt: null,
      silence: null,
      restored: false,
      createdAt: now,
      updatedAt: now,
    };
    this.attempts.set(begin.attemptId, attempt);
    this.byKey.set(key, begin.attemptId);

    // 1 — a trusted click of our own UI (AI-120): the `send` token of the surface.
    const surface: Surface = PURPOSE_SURFACE[begin.purpose];
    if (!this.deps.tokens.redeem({ tabSessionId, kind: 'send', surface, actionToken: begin.cause.actionToken })) {
      // A stale or foreign token says nothing about the part: the next real click may try it.
      if (prior === undefined) this.byKey.delete(key);
      else this.byKey.set(key, prior.track.view.attemptId);
      return this.holdLocal(attempt, 'CG-SEND-PART');
    }

    // 1–4, 14 — the background's own conditions.
    const condition = beginCondition(begin, this.opForSend(begin.opId), this.gateOf(env, page, begin.target.binding.pageId));
    if (condition !== null) return this.holdLocal(attempt, condition);

    // Group rules and the fan lock (one attempt at a time per fan).
    let block = partBlock({ purpose: begin.purpose, group: begin.group, partIndex: begin.part.index }, this.fanAttempts(lockKey, begin.attemptId));
    if (block === 'CG-SEND-UNCERTAIN') {
      await this.reconcileFan(lockKey);
      block = partBlock({ purpose: begin.purpose, group: begin.group, partIndex: begin.part.index }, this.fanAttempts(lockKey, begin.attemptId));
    }
    if (block !== null) return this.holdLocal(attempt, block);
    if (!this.locks.acquire(lockKey, begin.attemptId)) {
      const holder = this.attempts.get(this.locks.holder(lockKey) ?? '');
      return this.holdLocal(attempt, holder?.track.view.state === 'uncertain' ? 'CG-SEND-UNCERTAIN' : 'CG-SEND-BUSY');
    }

    // The journal record BEFORE dispatch: an unwritten record means no queue call.
    attempt.entry = journalEntryOf(begin, clock.now());
    try {
      await this.saveJournal();
    } catch {
      attempt.entry = null;
      this.locks.release(lockKey, begin.attemptId);
      this.log.write({ level: 'error', scope: 'bg.send', msg: 'send journal write failed', code: 'CG-STORAGE-WRITE', ctx: { attemptId: begin.attemptId } });
      return this.holdLocal(attempt, 'CG-STORAGE-WRITE');
    }
    if (page.pageLabel === null) return this.holdJournaled(attempt, 'CG-BINDING-NOT-GRANTED');

    // Exactly one dispatch per attempt; never repeated.
    attempt.dispatched = true;
    const body = dispatchBody({
      attemptId: begin.attemptId,
      instanceId: this.deps.instanceId,
      purpose: begin.purpose,
      group: begin.group,
      partIndex: begin.part.index,
      textRevision: begin.textRevision,
      flagRevision: page.flagRevision,
      ...(begin.leaseToken === undefined ? {} : { leaseToken: begin.leaseToken }),
    });
    let state: ClaimState;
    try {
      state = await this.deps.hub.claim({ pageLabel: page.pageLabel, fanRef: begin.target.fanRef, body });
    } catch (error) {
      return this.dispatchFailed(attempt, error);
    }
    if (this.attempts.get(begin.attemptId) !== attempt || attempt.track.view.state !== 'preparing') return { ok: false, view: attempt.track.view };
    const reading = readDispatch(state, begin.attemptId, begin.part.index, clock.now());
    if (reading.kind === 'no-ticket') {
      attempt.dispatched = reading.opened;
      const held = this.holdJournaled(attempt, reading.code);
      // A custody of one of our own ended attempts may be what blocks the fan: its report is owed again.
      if (reading.code === 'CG-SEND-UNCERTAIN') this.reconcileWith(lockKey, state);
      return held;
    }
    attempt.ticketExpiresAt = reading.ticket.expiresAt;
    this.armSilence(attempt);
    this.log.write({ level: 'info', scope: 'bg.send', msg: 'dispatch ticket issued', fields: { purpose: begin.purpose, part: begin.part.index }, ctx: { attemptId: begin.attemptId, opId: begin.opId } });
    return { ok: true, ticket: reading.ticket };
  }

  private opForSend(opId: string): OpForSend | null {
    const op = this.deps.ops.forSend(opId);
    if (op === null) return null;
    const { view, tag } = op;
    return {
      opId: view.opId,
      feature: view.feature,
      surface: view.surface,
      state: view.state,
      target: view.target,
      generationRef: view.generationRef ?? null,
      result: view.result ?? null,
      checkpoint: op.checkpoint ?? undefined,
      servedContext: view.servedContext,
      stale: view.stale !== undefined,
      personaDefinitionId: tag.personaDefinitionId,
      session: { hubOrigin: tag.hubOrigin, userId: tag.userId, epoch: tag.signInEpoch },
    };
  }

  private gateOf(env: OpsEnvironment, page: SendPageGate, pageId: number): SendGate {
    return {
      session: env.session === null ? null : { hubOrigin: env.session.hubOrigin, userId: env.session.userId, epoch: env.session.epoch },
      personaDefinitionId: env.persona(pageId)?.definitionId ?? null,
      bindingRevision: env.bootstrap?.pages.find((page) => page.pageId === pageId)?.bindingRevision ?? null,
      previewSend: page.previewSend,
      newcomers: page.newcomers,
      receiptProfiles: page.receiptProfiles,
    };
  }

  /** The page label of the current bootstrap; null — none cached yet, or the page is not granted. */
  private pageLabelOf(pageId: number): string | null {
    return sendPageGate(this.deps.environment().bootstrap, pageId).pageLabel;
  }

  private ticketSecOf(pageId: number): number {
    return sendPageGate(this.deps.environment().bootstrap, pageId).ticketSec || FALLBACK_TICKET_SEC;
  }

  /** A refusal before the journal and the hub: nothing was dispatched, nothing to report. */
  private holdLocal(attempt: Attempt, code: CgCode): BeginResult {
    attempt.track = applyAttemptInput(attempt.track, { type: 'held', code }).track;
    attempt.updatedAt = this.deps.clock.now();
    this.log.write({ level: 'info', scope: 'bg.send', msg: 'send held before dispatch', code, ctx: { attemptId: attempt.track.view.attemptId } });
    this.emit(attempt);
    return { ok: false, view: attempt.track.view };
  }

  /** A refusal after the journal: the record ends `held`, the lock goes, the custody hears `failed: not_enqueued` if it opened. */
  private holdJournaled(attempt: Attempt, code: CgCode): BeginResult {
    this.apply(attempt, { attemptId: attempt.track.view.attemptId, state: 'held', code });
    return { ok: false, view: attempt.track.view };
  }

  private dispatchFailed(attempt: Attempt, error: unknown): BeginResult {
    const failure: HubFailure = isHubCallError(error) ? error.failure : { kind: 'transport', failure: 'network' };
    const env = this.deps.environment();
    const resolution = this.deps.resolve(failure, {
      route: 'clientFanClaim',
      currentSignIn: !isHubCallError(error) || env.session?.epoch === error.epoch,
      pageGranted: true,
      beforeFirstFrame: false,
      claimAction: 'dispatch',
      fanLookup: false,
      now: this.deps.clock.now(),
    });
    // An HTTP refusal opened no custody; a transport failure may have (the answer was lost): report `not_enqueued`.
    attempt.dispatched = failure.kind === 'transport';
    const code: CgCode = resolution.disposition === 'read-status' ? 'CG-SEND-PART' : (resolution.code ?? 'CG-HUB-UNKNOWN');
    this.log.write({ level: 'warn', scope: 'bg.send', msg: 'dispatch failed', code, fields: { kind: failure.kind }, ctx: { attemptId: attempt.track.view.attemptId } });
    const held = this.holdJournaled(attempt, code);
    // The fan is held by a custody: when it is one of our ended attempts, its report is owed again.
    if (code === 'CG-SEND-UNCERTAIN') void this.reconcileFan(attempt.lockKey);
    return held;
  }

  /** Whether the hub says nothing blocks the fan any more (a hold by another unresolved send may then be clicked again). */
  private holdLifted(prior: Attempt): Promise<boolean> {
    const running = this.lifting.get(prior.key);
    if (running !== undefined) return running;
    const work = (async (): Promise<boolean> => {
      const state = await this.readCustody(prior.lockKey, prior.pageId, prior.fanRef);
      if (state === null) return false;
      this.reconcileWith(prior.lockKey, state);
      const block = partBlock({ purpose: prior.purpose, group: prior.group, partIndex: prior.partIndex }, this.fanAttempts(prior.lockKey, prior.track.view.attemptId));
      if (block === 'CG-SEND-UNCERTAIN') return false;
      return state.custody === null || !custodyBlocks(state.custody.state);
    })().finally(() => this.lifting.delete(prior.key));
    this.lifting.set(prior.key, work);
    return work;
  }

  // ── reports ─────────────────────────────────────────────────────────────

  /**
   * `send.report` from `tabSessionId`: what MAIN observed. Only the tab
   * session that began the attempt is heard (§6.7.7 п. 6: a release needs
   * positive knowledge from the live document that holds the attempt); a
   * restored attempt follows the first tab that reports it. Journal, custody
   * report on proof, `send.state` to the tabs.
   */
  async report(tabSessionId: string, view: SendAttemptView, pendingId?: string): Promise<boolean> {
    const attempt = this.attempts.get(view.attemptId);
    if (attempt === undefined || attempt.entry === null) return false;
    if (attempt.ownerTab === null && attempt.restored) attempt.ownerTab = tabSessionId;
    if (attempt.ownerTab !== tabSessionId) {
      this.log.write({ level: 'warn', scope: 'bg.send', msg: 'send report from another tab session ignored', fields: { state: view.state }, ctx: { attemptId: view.attemptId, tabSessionId } });
      return false;
    }
    const changed = this.apply(attempt, view, pendingId);
    await this.writes.idle();
    return changed;
  }

  /**
   * §6.6: the person pressed ChatSpace's own Send on a part of a preview's
   * or a «Новые» card's result that «Открыть и вставить» (or the dock, for
   * the parts that followed) put into the composer, and the tab proved it by
   * the receipt and the echo with one id (`op.reportSent`). The part is
   * delivered: it is journaled as an ended record of its group, so every tab
   * reads it with `send.list` — the preview shows it «Отправлено» and offers
   * the next part — and the same part is never offered for a second send.
   *
   * A record of what the person did, never a send: nothing is dispatched, no
   * lock is taken, no custody report is owed (the hub hears of it through
   * the registrar's `registerNativeSend`, §8.5), no `sent` of a preview send
   * is told. A repeat of the report, or a part already known delivered,
   * changes nothing. null — not a part of a finished preview or «Новые»
   * result.
   */
  nativeSent(fact: { readonly attemptId: string; readonly view: OpView; readonly part: PartRef; readonly platformMessageId: string }): SendAttemptView | null {
    const { view, platformMessageId } = fact;
    const sent = nativePartOf(view, fact.part);
    if (sent === null) return null;
    const now = this.deps.clock.now();
    this.sweep(now);
    const binding = view.target.binding;
    const lockKey = sendLockKey({ hubOrigin: binding.hubOrigin, pageId: binding.pageId, platform: binding.platform, fanRef: view.target.fanRef });
    const samePart = (attempt: Attempt): boolean =>
      attempt.lockKey === lockKey && attempt.group.generationRef === sent.group.generationRef && attempt.group.variant === sent.group.variant && attempt.partIndex === sent.partIndex;
    // The same send told again (the tab repeats a report a lost port never acknowledged), or a part an attempt of ours already delivered.
    const known = [...this.attempts.values()].find((attempt) => samePart(attempt) && (attempt.resolved === 'sent' || (attempt.resolved === undefined && attempt.track.view.state === 'sentObserved')));
    if (known !== undefined) return known.track.view;
    if (this.attempts.has(fact.attemptId)) return null;
    const sentView: SendAttemptView = { attemptId: fact.attemptId, state: 'sentObserved', platformMessageId };
    const key = attemptKeyOf({ generationRef: sent.group.generationRef, variant: sent.group.variant, partIndex: sent.partIndex, previewRevision: 0 });
    const attempt: Attempt = {
      track: { view: sentView, receiptMessageId: platformMessageId, echoes: [], pendingId: null },
      entry: {
        attemptId: fact.attemptId,
        hubOrigin: binding.hubOrigin,
        pageId: binding.pageId,
        platform: binding.platform,
        fanRef: view.target.fanRef,
        hostAccountId: view.target.chat.hostAccountId,
        purpose: sent.purpose,
        opId: view.opId,
        group: sent.group,
        partIndex: sent.partIndex,
        previewRevision: 0,
        documentEpoch: NATIVE_SEND_DOCUMENT,
        state: 'sentObserved',
        platformMessageId,
        createdAt: now,
        updatedAt: now,
      },
      key,
      lockKey,
      pageId: binding.pageId,
      fanRef: view.target.fanRef,
      purpose: sent.purpose,
      group: sent.group,
      partIndex: sent.partIndex,
      opId: view.opId,
      ownerTab: null,
      dispatched: false,
      // Nothing is owed to a custody that was never opened.
      reported: true,
      owed: null,
      delivering: false,
      ticketExpiresAt: null,
      silence: null,
      restored: false,
      createdAt: now,
      updatedAt: now,
    };
    this.attempts.set(fact.attemptId, attempt);
    // A click of «Отправить» on this very part finds it delivered; an attempt of ours for the same key keeps its place.
    if (!this.byKey.has(key)) this.byKey.set(key, fact.attemptId);
    void this.saveJournal().catch(() => {
      this.log.write({ level: 'error', scope: 'bg.send', msg: 'send journal write failed', code: 'CG-STORAGE-WRITE', ctx: { attemptId: fact.attemptId } });
    });
    this.log.write({ level: 'info', scope: 'bg.send', msg: 'human send recorded', fields: { purpose: sent.purpose, part: sent.partIndex }, ctx: { attemptId: fact.attemptId, opId: view.opId } });
    this.emit(attempt);
    return sentView;
  }

  /** `send.status`. */
  status(attemptId: string): SendAttemptView | null {
    return this.attempts.get(attemptId)?.track.view ?? null;
  }

  /**
   * `send.list`: what is known of the sends to one fan — what a tab that
   * lost its own tracking (a reload) holds the fan by. Journaled attempts,
   * and those the hub resolved for as long as they are remembered (with the
   * resolution: they no longer hold the fan). Attempts that still hold the
   * fan first, then the newest; at most `max`. An attempt that never reached
   * the journal reached nothing and is not listed.
   */
  attemptsOf(lockKey: SendLockKey, max: number = SEND_LIST_MAX): { readonly attempts: SendListItem[]; readonly truncated: boolean } {
    const holds = (attempt: Attempt): boolean => attempt.resolved === undefined && holdsLock(attempt.track.view.state);
    const known = [...this.attempts.values()].filter((attempt) => attempt.lockKey === lockKey && (attempt.entry !== null || attempt.resolved !== undefined));
    known.sort((a, b) => Number(holds(b)) - Number(holds(a)) || b.updatedAt - a.updatedAt);
    return {
      attempts: known.slice(0, max).map((attempt) => ({
        opId: attempt.opId,
        purpose: attempt.purpose,
        group: attempt.group,
        partIndex: attempt.partIndex,
        view: attempt.track.view,
        updatedAt: attempt.updatedAt,
        ...(attempt.resolved === undefined ? {} : { resolved: attempt.resolved }),
      })),
      truncated: known.length > max,
    };
  }

  /** Open and uncertain attempts (diagnostics `sends`). */
  counts(): { readonly open: number; readonly uncertain: number } {
    let open = 0;
    let uncertain = 0;
    for (const attempt of this.attempts.values()) {
      if (attempt.resolved !== undefined) continue;
      if (attempt.track.view.state === 'uncertain') uncertain += 1;
      else if (holdsLock(attempt.track.view.state)) open += 1;
    }
    return { open, uncertain };
  }

  /** Attempts held in memory (diagnostics; ended ones age out with the results). */
  get size(): number {
    return this.attempts.size;
  }

  /** Resolves when every journal write and custody report so far settled. */
  async idle(): Promise<void> {
    await this.writes.idle();
    while (this.deliveries.size > 0) await Promise.all([...this.deliveries]);
    await this.writes.idle();
  }

  private apply(attempt: Attempt, view: SendAttemptView, pendingId?: string): boolean {
    const step = applyReportedView(attempt.track, view, pendingId);
    if (!step.changed) return false;
    this.commit(attempt, step.track);
    return true;
  }

  /** The one place an attempt's state moves: journal, lock, timer, custody, events. */
  private commit(attempt: Attempt, track: AttemptTrack): void {
    const before = attempt.track.view.state;
    const now = this.deps.clock.now();
    attempt.track = track;
    attempt.updatedAt = now;
    const state = track.view.state;
    if (attempt.entry !== null) {
      attempt.entry = journalWithView(attempt.entry, track.view, now, track.pendingId);
      void this.saveJournal().catch(() => {
        this.log.write({ level: 'error', scope: 'bg.send', msg: 'send journal write failed', code: 'CG-STORAGE-WRITE', ctx: { attemptId: track.view.attemptId } });
      });
    }
    if (!holdsLock(state)) this.locks.release(attempt.lockKey, track.view.attemptId);
    if (state !== before) this.armSilence(attempt);
    this.log.write({
      level: state === 'uncertain' || state === 'rejected' ? 'warn' : 'info',
      scope: 'bg.send',
      msg: 'attempt moved',
      ...(track.view.code === undefined ? {} : { code: track.view.code }),
      fields: { from: before, to: state },
      ctx: { attemptId: track.view.attemptId, opId: attempt.opId },
    });
    this.emit(attempt);
    this.reportCustody(attempt);
    if (state === 'sentObserved' && before !== 'sentObserved' && track.view.platformMessageId !== undefined) {
      this.deps.onSent?.({
        attemptId: track.view.attemptId,
        opId: attempt.opId,
        purpose: attempt.purpose,
        part: attempt.partIndex,
        variant: attempt.group.variant,
        generationRef: attempt.group.generationRef,
        platformMessageId: track.view.platformMessageId,
      });
    }
  }

  /** At most one custody report per attempt, computed when it ends on proof (SEND_CUSTODY_REPORTS), then sent. */
  private reportCustody(attempt: Attempt): void {
    if (this.owe(attempt)) this.deliver(attempt);
  }

  /** Computes the attempt's one custody report; true when a report is now owed. */
  private owe(attempt: Attempt): boolean {
    if (attempt.reported) return false;
    const view = attempt.track.view;
    const body = custodyReport({
      attemptId: view.attemptId,
      instanceId: this.deps.instanceId,
      state: view.state,
      dispatched: attempt.dispatched,
      ...(view.httpStatus === undefined ? {} : { httpStatus: view.httpStatus }),
      ...(view.platformMessageId === undefined ? {} : { platformMessageId: view.platformMessageId }),
    });
    if (body === null) return false;
    attempt.reported = true;
    attempt.owed = body;
    return true;
  }

  /** Until when the hub can still take the report: `failed` within the ticket's life, `sent` while the attempt is kept. */
  private reportDeadline(attempt: Attempt, body: ClaimBody): number {
    if (body.action === 'sent') return attempt.createdAt + this.keepEndedMs;
    const ticketEnd = attempt.ticketExpiresAt ?? attempt.createdAt + this.ticketSecOf(attempt.pageId) * 1000;
    return ticketEnd + BRIDGE_LIMITS.callTimeoutMs + REPORT_GRACE_MS;
  }

  private deliver(attempt: Attempt): void {
    if (attempt.delivering || attempt.owed === null) return;
    attempt.delivering = true;
    const run = this.sendReport(attempt).finally(() => {
      attempt.delivering = false;
      this.deliveries.delete(run);
    });
    this.deliveries.add(run);
  }

  /**
   * One owed report: sent at once, repeated with the same attemptId while the
   * hub gives no answer (transport, 429, 5xx), until the hub could no longer
   * take it. Any other answer ends it. Without a page label the report waits
   * for the bootstrap (bootstrapChanged).
   */
  private async sendReport(attempt: Attempt): Promise<void> {
    for (let i = 0; ; i += 1) {
      const body = attempt.owed;
      if (body === null) return;
      const pageLabel = this.pageLabelOf(attempt.pageId);
      if (pageLabel === null) {
        this.parked.add(attempt.lockKey);
        return;
      }
      try {
        await this.deps.hub.claim({ pageLabel, fanRef: attempt.fanRef, body });
        attempt.owed = null;
        return;
      } catch (error) {
        const failure: HubFailure = isHubCallError(error) ? error.failure : { kind: 'transport', failure: 'network' };
        if (!reportRetryable(failure)) {
          // The hub answered (custody not ours, already ended): nothing more to say.
          attempt.owed = null;
          this.log.write({ level: 'warn', scope: 'bg.send', msg: 'custody report refused', fields: { action: body.action, kind: failure.kind }, ctx: { attemptId: attempt.track.view.attemptId } });
          return;
        }
        const delay = reportDelay(i);
        if (this.deps.clock.now() + delay > this.reportDeadline(attempt, body)) {
          this.log.write({ level: 'warn', scope: 'bg.send', msg: 'custody report not delivered', fields: { action: body.action, tries: i + 1 }, ctx: { attemptId: attempt.track.view.attemptId } });
          return;
        }
        await new Promise<void>((resolve) => this.deps.clock.setTimer(delay, resolve));
      }
    }
  }

  /** No report within the deadline after a possible queue call: uncertain (never re-sent). */
  private armSilence(attempt: Attempt): void {
    if (attempt.silence !== null) this.deps.clock.clearTimer(attempt.silence);
    attempt.silence = null;
    if (attempt.entry === null || !attempt.dispatched) return;
    const now = this.deps.clock.now();
    const state = attempt.track.view.state;
    // With a ticket in hand, its own deadline counts (a hub ticket may outlive the bootstrap's figure).
    const until =
      state === 'preparing' && attempt.ticketExpiresAt !== null
        ? attempt.ticketExpiresAt + BRIDGE_LIMITS.callTimeoutMs + REPORT_GRACE_MS
        : silenceDeadline({ state, updatedAt: now }, this.ticketSecOf(attempt.pageId));
    if (until === null) return;
    attempt.silence = this.deps.clock.setTimer(Math.max(0, until - now), () => {
      attempt.silence = null;
      const step = applyAttemptInput(attempt.track, { type: 'lost', code: 'CG-SEND-UNCERTAIN' });
      if (step.changed) this.commit(attempt, step.track);
    });
  }

  private emit(attempt: Attempt): void {
    this.deps.events.emit(null, 'send.state', { view: attempt.track.view });
  }

  private fanAttempts(lockKey: SendLockKey, except: string): FanAttempt[] {
    const out: FanAttempt[] = [];
    for (const attempt of this.attempts.values()) {
      if (attempt.lockKey !== lockKey || attempt.track.view.attemptId === except) continue;
      out.push({
        attemptId: attempt.track.view.attemptId,
        purpose: attempt.purpose,
        group: attempt.group,
        partIndex: attempt.partIndex,
        state: attempt.track.view.state,
        ...(attempt.resolved === undefined ? {} : { resolved: attempt.resolved }),
      });
    }
    return out;
  }

  // ── restore and reconciliation ──────────────────────────────────────────

  /**
   * After a restart (§6.7.7 п. 6, §7 «Фон и выгрузка»): uncertain records
   * stay until resolved; ended ones stay while their results could still be
   * sent from; an attempt that may have reached the queue waits for the
   * tab's report until its deadline and then turns uncertain. Nothing is
   * sent again. The hub's custody is read for each fan with an open record,
   * and for each fan whose ended record may still owe its report (the hub
   * may never have heard it before the unload).
   */
  async restore(): Promise<{ readonly kept: number; readonly uncertain: number; readonly dropped: number }> {
    const now = this.deps.clock.now();
    const raw = await this.deps.store.get(STORAGE_KEYS.sendJournal);
    const { entries, dropped } = parseJournal(raw);
    let uncertain = 0;
    let removed = dropped;
    for (const entry of entries) {
      if (this.attempts.has(entry.attemptId)) continue;
      const ticketSec = this.ticketSecOf(entry.pageId);
      const action = restoreAction(entry, now, ticketSec, this.keepEndedMs);
      if (action.kind === 'drop') {
        removed += 1;
        continue;
      }
      const view: SendAttemptView = {
        attemptId: entry.attemptId,
        state: entry.state,
        ...(entry.code === undefined ? {} : { code: entry.code }),
        ...(entry.platformMessageId === undefined ? {} : { platformMessageId: entry.platformMessageId }),
      };
      const attempt: Attempt = {
        track: { view, receiptMessageId: entry.platformMessageId ?? null, echoes: [], pendingId: entry.pendingId ?? null },
        entry,
        key: attemptKeyOf({ generationRef: entry.group.generationRef, variant: entry.group.variant, partIndex: entry.partIndex, previewRevision: entry.previewRevision }),
        lockKey: sendLockKey(entry),
        pageId: entry.pageId,
        fanRef: entry.fanRef,
        purpose: entry.purpose,
        group: entry.group,
        partIndex: entry.partIndex,
        opId: entry.opId,
        ownerTab: null,
        // A restored open record may have dispatched; whether an ended one did, only the hub's custody tells.
        dispatched: holdsLock(entry.state),
        // A part the person sent from the composer never had a custody: nothing to report, nothing to read.
        reported: isNativeSendEntry(entry),
        owed: null,
        delivering: false,
        ticketExpiresAt: null,
        silence: null,
        restored: true,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      };
      this.attempts.set(entry.attemptId, attempt);
      if (!isNativeSendEntry(entry) || !this.byKey.has(attempt.key)) this.byKey.set(attempt.key, entry.attemptId);
      if (holdsLock(entry.state)) this.locks.acquire(attempt.lockKey, entry.attemptId);
      if (action.kind === 'uncertain') {
        this.commit(attempt, applyAttemptInput(attempt.track, { type: 'lost', code: 'CG-SEND-UNCERTAIN' }).track);
        uncertain += 1;
      } else if (action.kind === 'await') {
        attempt.silence = this.deps.clock.setTimer(Math.max(0, action.until - now), () => {
          attempt.silence = null;
          const step = applyAttemptInput(attempt.track, { type: 'lost', code: 'CG-SEND-UNCERTAIN' });
          if (step.changed) this.commit(attempt, step.track);
        });
      } else if (entry.state === 'uncertain') uncertain += 1;
    }
    if (removed > 0) await this.saveJournal().catch(() => undefined);
    const fans = new Set<SendLockKey>();
    for (const attempt of this.attempts.values()) if (this.needsCustodyRead(attempt, now)) fans.add(attempt.lockKey);
    for (const fan of fans) await this.reconcileFan(fan);
    this.log.write({ level: 'info', scope: 'bg.send', msg: 'send journal restored', fields: { kept: this.attempts.size, uncertain, dropped: removed } });
    return { kept: this.attempts.size, uncertain, dropped: removed };
  }

  /**
   * `bootstrap.changed`: fans that waited for a page label are read again and
   * their owed reports go out (a journal restored before the first bootstrap).
   */
  async bootstrapChanged(): Promise<void> {
    const fans = [...this.parked];
    this.parked.clear();
    for (const fan of fans) {
      await this.reconcileFan(fan);
      for (const attempt of this.attempts.values()) if (attempt.lockKey === fan) this.deliver(attempt);
    }
  }

  /** An open record, or an ended one whose report the hub may still be waiting for. */
  private needsCustodyRead(attempt: Attempt, now: number): boolean {
    if (attempt.resolved !== undefined) return false;
    const state = attempt.track.view.state;
    if (holdsLock(state)) return true;
    if (attempt.owed !== null) return !attempt.delivering;
    if (!attempt.restored || attempt.reported) return false;
    if (state === 'sentObserved') return attempt.track.view.platformMessageId !== undefined;
    if (state === 'held' || state === 'notEnqueued') return now < attempt.createdAt + this.ticketSecOf(attempt.pageId) * 1000 + BRIDGE_LIMITS.callTimeoutMs + REPORT_GRACE_MS;
    return false;
  }

  private async readCustody(lockKey: SendLockKey, pageId: number, fanRef: string): Promise<ClaimState | null> {
    const pageLabel = this.pageLabelOf(pageId);
    if (pageLabel === null) {
      this.parked.add(lockKey);
      return null;
    }
    try {
      return await this.deps.hub.claimStatus(pageLabel, fanRef);
    } catch {
      return null;
    }
  }

  /**
   * Reads the hub custody of a fan (a safe read, never a ticket) and applies
   * only positive knowledge (reconcileWith).
   */
  async reconcileFan(lockKey: SendLockKey): Promise<void> {
    const now = this.deps.clock.now();
    const first = [...this.attempts.values()].find((attempt) => attempt.lockKey === lockKey && this.needsCustodyRead(attempt, now));
    if (first === undefined) return;
    const state = await this.readCustody(lockKey, first.pageId, first.fanRef);
    if (state !== null) this.reconcileWith(lockKey, state);
  }

  /**
   * What the custody says about our attempts to this fan: no custody of a
   * restored `preparing` attempt means its dispatch never opened one, so no
   * ticket existed and MAIN was never called (held, and the hub hears
   * `failed: not_enqueued` in case a late dispatch lands); a resolve or a
   * final custody ends an open attempt; a custody of one of our ended
   * attempts that still waits for its report gets that report again.
   */
  private reconcileWith(lockKey: SendLockKey, state: ClaimState): void {
    const custody = state.custody;
    for (const attempt of [...this.attempts.values()]) {
      if (attempt.lockKey !== lockKey || attempt.resolved !== undefined) continue;
      const view = attempt.track.view;
      const ours = custody !== null && custody.attemptId === view.attemptId ? custody : null;
      if (!holdsLock(view.state)) {
        if (ours !== null) this.repairReport(attempt, ours.state);
        continue;
      }
      if (ours === null) {
        // Only a restored record: a live one may still be waiting for its dispatch answer.
        if (attempt.restored && view.state === 'preparing') this.commit(attempt, applyAttemptInput(attempt.track, { type: 'held', code: 'CG-RUNTIME-RELOADED' }).track);
        continue;
      }
      if (ours.state === 'resolved-sent' || ours.state === 'resolved-not-sent' || ours.state === 'sent' || ours.state === 'failed') {
        attempt.resolved = ours.state === 'resolved-not-sent' || ours.state === 'failed' ? 'not-sent' : 'sent';
        if (attempt.silence !== null) this.deps.clock.clearTimer(attempt.silence);
        attempt.silence = null;
        attempt.updatedAt = this.deps.clock.now();
        this.locks.release(attempt.lockKey, view.attemptId);
        attempt.entry = null;
        void this.saveJournal().catch(() => undefined);
        this.log.write({ level: 'info', scope: 'bg.send', msg: 'attempt resolved by the hub', fields: { custody: ours.state }, ctx: { attemptId: view.attemptId } });
        this.emit(attempt);
      }
    }
  }

  /** An ended attempt whose custody still waits: the report it owes goes (again), when the hub can still take it. */
  private repairReport(attempt: Attempt, custody: CustodyState): void {
    if (!custodyBlocks(custody)) {
      attempt.owed = null;
      return;
    }
    if (attempt.owed === null) {
      // The hub holds a custody of exactly this attempt: its dispatch opened one.
      attempt.dispatched = true;
      if (!this.owe(attempt) || attempt.owed === null) return;
    }
    if (!reportAccepted(attempt.owed, custody)) {
      this.log.write({ level: 'warn', scope: 'bg.send', msg: 'custody report too late', fields: { action: attempt.owed.action, custody }, ctx: { attemptId: attempt.track.view.attemptId } });
      attempt.owed = null;
      return;
    }
    this.log.write({ level: 'info', scope: 'bg.send', msg: 'custody report owed again', fields: { action: attempt.owed.action, custody }, ctx: { attemptId: attempt.track.view.attemptId } });
    this.deliver(attempt);
  }

  /** Ended attempts older than the results go from memory and the journal (uncertain and open ones stay). */
  private sweep(now: number): void {
    let journal = false;
    for (const [id, attempt] of this.attempts) {
      if (holdsLock(attempt.track.view.state) && attempt.resolved === undefined) continue;
      if (attempt.delivering || now - attempt.updatedAt < this.keepEndedMs) continue;
      if (attempt.silence !== null) this.deps.clock.clearTimer(attempt.silence);
      this.attempts.delete(id);
      if (this.byKey.get(attempt.key) === id) this.byKey.delete(attempt.key);
      if (attempt.entry !== null) journal = true;
    }
    if (journal) void this.saveJournal().catch(() => undefined);
  }

  private async saveJournal(): Promise<void> {
    const entries = [...this.attempts.values()].flatMap((attempt) => (attempt.entry === null ? [] : [attempt.entry]));
    await this.writes.run(() => this.deps.store.set(STORAGE_KEYS.sendJournal, entries));
  }
}
