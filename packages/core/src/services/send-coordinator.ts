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
// learn what positive knowledge exists.

import { type CgCode } from '@cg/contracts/errors';
import { type Surface } from '@cg/contracts/features';
import { type Bootstrap, type ClaimBody, type ClaimState, type HubFacade, type HubFailure, type ResolveHubError } from '@cg/contracts/hub';
import { type OpView } from '@cg/contracts/ops';
import { sendLockKey, type DispatchTicket, type FreshnessCheckpoint, type SendAttemptView, type SendJournalEntry, type SendLockKey } from '@cg/contracts/send';
import { isRetryableEnd } from '@cg/contracts/send-rules';
import { STORAGE_KEYS } from '@cg/contracts/settings';
import { type SendBegin } from '@cg/contracts/tab-messages';

import { flagUsable, type OpEnvTag, type OpsEnvironment } from '../domain/ops';
import {
  PURPOSE_SURFACE,
  SendLockTable,
  applyAttemptInput,
  applyReportedView,
  attemptKeyOf,
  beginCondition,
  custodyReport,
  dispatchBody,
  holdsLock,
  journalEntryOf,
  journalWithView,
  newAttempt,
  parseJournal,
  partBlock,
  readDispatch,
  restoreAction,
  silenceDeadline,
  type AttemptTrack,
  type FanAttempt,
  type OpForSend,
  type SendGate,
} from '../domain/send';
import { type ActionTokens } from './tokens';
import { NO_LOG, WriteQueue, type Clock, type KeyValueStore, type LogSink, type TabEventSink, type TimerHandle } from './ports';

/** Pauses between repeats of one custody report that failed in transport (the same attemptId, never a dispatch). */
export const REPORT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

export type BeginResult = { readonly ok: true; readonly ticket: DispatchTicket } | { readonly ok: false; readonly view: SendAttemptView };

/** The page's switches and limits for X8, read from the bootstrap at the click. */
export interface SendPageGate extends Omit<SendGate, 'session' | 'personaDefinitionId'> {
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
}

interface Attempt {
  track: AttemptTrack;
  entry: SendJournalEntry | null;
  readonly key: string;
  readonly lockKey: SendLockKey;
  readonly pageLabel: string | null;
  readonly fanRef: string;
  readonly purpose: SendBegin['purpose'];
  readonly group: SendBegin['group'];
  readonly partIndex: number;
  readonly opId: string;
  /** `dispatch` went to the hub (or may have: its answer was lost). */
  dispatched: boolean;
  reported: boolean;
  ticketSec: number;
  ticketExpiresAt: number | null;
  silence: TimerHandle | null;
  /** Rebuilt from the journal after a restart. */
  readonly restored: boolean;
  resolved?: 'sent' | 'not-sent';
}

function isHubCallError(error: unknown): error is { readonly name: 'HubCallError'; readonly failure: HubFailure; readonly epoch: number } {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'HubCallError' && typeof (error as { failure?: unknown }).failure === 'object';
}

export class SendCoordinator {
  private readonly attempts = new Map<string, Attempt>();
  private readonly byKey = new Map<string, string>();
  private readonly locks = new SendLockTable();
  private readonly writes = new WriteQueue();
  private readonly reports = new WriteQueue();
  private readonly log: LogSink;

  constructor(private readonly deps: SendCoordinatorDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  // ── begin ───────────────────────────────────────────────────────────────

  /** `send.begin`: journal first, then `dispatch`; the answer is the one-time ticket or the reason to hold. */
  async begin(tabSessionId: string, begin: SendBegin): Promise<BeginResult> {
    const { clock } = this.deps;
    // X8-01: the same attempt never gets a second ticket.
    const same = this.attempts.get(begin.attemptId);
    if (same !== undefined) return { ok: false, view: same.track.view };
    const key = attemptKeyOf({ generationRef: begin.group.generationRef, variant: begin.group.variant, partIndex: begin.part.index, previewRevision: begin.previewRevision });
    // One generation part and preview revision is one attempt, however many clicks arrive.
    const previous = this.byKey.get(key);
    const prior = previous === undefined ? undefined : this.attempts.get(previous);
    if (prior !== undefined && !isRetryableEnd(prior.track.view.state, prior.track.view.code)) return { ok: false, view: prior.track.view };

    const env = this.deps.environment();
    const page = sendPageGate(env.bootstrap, begin.target.binding.pageId);
    const lockKey = sendLockKey({ hubOrigin: begin.target.binding.hubOrigin, pageId: begin.target.binding.pageId, platform: begin.target.binding.platform, fanRef: begin.target.fanRef });
    const attempt: Attempt = {
      track: applyAttemptInput(newAttempt(begin.attemptId), { type: 'click', cause: begin.cause }).track,
      entry: null,
      key,
      lockKey,
      pageLabel: page.pageLabel,
      fanRef: begin.target.fanRef,
      purpose: begin.purpose,
      group: begin.group,
      partIndex: begin.part.index,
      opId: begin.opId,
      dispatched: false,
      reported: false,
      ticketSec: page.ticketSec,
      ticketExpiresAt: null,
      silence: null,
      restored: false,
    };
    this.attempts.set(begin.attemptId, attempt);
    this.byKey.set(key, begin.attemptId);

    // 1 — a trusted click of our own UI (AI-120): the `send` token of the surface.
    const surface: Surface = PURPOSE_SURFACE[begin.purpose];
    if (!this.deps.tokens.redeem({ tabSessionId, kind: 'send', surface, actionToken: begin.cause.actionToken })) return this.holdLocal(attempt, 'CG-SEND-PART');

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
      return this.holdJournaled(attempt, reading.code);
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
      previewSend: page.previewSend,
      newcomers: page.newcomers,
      receiptProfiles: page.receiptProfiles,
    };
  }

  /** A refusal before the journal and the hub: nothing was dispatched, nothing to report. */
  private holdLocal(attempt: Attempt, code: CgCode): BeginResult {
    attempt.track = applyAttemptInput(attempt.track, { type: 'held', code }).track;
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
    return this.holdJournaled(attempt, code);
  }

  // ── reports ─────────────────────────────────────────────────────────────

  /** `send.report`: what MAIN observed. Journal, custody report on proof, `send.state` to the tabs. */
  async report(view: SendAttemptView, pendingId?: string): Promise<boolean> {
    const attempt = this.attempts.get(view.attemptId);
    if (attempt === undefined || attempt.entry === null) return false;
    const changed = this.apply(attempt, view, pendingId);
    await this.writes.idle();
    return changed;
  }

  /** `send.status`. */
  status(attemptId: string): SendAttemptView | null {
    return this.attempts.get(attemptId)?.track.view ?? null;
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

  /** Resolves when every journal write and custody report so far settled. */
  async idle(): Promise<void> {
    await this.writes.idle();
    await this.reports.idle();
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
    attempt.track = track;
    const state = track.view.state;
    if (attempt.entry !== null) {
      attempt.entry = journalWithView(attempt.entry, track.view, this.deps.clock.now(), track.pendingId);
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

  private reportCustody(attempt: Attempt): void {
    if (attempt.reported || attempt.pageLabel === null) return;
    const view = attempt.track.view;
    const body = custodyReport({
      attemptId: view.attemptId,
      instanceId: this.deps.instanceId,
      state: view.state,
      dispatched: attempt.dispatched,
      ...(view.httpStatus === undefined ? {} : { httpStatus: view.httpStatus }),
      ...(view.platformMessageId === undefined ? {} : { platformMessageId: view.platformMessageId }),
    });
    if (body === null) return;
    attempt.reported = true;
    void this.reports.run(() => this.sendReport(attempt, body));
  }

  /** A report repeats with the same attemptId only after a transport failure, a bounded number of times. */
  private async sendReport(attempt: Attempt, body: ClaimBody): Promise<void> {
    const pageLabel = attempt.pageLabel;
    if (pageLabel === null) return;
    for (let i = 0; ; i += 1) {
      try {
        await this.deps.hub.claim({ pageLabel, fanRef: attempt.fanRef, body });
        return;
      } catch (error) {
        const transport = !isHubCallError(error) || error.failure.kind === 'transport';
        const delay = REPORT_RETRY_DELAYS_MS[i];
        if (!transport || delay === undefined) {
          this.log.write({ level: 'warn', scope: 'bg.send', msg: 'custody report not delivered', fields: { action: body.action }, ctx: { attemptId: attempt.track.view.attemptId } });
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
    const until = silenceDeadline({ state: attempt.track.view.state, updatedAt: this.deps.clock.now() }, attempt.ticketSec);
    if (until === null) return;
    attempt.silence = this.deps.clock.setTimer(Math.max(0, until - this.deps.clock.now()), () => {
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
   * sent again. The hub's custody is read for each fan with an open record.
   */
  async restore(): Promise<{ readonly kept: number; readonly uncertain: number; readonly dropped: number }> {
    const now = this.deps.clock.now();
    const raw = await this.deps.store.get(STORAGE_KEYS.sendJournal);
    const { entries, dropped } = parseJournal(raw);
    const env = this.deps.environment();
    let uncertain = 0;
    let removed = dropped;
    for (const entry of entries) {
      if (this.attempts.has(entry.attemptId)) continue;
      const page = sendPageGate(env.bootstrap, entry.pageId);
      const action = restoreAction(entry, now, page.ticketSec || 10);
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
        pageLabel: page.pageLabel,
        fanRef: entry.fanRef,
        purpose: entry.purpose,
        group: entry.group,
        partIndex: entry.partIndex,
        opId: entry.opId,
        // A restored open record may have dispatched; ended ones were reported before they were journaled ended.
        dispatched: holdsLock(entry.state),
        reported: !holdsLock(entry.state),
        ticketSec: page.ticketSec || 10,
        ticketExpiresAt: null,
        silence: null,
        restored: true,
      };
      this.attempts.set(entry.attemptId, attempt);
      this.byKey.set(attempt.key, entry.attemptId);
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
    for (const attempt of this.attempts.values()) if (holdsLock(attempt.track.view.state)) fans.add(attempt.lockKey);
    for (const fan of fans) await this.reconcileFan(fan);
    this.log.write({ level: 'info', scope: 'bg.send', msg: 'send journal restored', fields: { kept: this.attempts.size, uncertain, dropped: removed } });
    return { kept: this.attempts.size, uncertain, dropped: removed };
  }

  /**
   * Reads the hub custody of a fan (a safe read, never a ticket) and applies
   * only positive knowledge: no custody of a `preparing` attempt means its
   * dispatch never opened one, so no ticket existed and MAIN was never
   * called; a resolve in the hub ends an uncertain attempt.
   */
  async reconcileFan(lockKey: SendLockKey): Promise<void> {
    const open = [...this.attempts.values()].filter((attempt) => attempt.lockKey === lockKey && holdsLock(attempt.track.view.state) && attempt.resolved === undefined);
    const first = open[0];
    if (first === undefined || first.pageLabel === null) return;
    let state: ClaimState;
    try {
      state = await this.deps.hub.claimStatus(first.pageLabel, first.fanRef);
    } catch {
      return;
    }
    const custody = state.custody;
    for (const attempt of open) {
      const ours = custody !== null && custody.attemptId === attempt.track.view.attemptId ? custody : null;
      const view = attempt.track.view;
      if (ours === null) {
        // Only a restored record: a live one may still be waiting for its dispatch answer.
        if (attempt.restored && view.state === 'preparing') {
          attempt.dispatched = false;
          this.commit(attempt, applyAttemptInput(attempt.track, { type: 'held', code: 'CG-RUNTIME-RELOADED' }).track);
        }
        continue;
      }
      if (ours.state === 'resolved-sent' || ours.state === 'resolved-not-sent' || ours.state === 'sent' || ours.state === 'failed') {
        attempt.resolved = ours.state === 'resolved-not-sent' || ours.state === 'failed' ? 'not-sent' : 'sent';
        if (attempt.silence !== null) this.deps.clock.clearTimer(attempt.silence);
        attempt.silence = null;
        this.locks.release(attempt.lockKey, view.attemptId);
        attempt.entry = null;
        void this.saveJournal().catch(() => undefined);
        this.log.write({ level: 'info', scope: 'bg.send', msg: 'attempt resolved by the hub', fields: { custody: ours.state }, ctx: { attemptId: view.attemptId } });
        this.emit(attempt);
      }
    }
  }

  private async saveJournal(): Promise<void> {
    const entries = [...this.attempts.values()].flatMap((attempt) => (attempt.entry === null ? [] : [attempt.entry]));
    await this.writes.run(() => this.deps.store.set(STORAGE_KEYS.sendJournal, entries));
  }
}
