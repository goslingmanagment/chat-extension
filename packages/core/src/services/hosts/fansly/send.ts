// The greeting send of fansly.com's «Новые» over HTTP with the hub's custody
// (R20 P9d; docs/project-unite/architecture.md §8.6, §9.4; spec FS-NEW-3;
// contracts send-fansly.ts; NF-020…022, NF-035, RB-007). One human click on
// «Отправить» → one attempt → at most ONE fetch of ours; nothing here ever
// repeats a send, by itself, a timer or a restart. A browser transport resend
// keeps that fetch's requestId and is annotated separately (X41).
//
// The order (§8.6). Everything that may wait comes before the custody:
// - the lock (one open attempt per hub, page and fan — this install's), the
//   text's fingerprint, the hub's lease on the fan (renewed while the attempt
//   waits), the route (`prepare`: the session, the pacer's turn, the relay
//   frame of «Fansly через вкладку» up and answering), the journal's first
//   record (`routed`, before `dispatch`: a restart can then still tell the
//   hub «not sent»), a check of the tuple against the click;
// - `dispatch` (HF-3): one call, never repeated; its lost answer ends the
//   attempt `refused` (`not-enqueued`), owed to the custody as such;
// then, after the custody's ticket:
// 1. the durable write of the intent (`intentWritten`, awaited — the only
//    pause);
// 2. the final check, synchronous, by memory (`fanslyFinalCheck`): the tuple
//    of the click (creator, group, fan, tab document, route, history and draft
//    revisions) against the tuple now, and the ticket's rest;
// 3. `start()` at once — no `await` between the check and the request; the
//    client asks the route's `holds()` once more, and the relay frame repeats
//    its own part (its tab and account) before its own `fetch`.
// A failed check is `refused` (`not-enqueued`): in this very process `fetch`
// was provably not called.
//
// How it ends (contracts send-fansly.ts «How an HTTP outcome reads»): the
// receipt (`{id, groupId, senderId}` of this group and creator) → `receipted`,
// journaled; the echo 5/1 with that id from any tab of the creator (the tab's
// socket facts, `fansly.sound.batch`), or the next pass's history with it, →
// `sent`; an echo that came before the receipt is remembered for it. A proven
// refusal → `refused`; everything else after the intent → `uncertain`, which
// holds the fan here and at the hub until a proof (a late echo of a kept
// receipt, the hub's resolve) — never a timer. Every end owes the custody what
// FANSLY_CUSTODY_REPORTS says, repeated with the same attemptId until the hub
// answers (also after a restart: `reportPending`).
//
// A restart (FANSLY_SEND_RECOVERY): `routed`, `dispatched` → `refused`
// (`not-enqueued`, the custody told so); `intentWritten`, `requestStarted` →
// `uncertain` (`restart`): nobody knows whether `fetch` ran; a receipt keeps
// waiting for its echo. The journal (`fansly.send.journal`, storage.local)
// holds ids, revisions and fingerprints only — never a text.
//
// R20 P10c: the person's own send of a «Новые» card's text with Fansly's
// button after «Открыть и вставить» (FS-NEW-3) — `native`: the hub's
// `registerNativeSend` (purpose `greeting`, the generation's group for an
// unchanged AI text, else the manual group of the text's sha256), so the fan
// is greeted for everyone. A report of what happened, never a send: journaled
// (`fansly.send.native`, ids and a fingerprint only) before the first call and
// owed until the hub answers — repeated on REPORT_RETRY_DELAYS_MS, after a
// restart and whenever `pump` runs; given up after NATIVE_KEEP_MS.
//
// Fansly's own code (`bg/fansly` chunk): no ChatSpace bundle and not the
// background core reach it. No browser API here: the chunk hands the
// storage, the hub's custody routes, the client's `prepare` and sha256.

import type { CgCode } from '@cg/contracts/errors';
import type { CgAnyCode } from '@cg/contracts/errors-fansly';
import type { BootstrapLimits, ClaimState, HubClaimOp, HubFailure, ResolveHubError } from '@cg/contracts/hub';
import {
  FANSLY_SEND_JOURNAL_KEY,
  FANSLY_SEND_JOURNAL_VERSION,
  FANSLY_SEND_LIMITS,
  FANSLY_SEND_RECOVERY,
  FanslySendJournalEntrySchema,
  FanslySendReceiptSchema,
  fanslyCustodyReport,
  fanslyFinalCheck,
  fanslyGreetingGroup,
  fanslyReceiptFits,
  fanslySendLockKey,
  isFanslySendOpen,
  isFanslySendStep,
  type FanslyGreetingClaimBody,
  type FanslyGreetingRequest,
  type FanslySendJournalEntry,
  type FanslySendLockKey,
  type FanslySendOutcome,
  type FanslySendTuple,
  type FanslySendView,
  type FanslyUncertainCause,
} from '@cg/contracts/send-fansly';
import { isNativeRefusalStatus } from '@cg/contracts/send-rules';

import { leaseOfClaim, leasePolicy } from '../../../domain/newcomers/claim';
import { REPORT_RETRY_DELAYS_MS, readDispatch, reportRetryable } from '../../../domain/send/custody';
import type { OwnRequestObservation } from '../../network-session';
import { WriteQueue, type Clock, type IdSource, type TimerHandle } from '../../ports';
import { NO_LOG, type KeyValuePort, type ServiceLog } from '../../storage/ports';

/** The page of the click: granted, with the bootstrap's `configRevision` the person acted on (the hub's `flagRevision`). */
export interface FanslySendPage {
  readonly pageId: number;
  readonly pageLabel: string;
  readonly flagRevision: number;
}

/** One click: the window's request (checked by its schema), the tab document it came from, its page. */
export interface FanslySendStart {
  readonly request: FanslyGreetingRequest;
  readonly tabSessionId: string;
  readonly page: FanslySendPage;
}

/** The tuple of the click as it is NOW, read synchronously from the caller's own state; null — its tab or pass is gone. */
export type FanslySendLive = (start: FanslySendStart) => Omit<FanslySendTuple, 'transport'> | null;

/** A `POST /message` admitted, paced and routed, not sent yet (fansly-api `PreparedFanslyCall`, structurally). */
export interface FanslyPreparedSend {
  readonly requestId: string;
  readonly transport: FanslySendTuple['transport'];
  holds(): boolean;
  /** Synchronous up to `fetch`. Once. Rejects with the API's failure (`FanslyApiFailureLike`). */
  start(): Promise<{ readonly response: unknown; readonly status: number }>;
  cancel(): void;
}

/** A failure of Fansly's API as the send reads it (fansly-api `FanslyApiError`, structurally). */
export interface FanslyApiFailureLike {
  readonly name: 'FanslyApiError';
  readonly kind: string;
  readonly code: CgAnyCode;
  /** false — provably no request left. */
  readonly sent: boolean;
  readonly httpStatus?: number | undefined;
  readonly fanslyCode?: string | undefined;
}

/** The hub's custody routes and what the send reads of the sign-in. */
export interface FanslySendHub {
  claim(op: HubClaimOp): Promise<ClaimState>;
  claimStatus(pageLabel: string, fanRef: string): Promise<ClaimState>;
  readonly resolve: ResolveHubError;
  /** The hub signed in to; null — nobody. */
  hubOrigin(): string | null;
  /** The label of a granted page now; null — not (yet) in the bootstrap. */
  pageLabel(pageId: number): string | null;
  limits(): Pick<BootstrapLimits, 'claimLeaseSec' | 'claimRenewSec' | 'claimActivityWindowSec'> | null;
}

export interface FanslySendDeps {
  /** storage.local: the journal. */
  readonly local: KeyValuePort;
  readonly hub: FanslySendHub;
  /** fansly-api's `prepare` of `POST /message` (purpose `greeting`) for this creator and group with this body. */
  prepare(call: { readonly account: string; readonly groupId: string; readonly text: string }): Promise<FanslyPreparedSend>;
  readonly live: FanslySendLive;
  /** sha256 of the text's UTF-8 bytes, lower-case hex (the manual group's `textFingerprint`). */
  sha256(text: string): Promise<string>;
  instanceId(): string;
  readonly clock: Clock;
  readonly ids: Pick<IdSource, 'uuid'>;
  readonly log?: ServiceLog;
  /** One more uncertain end (client_health by code). */
  readonly countUncertain?: () => void;
  /** How long `send` waits for the echo after the receipt before it answers; default ECHO_WAIT_MS. */
  readonly echoWaitMs?: number;
}

/** After the receipt, `send` answers once the echo came or after this; the attempt goes on waiting for it. */
export const ECHO_WAIT_MS = 10_000;
/** R20 P10c: storage.local — the registrations of the person's own greeting sends the hub has not answered yet. */
export const FANSLY_NATIVE_SENDS_KEY = 'fansly.send.native';
/** A registration nobody could deliver for this long is given up (the «Новые» window is long over). */
export const NATIVE_KEEP_MS = 7 * 24 * 60 * 60_000;
const NATIVE_MAX = 200;

/** R20 P10c: the person sent a card's text with Fansly's own button (FS-NEW-3). */
export interface FanslyNativeSend {
  readonly page: FanslySendPage;
  readonly fanRef: string;
  readonly groupId: string;
  readonly platformMessageId: string;
  readonly admission: FanslyGreetingRequest['admission'];
  /** The card's text as it was put into the chat: its sha256 is the manual group's fingerprint. */
  readonly text: string;
}

/** One owed registration as it is journaled: ids, the group and the message id — never a text. */
interface NativeOwed {
  readonly attemptId: string;
  readonly hubOrigin: string;
  readonly pageId: number;
  readonly fanRef: string;
  readonly group: ReturnType<typeof fanslyGreetingGroup>;
  readonly platformMessageId: string;
  readonly at: number;
}

const isNativeOwed = (value: unknown): value is NativeOwed => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<Record<keyof NativeOwed, unknown>>;
  const group = v.group as Record<string, unknown> | null | undefined;
  return (
    typeof v.attemptId === 'string' &&
    typeof v.hubOrigin === 'string' &&
    typeof v.pageId === 'number' &&
    typeof v.fanRef === 'string' &&
    typeof v.platformMessageId === 'string' &&
    typeof v.at === 'number' &&
    typeof group === 'object' &&
    group !== null &&
    (group['kind'] === 'manual' ? typeof group['textFingerprint'] === 'string' : typeof group['generationRef'] === 'string' && typeof group['variant'] === 'number')
  );
};
/** Echoes kept for a receipt still to come: an echo can arrive before the HTTP answer (S2 Q1.8). */
const EARLY_ECHOES_MAX = 500;
const EARLY_ECHO_TTL_MS = 10 * 60_000;
/** Attempts that ended before the journal held them (refused before the route): kept in memory for their view only. */
const UNJOURNALED_MAX = 100;

const uncertain = (cause: FanslyUncertainCause): FanslySendOutcome => ({ state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause });
const refused = (proof: 'before-dispatch' | 'not-enqueued', code: CgAnyCode): FanslySendOutcome => ({ state: 'refused', proof, code });

function isApiFailure(error: unknown): error is FanslyApiFailureLike {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as Partial<FanslyApiFailureLike>;
  return e.name === 'FanslyApiError' && typeof e.kind === 'string' && typeof e.sent === 'boolean' && typeof e.code === 'string';
}

function isHubCallError(error: unknown): error is { readonly name: 'HubCallError'; readonly failure: HubFailure } {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'HubCallError' && typeof (error as { failure?: unknown }).failure === 'object';
}

/**
 * What a `start()` that rejected says of the send (contracts send-fansly.ts): no request (`sent: false` — the session,
 * the route, the relay's own check, a cooldown) → `refused` (`not-enqueued`); a 4xx but 401 → `refused`
 * (`native-rejected`); 2xx `success: false` → `uncertain` (`rejected-200`); 2xx not the envelope → `bad-receipt`;
 * 401 → `unauthorized`; 5xx or another status → `server`; no answer → `network`, through the tab — `relay`.
 */
export function fanslySendFailureOutcome(error: unknown, transport: FanslySendTuple['transport']): FanslySendOutcome {
  if (!isApiFailure(error)) return uncertain('network');
  if (!error.sent) return refused('not-enqueued', error.code);
  const status = error.httpStatus;
  switch (error.kind) {
    case 'refused':
      return uncertain('rejected-200');
    case 'malformed':
      return uncertain('bad-receipt');
    case 'rate-limited':
    case 'expired':
    case 'http':
      if (status !== undefined && isNativeRefusalStatus(status)) return { state: 'refused', proof: 'native-rejected', code: 'CG-SEND-REJECTED', httpStatus: status };
      return uncertain(status === 401 ? 'unauthorized' : 'server');
    default:
      return uncertain(transport === 'direct' ? 'network' : 'relay');
  }
}

/** A 2xx answer: the receipt of this group and creator → `receipted`; anything else → `uncertain` (`bad-receipt`). */
export function fanslyReceiptOutcome(response: unknown, tuple: Pick<FanslySendTuple, 'groupId' | 'hostAccountId'>): FanslySendOutcome {
  const receipt = FanslySendReceiptSchema.safeParse(response);
  if (!receipt.success || !fanslyReceiptFits(receipt.data, tuple)) return uncertain('bad-receipt');
  return { state: 'receipted', platformMessageId: receipt.data.id };
}

/** Why the tuple or the ticket failed the check, as the person reads it. */
const CHECK_CODES: Readonly<Record<keyof FanslySendTuple | 'ticket' | 'gone', CgAnyCode>> = {
  hostAccountId: 'CG-FNEW-ACCOUNT',
  groupId: 'CG-CONTEXT-CHANGED',
  fanRef: 'CG-CONTEXT-CHANGED',
  tabSessionId: 'CG-FAN-TAB',
  transport: 'CG-FAN-TAB',
  historyRevision: 'CG-FNEW-HISTORY',
  draftRevision: 'CG-DRAFT-CHANGED',
  ticket: 'CG-TIMEOUT',
  gone: 'CG-FAN-TAB',
};

/** The journal's fields of an attempt besides its outcome (contracts `JournalBase`). */
type JournalBase = Omit<FanslySendJournalEntry, 'state' | 'proof' | 'code' | 'httpStatus' | 'cause' | 'platformMessageId' | 'receiptMessageId' | 'reportPending'>;

interface Attempt {
  observedHeaders?: number;
  observedLoss?: boolean;
  readonly attemptId: string;
  readonly fanRef: string;
  readonly groupId: string;
  readonly lockKey: FanslySendLockKey;
  outcome: FanslySendOutcome;
  /** From `routed` on: what the journal keeps; null — never journaled (ended before the route). */
  base: JournalBase | null;
  reportPending: boolean;
  /** The page label of the click; restored attempts look it up in the bootstrap. */
  pageLabel: string | null;
  leaseToken: string | null;
  renew: TimerHandle | null;
  /** Someone waits for the echo of the receipt. */
  readonly echoed: Array<() => void>;
}

export interface FanslySend {
  /** Restores the journal (once per background): restarts' ends and the reports they owe. */
  readonly ready: Promise<void>;
  /** One click's attempt; resolves with its view once nothing is waited for any more (an end, or the receipt and a while for its echo). */
  send(start: FanslySendStart): Promise<FanslySendView>;
  /** Passive browser facts: annotate a repeated/late response, never change the outcome or send again (X41). */
  observeRequest(fact: OwnRequestObservation): Promise<void>;
  /** The tab's socket facts of a creator (`fansly.sound.batch`): our own messages may be echoes of receipts. */
  echo(events: readonly { readonly id: string; readonly conversationRef: string; readonly fromFan: boolean }[]): void;
  /** A history read of a group (the next pass): the ids it shows; `complete` — read to its start. */
  history(groupId: string, ids: readonly string[], complete: boolean): void;
  view(attemptId: string): FanslySendView | null;
  onChange(listener: (view: FanslySendView) => void): () => void;
  /** The reports still owed go now (a new bootstrap, a sign-in). */
  pump(): void;
  /**
   * R20 P10c: the person's own send of a card's text (`registerNativeSend`, FS-NEW-3): journaled, then told to the hub
   * and owed until it answers. `registered` — the hub took it; `refused` — it answered and did not; `undelivered` — it
   * stays owed.
   */
  native(sent: FanslyNativeSend): Promise<'registered' | 'refused' | 'undelivered'>;
  /** «Очистить локальные данные»: ended attempts go; open ones stay. */
  clearFinished(): Promise<void>;
  facts(): { readonly open: number; readonly uncertain: number; readonly reportsPending: number };
  dispose(): void;
}

export function createFanslySend(deps: FanslySendDeps): FanslySend {
  const log = deps.log ?? NO_LOG;
  const { clock } = deps;
  const echoWaitMs = deps.echoWaitMs ?? ECHO_WAIT_MS;
  const attempts = new Map<string, Attempt>();
  const locks = new Map<FanslySendLockKey, string>();
  const echoes = new Map<string, number>();
  const listeners = new Set<(view: FanslySendView) => void>();
  const writes = new WriteQueue();
  const reportTimers = new Map<string, TimerHandle>();
  const reporting = new Set<string>();
  let disposed = false;

  const viewOf = (attempt: Attempt): FanslySendView => ({ attemptId: attempt.attemptId, fanRef: attempt.fanRef, ...attempt.outcome }) as FanslySendView;
  const isEnd = (outcome: FanslySendOutcome): boolean => outcome.state === 'sent' || outcome.state === 'refused';

  function entryOf(attempt: Attempt): FanslySendJournalEntry | null {
    if (attempt.base === null) return null;
    const outcome = attempt.outcome;
    return (isEnd(outcome) ? { ...attempt.base, ...outcome, reportPending: attempt.reportPending } : { ...attempt.base, ...outcome }) as FanslySendJournalEntry;
  }

  /** One step of the machine: only what isFanslySendStep admits; anything else is our bug and changes nothing. */
  function step(attempt: Attempt, next: FanslySendOutcome): boolean {
    if (!isFanslySendStep(attempt.outcome, next)) {
      log({ level: 'error', scope: 'fansly.send', msg: 'refused a step the machine does not name', fields: { attemptId: attempt.attemptId, from: attempt.outcome.state, to: next.state } });
      return false;
    }
    attempt.outcome = next;
    if (attempt.base !== null) attempt.base = { ...attempt.base, updatedAt: Math.max(attempt.base.createdAt, clock.now()) };
    if (isEnd(next)) {
      const report = fanslyCustodyReport(next);
      attempt.reportPending = report !== null;
    }
    if (next.state === 'uncertain') deps.countUncertain?.();
    if (!isFanslySendOpen(next.state)) {
      if (locks.get(attempt.lockKey) === attempt.attemptId) locks.delete(attempt.lockKey);
      stopRenew(attempt);
      for (const wake of attempt.echoed.splice(0)) wake();
    }
    const view = viewOf(attempt);
    for (const listener of [...listeners]) {
      try {
        listener(view);
      } catch {
        // A listener's failure is its own.
      }
    }
    return true;
  }

  /** The journal as memory holds it: every open attempt, the ended ones within FANSLY_SEND_LIMITS. Awaited where it must be durable. */
  function persist(): Promise<boolean> {
    return writes.run(async () => {
      const now = clock.now();
      const entries = [...attempts.values()].map(entryOf).filter((entry): entry is FanslySendJournalEntry => entry !== null);
      const ended = entries.filter((entry) => !isFanslySendOpen(entry.state) && !('reportPending' in entry && entry.reportPending));
      const keep = new Set(ended.filter((entry) => now - entry.updatedAt <= FANSLY_SEND_LIMITS.journalEndedTtlMs).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, FANSLY_SEND_LIMITS.journalEndedKept).map((entry) => entry.attemptId));
      const kept = entries.filter((entry) => !ended.includes(entry) || keep.has(entry.attemptId)).sort((a, b) => a.createdAt - b.createdAt);
      for (const entry of ended) if (!keep.has(entry.attemptId)) attempts.delete(entry.attemptId);
      const written = await deps.local.set({ [FANSLY_SEND_JOURNAL_KEY]: { v: FANSLY_SEND_JOURNAL_VERSION, entries: kept } });
      if (!written.ok) log({ level: 'error', scope: 'fansly.send', msg: 'send journal write failed', code: 'CG-STORAGE-WRITE', fields: { reason: written.code } });
      return written.ok;
    });
  }

  function forgetUnjournaled(): void {
    const loose = [...attempts.values()].filter((attempt) => attempt.base === null && !isFanslySendOpen(attempt.outcome.state));
    for (const attempt of loose.slice(0, Math.max(0, loose.length - UNJOURNALED_MAX))) attempts.delete(attempt.attemptId);
  }

  // ── the lease ──────────────────────────────────────────────────────────

  function stopRenew(attempt: Attempt): void {
    if (attempt.renew !== null) clock.clearTimer(attempt.renew);
    attempt.renew = null;
  }

  function armRenew(attempt: Attempt, pageLabel: string): void {
    stopRenew(attempt);
    const { renewMs } = leasePolicy(deps.hub.limits());
    attempt.renew = clock.setTimer(renewMs, () => {
      attempt.renew = null;
      const token = attempt.leaseToken;
      if (token === null || disposed || !['claimed', 'routed'].includes(attempt.outcome.state)) return;
      void deps.hub
        .claim({ pageLabel, fanRef: attempt.fanRef, body: { action: 'renew', leaseToken: token, instanceId: deps.instanceId() } })
        .then(() => {
          if (['claimed', 'routed'].includes(attempt.outcome.state)) armRenew(attempt, pageLabel);
        })
        .catch(() => log({ level: 'warn', scope: 'fansly.send', msg: 'lease renewal failed', fields: { attemptId: attempt.attemptId } }));
    });
  }

  /** The lease goes once the attempt ended or holds the custody: one call, never repeated. */
  function releaseLease(attempt: Attempt): void {
    stopRenew(attempt);
    const token = attempt.leaseToken;
    const pageLabel = attempt.pageLabel;
    attempt.leaseToken = null;
    if (token === null || pageLabel === null) return;
    void deps.hub.claim({ pageLabel, fanRef: attempt.fanRef, body: { action: 'release', leaseToken: token, instanceId: deps.instanceId() } }).catch(() => undefined);
  }

  // ── reports to the custody ─────────────────────────────────────────────

  function reportBody(attempt: Attempt): FanslyGreetingClaimBody | null {
    const outcome = attempt.outcome;
    const instanceId = deps.instanceId();
    switch (fanslyCustodyReport(outcome)) {
      case 'sent':
        return outcome.state === 'sent' && outcome.platformMessageId !== undefined
          ? { action: 'sent', attemptId: attempt.attemptId, instanceId, platformMessageId: outcome.platformMessageId, evidence: 'receipt+echo' }
          : null;
      case 'failed-not-enqueued':
        return { action: 'failed', attemptId: attempt.attemptId, instanceId, reason: 'not_enqueued' };
      case 'failed-native-rejected':
        return outcome.state === 'refused' && outcome.httpStatus !== undefined
          ? { action: 'failed', attemptId: attempt.attemptId, instanceId, reason: 'native_rejected', httpStatus: outcome.httpStatus }
          : null;
      case null:
        return null;
    }
  }

  /** The report an end owes, with the same attemptId until the hub answers; a refusal of the hub ends the debt. */
  function report(attempt: Attempt, tries = 0): void {
    if (disposed || !attempt.reportPending || reporting.has(attempt.attemptId) || reportTimers.has(attempt.attemptId)) return;
    const body = reportBody(attempt);
    const hubOrigin = deps.hub.hubOrigin();
    const pageLabel = attempt.pageLabel ?? (attempt.base === null ? null : deps.hub.pageLabel(attempt.base.pageId));
    if (body === null) {
      attempt.reportPending = false;
      void persist();
      return;
    }
    if (attempt.base === null) return;
    // Another sign-in's hub waits for `pump`; no sign-in or no bootstrap yet (a wake) — a little later, too.
    if (hubOrigin !== attempt.base.hubOrigin || pageLabel === null) {
      if (hubOrigin === null || pageLabel === null) later(attempt, tries);
      return;
    }
    attempt.pageLabel = pageLabel;
    reporting.add(attempt.attemptId);
    deps.hub
      .claim({ pageLabel, fanRef: attempt.fanRef, body })
      .then(
        () => {
          attempt.reportPending = false;
          log({ level: 'info', scope: 'fansly.send', msg: 'custody report taken', fields: { attemptId: attempt.attemptId, action: body.action } });
          return persist();
        },
        (error: unknown) => {
          const retry = isHubCallError(error) && reportRetryable(error.failure);
          log({ level: 'warn', scope: 'fansly.send', msg: 'custody report failed', fields: { attemptId: attempt.attemptId, action: body.action, retry } });
          if (!retry) {
            attempt.reportPending = false;
            return persist();
          }
          later(attempt, tries);
          return undefined;
        },
      )
      .finally(() => reporting.delete(attempt.attemptId));
  }

  /** The same report again after REPORT_RETRY_DELAYS_MS (never a dispatch). */
  function later(attempt: Attempt, tries: number): void {
    if (disposed || reportTimers.has(attempt.attemptId)) return;
    const delay = REPORT_RETRY_DELAYS_MS[Math.min(tries, REPORT_RETRY_DELAYS_MS.length - 1)] ?? 60_000;
    reportTimers.set(
      attempt.attemptId,
      clock.setTimer(delay, () => {
        reportTimers.delete(attempt.attemptId);
        report(attempt, tries + 1);
      }),
    );
  }

  /** An attempt ends: the journal (awaited), then its report and the lease. */
  async function end(attempt: Attempt, outcome: FanslySendOutcome): Promise<void> {
    if (!step(attempt, outcome)) return;
    if (attempt.base !== null) await persist();
    else forgetUnjournaled();
    if (!isFanslySendOpen(attempt.outcome.state) || attempt.outcome.state === 'uncertain') releaseLease(attempt);
    report(attempt);
  }

  // ── restore ────────────────────────────────────────────────────────────

  async function restore(): Promise<void> {
    const read = await deps.local.get([FANSLY_SEND_JOURNAL_KEY]);
    if (!read.ok) {
      log({ level: 'error', scope: 'fansly.send', msg: 'send journal read failed', code: 'CG-STORAGE-READ' });
      return;
    }
    const raw = read.value[FANSLY_SEND_JOURNAL_KEY] as { readonly entries?: unknown } | undefined;
    const rows = Array.isArray(raw?.entries) ? (raw.entries as unknown[]) : [];
    let changed = false;
    for (const row of rows) {
      const parsed = FanslySendJournalEntrySchema.safeParse(row);
      if (!parsed.success) {
        changed = true;
        log({ level: 'error', scope: 'fansly.send', msg: 'send journal record unreadable: dropped' });
        continue;
      }
      const entry = parsed.data;
      const { state: _state, ...rest } = entry as FanslySendJournalEntry & Record<string, unknown>;
      const base: JournalBase = {
        attemptId: entry.attemptId,
        hubOrigin: entry.hubOrigin,
        pageId: entry.pageId,
        hostAccountId: entry.hostAccountId,
        fanRef: entry.fanRef,
        groupId: entry.groupId,
        admission: entry.admission,
        group: entry.group,
        draftRevision: entry.draftRevision,
        historyRevision: entry.historyRevision,
        transport: entry.transport,
        ticketExpiresAt: entry.ticketExpiresAt,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        ...(entry.requestId === undefined ? {} : { requestId: entry.requestId }),
        ...(entry.browserResend === undefined ? {} : { browserResend: entry.browserResend }),
      };
      const outcome = outcomeOfEntry({ state: entry.state, ...rest });
      const attempt: Attempt = {
        attemptId: entry.attemptId,
        fanRef: entry.fanRef,
        groupId: entry.groupId,
        lockKey: fanslySendLockKey(entry),
        outcome,
        base,
        reportPending: 'reportPending' in entry ? entry.reportPending : false,
        pageLabel: null,
        leaseToken: null,
        renew: null,
        echoed: [],
      };
      attempts.set(attempt.attemptId, attempt);
      if (isFanslySendOpen(outcome.state)) locks.set(attempt.lockKey, attempt.attemptId);
      const recovery = FANSLY_SEND_RECOVERY[entry.state];
      if (recovery !== null) {
        changed = step(attempt, recovery) || changed;
        log({ level: 'warn', scope: 'fansly.send', msg: 'attempt interrupted by a restart', fields: { attemptId: attempt.attemptId, from: entry.state, to: recovery.state } });
      }
    }
    if (changed) await persist();
    for (const attempt of attempts.values()) report(attempt);
  }

  function outcomeOfEntry(entry: Record<string, unknown> & { readonly state: FanslySendJournalEntry['state'] }): FanslySendOutcome {
    const pick = (field: string): Record<string, unknown> => (entry[field] === undefined ? {} : { [field]: entry[field] });
    switch (entry.state) {
      case 'receipted':
        return { state: 'receipted', platformMessageId: entry['platformMessageId'] as string };
      case 'sent':
        return { state: 'sent', ...pick('proof'), ...pick('platformMessageId') } as FanslySendOutcome;
      case 'refused':
        return { state: 'refused', ...pick('proof'), ...pick('code'), ...pick('httpStatus') } as FanslySendOutcome;
      case 'uncertain':
        return { state: 'uncertain', code: 'CG-SEND-UNCERTAIN', ...pick('cause'), ...pick('receiptMessageId') } as FanslySendOutcome;
      case 'routed':
      case 'dispatched':
      case 'intentWritten':
      case 'requestStarted':
        return { state: entry.state };
    }
  }

  const ready = restore().catch(() => log({ level: 'error', scope: 'fansly.send', msg: 'send journal restore failed' }));

  // ── the hub's custody ──────────────────────────────────────────────────

  /** A hub call that rejected, as the person reads it: the hub layer's own reading. */
  function hubCode(error: unknown, action: 'claim' | 'dispatch'): CgCode {
    if (!isHubCallError(error)) return 'CG-HUB-UNKNOWN';
    const resolution = deps.hub.resolve(error.failure, {
      route: 'clientFanClaim',
      currentSignIn: true,
      pageGranted: true,
      beforeFirstFrame: false,
      claimAction: action,
      fanLookup: false,
      now: clock.now(),
    });
    return resolution.disposition === 'read-status' ? 'CG-SEND-PART' : (resolution.code ?? 'CG-HUB-UNKNOWN');
  }

  /** A click blocked by an uncertain attempt of ours: the hub's resolve of it (a status read, never a dispatch). */
  async function liftUncertain(prior: Attempt, pageLabel: string): Promise<void> {
    let state: ClaimState;
    try {
      state = await deps.hub.claimStatus(pageLabel, prior.fanRef);
    } catch {
      return;
    }
    const custody = state.custody;
    if (custody === null || custody.attemptId !== prior.attemptId || prior.outcome.state !== 'uncertain') return;
    if (custody.state === 'resolved-sent') await end(prior, { state: 'sent', proof: 'resolved-sent' });
    if (custody.state === 'resolved-not-sent') await end(prior, { state: 'refused', proof: 'resolved-not-sent' });
  }

  // ── one attempt ────────────────────────────────────────────────────────

  async function send(start: FanslySendStart): Promise<FanslySendView> {
    await ready;
    const { request, page } = start;
    const known = attempts.get(request.attemptId);
    // One click, one attempt: the same attemptId again only reads.
    if (known !== undefined) return viewOf(known);
    const hubOrigin = deps.hub.hubOrigin();
    const lockKey = fanslySendLockKey({ hubOrigin: hubOrigin ?? '', pageId: page.pageId, fanRef: request.fanRef });
    const attempt: Attempt = {
      attemptId: request.attemptId,
      fanRef: request.fanRef,
      groupId: request.groupId,
      lockKey,
      outcome: { state: 'ready' },
      base: null,
      reportPending: false,
      pageLabel: page.pageLabel,
      leaseToken: null,
      renew: null,
      echoed: [],
    };
    attempts.set(attempt.attemptId, attempt);
    const stop = async (code: CgAnyCode): Promise<FanslySendView> => {
      await end(attempt, refused('before-dispatch', code));
      return viewOf(attempt);
    };
    if (hubOrigin === null) return stop('CG-AUTH-REQUIRED');

    // The fan lock: one open attempt per hub, page and fan (an uncertain one holds it until a proof).
    const holderId = locks.get(lockKey);
    if (holderId !== undefined) {
      const holder = attempts.get(holderId);
      if (holder?.outcome.state === 'uncertain') await liftUncertain(holder, page.pageLabel);
      const still = locks.get(lockKey);
      if (still !== undefined) return stop(attempts.get(still)?.outcome.state === 'uncertain' ? 'CG-SEND-UNCERTAIN' : 'CG-SEND-BUSY');
      if (holder?.outcome.state === 'sent') return stop('CG-SEND-PART');
    }
    locks.set(lockKey, attempt.attemptId);

    const taken = (transport: FanslySendTuple['transport']): FanslySendTuple => ({
      hostAccountId: request.hostAccountId,
      groupId: request.groupId,
      fanRef: request.fanRef,
      tabSessionId: start.tabSessionId,
      transport,
      historyRevision: request.historyRevision,
      draftRevision: request.draftRevision,
    });
    /** The tuple now; the route's own part is its `holds()` (another value than the click's when it no longer holds). */
    const current = (prepared: FanslyPreparedSend): FanslySendTuple | null => {
      const live = deps.live(start);
      if (live === null) return null;
      const transport = prepared.holds() ? prepared.transport : prepared.transport === 'direct' ? 'tab:' : 'direct';
      return { ...live, transport };
    };

    let fingerprint: string;
    try {
      fingerprint = await deps.sha256(request.text);
    } catch {
      return stop('CG-UNKNOWN');
    }
    const group = fanslyGreetingGroup(request.admission, fingerprint);

    // ready → claimed: the hub's lease on the fan.
    const leaseToken = deps.ids.uuid();
    let claim: ClaimState;
    try {
      claim = await deps.hub.claim({ pageLabel: page.pageLabel, fanRef: request.fanRef, body: { action: 'claim', leaseToken, instanceId: deps.instanceId() } });
    } catch (error) {
      return stop(hubCode(error, 'claim'));
    }
    const lease = leaseOfClaim(claim, clock.now(), leasePolicy(deps.hub.limits()));
    const ours = lease.s === 'mine' && lease.leaseToken === leaseToken;
    // A greeting already confirmed is never sent again (FS-NEW-3); the lease just taken goes with the refusal.
    if (ours) attempt.leaseToken = leaseToken;
    if (!ours || claim.greeting.state === 'confirmed') {
      return stop(claim.greeting.state === 'confirmed' ? 'CG-SEND-PART' : lease.s === 'expired' ? 'CG-CLAIM-EXPIRED' : 'CG-CLAIM-BUSY');
    }
    step(attempt, { state: 'claimed' });
    armRenew(attempt, page.pageLabel);

    // claimed → routed: the session, the pacer's turn, the route (the relay frame up): all that may wait, before the custody.
    let prepared: FanslyPreparedSend;
    try {
      prepared = await deps.prepare({ account: request.hostAccountId, groupId: request.groupId, text: request.text });
    } catch (error) {
      return stop(isApiFailure(error) ? error.code : 'CG-FAN-REQUEST');
    }
    const now = clock.now();
    attempt.base = {
      attemptId: request.attemptId,
      requestId: prepared.requestId,
      hubOrigin,
      pageId: page.pageId,
      hostAccountId: request.hostAccountId,
      fanRef: request.fanRef,
      groupId: request.groupId,
      admission: request.admission,
      group,
      draftRevision: request.draftRevision,
      historyRevision: request.historyRevision,
      transport: prepared.transport === 'direct' ? 'direct' : 'tab',
      ticketExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
    step(attempt, { state: 'routed' });
    // The journal BEFORE dispatch: no record, no custody.
    if (!(await persist())) {
      prepared.cancel();
      attempt.base = null;
      return stop('CG-STORAGE-WRITE');
    }
    // What changed while it waited is refused before the custody (§8.5).
    const before = current(prepared);
    const checked = before === null ? ({ ok: false, field: 'gone' } as const) : fanslyFinalCheck(taken(prepared.transport), before, Number.POSITIVE_INFINITY, now);
    if (!checked.ok) {
      prepared.cancel();
      return stop(CHECK_CODES[checked.field]);
    }

    // routed → dispatched: the custody, one call, never repeated.
    const body: FanslyGreetingClaimBody = {
      action: 'dispatch',
      attemptId: request.attemptId,
      instanceId: deps.instanceId(),
      purpose: 'greeting',
      group,
      partIndex: 0,
      textRevision: request.draftRevision,
      leaseToken,
      flagRevision: page.flagRevision,
    };
    let custody: ClaimState;
    // Charge the whole round trip against the ticket, even when the two clocks differ.
    const dispatchStartedAt = clock.now();
    try {
      custody = await deps.hub.claim({ pageLabel: page.pageLabel, fanRef: request.fanRef, body });
    } catch (error) {
      prepared.cancel();
      // An HTTP refusal opened nothing; a lost answer may have opened a custody: it is told «not enqueued».
      const lost = !isHubCallError(error) || error.failure.kind === 'transport';
      log({ level: 'warn', scope: 'fansly.send', msg: 'dispatch failed', fields: { attemptId: request.attemptId, lost } });
      await end(attempt, refused(lost ? 'not-enqueued' : 'before-dispatch', lost ? 'CG-HUB-TIMEOUT' : hubCode(error, 'dispatch')));
      return viewOf(attempt);
    }
    const reading = readDispatch(custody, request.attemptId, 0, dispatchStartedAt);
    if (reading.kind === 'no-ticket') {
      prepared.cancel();
      await end(attempt, refused(reading.opened ? 'not-enqueued' : 'before-dispatch', reading.code));
      return viewOf(attempt);
    }
    const ticketExpiresAt = reading.ticket.expiresAt;
    attempt.base = { ...attempt.base, ticketExpiresAt };
    step(attempt, { state: 'dispatched' });
    stopRenew(attempt);

    // 1. The durable intent — the only pause after the custody.
    step(attempt, { state: 'intentWritten' });
    if (!(await persist())) {
      prepared.cancel();
      // Recorded or not, nothing was sent: the custody hears «not enqueued».
      await end(attempt, refused('not-enqueued', 'CG-STORAGE-WRITE'));
      return viewOf(attempt);
    }
    // 2. The final check, synchronous, by memory; 3. the request at once — no `await` between.
    const live = current(prepared);
    const final = live === null ? ({ ok: false, field: 'gone' } as const) : fanslyFinalCheck(taken(prepared.transport), live, ticketExpiresAt, clock.now());
    if (!final.ok) {
      prepared.cancel();
      log({ level: 'warn', scope: 'fansly.send', msg: 'final check refused the send', fields: { attemptId: request.attemptId, field: final.field } });
      await end(attempt, refused('not-enqueued', CHECK_CODES[final.field]));
      return viewOf(attempt);
    }
    const request$ = prepared.start();
    step(attempt, { state: 'requestStarted' });
    log({ level: 'info', scope: 'fansly.send', msg: 'greeting request started', fields: { attemptId: request.attemptId, transport: attempt.base.transport } });

    let outcome: FanslySendOutcome;
    try {
      const answer = await request$;
      outcome = fanslyReceiptOutcome(answer.response, taken(prepared.transport));
    } catch (error) {
      outcome = fanslySendFailureOutcome(error, prepared.transport);
      if (isApiFailure(error)) log({ level: 'warn', scope: 'fansly.send', msg: 'greeting request failed', fields: { attemptId: request.attemptId, kind: error.kind, status: error.httpStatus ?? null, fanslyCode: error.fanslyCode ?? null, to: outcome.state } });
    }
    if (outcome.state !== 'receipted') {
      await end(attempt, outcome);
      return viewOf(attempt);
    }
    // The receipt: journaled (a restart keeps waiting for its echo); an echo that came first proves it at once.
    step(attempt, outcome);
    const id = outcome.platformMessageId;
    if (takeEcho(request.groupId, id)) {
      await end(attempt, { state: 'sent', proof: 'echo', platformMessageId: id });
      return viewOf(attempt);
    }
    await persist();
    if (attempt.outcome.state === 'receipted') {
      await new Promise<void>((resolve) => {
        const timer = clock.setTimer(echoWaitMs, () => resolve());
        attempt.echoed.push(() => {
          clock.clearTimer(timer);
          resolve();
        });
      });
    }
    releaseLease(attempt);
    return viewOf(attempt);
  }

  // ── proofs ─────────────────────────────────────────────────────────────

  async function observeRequest(fact: OwnRequestObservation): Promise<void> {
    await ready;
    if (disposed) return;
    const attempt = [...attempts.values()].find((value) => value.base?.requestId === fact.clientRequestId);
    if (attempt === undefined || attempt.base === null) return;
    if (fact.phase === 'headers') {
      attempt.observedHeaders = (attempt.observedHeaders ?? 0) + 1;
      return;
    }
    if (fact.phase === 'error') {
      attempt.observedLoss = true;
      return;
    }
    const lost = attempt.outcome.state === 'uncertain' && ['network', 'relay', 'restart'].includes(attempt.outcome.cause);
    if ((fact.statusCode ?? 0) <= 0 || attempt.base.browserResend === true || (!lost && !attempt.observedLoss && (attempt.observedHeaders ?? 0) < 2)) return;
    attempt.base = { ...attempt.base, browserResend: true, updatedAt: Math.max(attempt.base.createdAt, clock.now()) };
    log({ level: 'warn', scope: 'fansly.send', msg: 'browser answered a repeated or lost greeting request', fields: { attemptId: attempt.attemptId, requestId: fact.clientRequestId, browserResend: true, status: fact.statusCode ?? null } });
    await persist();
  }

  const echoKey = (groupId: string, id: string): string => `${groupId}|${id}`;

  function takeEcho(groupId: string, id: string): boolean {
    const key = echoKey(groupId, id);
    const at = echoes.get(key);
    if (at === undefined) return false;
    echoes.delete(key);
    return clock.now() - at <= EARLY_ECHO_TTL_MS;
  }

  /** The kept receipt an id proves: a receipted attempt, or an uncertain one that kept its receipt. */
  function receiptOf(groupId: string, id: string): Attempt | null {
    for (const attempt of attempts.values()) {
      if (attempt.groupId !== groupId) continue;
      const o = attempt.outcome;
      if ((o.state === 'receipted' && o.platformMessageId === id) || (o.state === 'uncertain' && o.receiptMessageId === id)) return attempt;
    }
    return null;
  }

  function echo(events: readonly { readonly id: string; readonly conversationRef: string; readonly fromFan: boolean }[]): void {
    void ready.then(() => {
      for (const event of events) {
        if (event.fromFan) continue;
        const attempt = receiptOf(event.conversationRef, event.id);
        if (attempt !== null) {
          log({ level: 'info', scope: 'fansly.send', msg: 'greeting echoed', fields: { attemptId: attempt.attemptId } });
          void end(attempt, { state: 'sent', proof: 'echo', platformMessageId: event.id });
          continue;
        }
        // Maybe before its receipt: kept a while for it.
        echoes.set(echoKey(event.conversationRef, event.id), clock.now());
        if (echoes.size > EARLY_ECHOES_MAX) echoes.delete(echoes.keys().next().value as string);
      }
    });
  }

  function history(groupId: string, ids: readonly string[], complete: boolean): void {
    void ready.then(() => {
      const shown = new Set(ids);
      for (const attempt of [...attempts.values()]) {
        if (attempt.groupId !== groupId) continue;
        const o = attempt.outcome;
        const id = o.state === 'receipted' ? o.platformMessageId : o.state === 'uncertain' ? o.receiptMessageId : undefined;
        if (id === undefined) continue;
        if (shown.has(id)) void end(attempt, { state: 'sent', proof: 'history', platformMessageId: id });
        else if (complete && o.state === 'receipted') {
          step(attempt, { state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'receipt-missing', receiptMessageId: id });
          void persist();
        }
      }
    });
  }

  // ── the person's own sends (R20 P10c) ───────────────────────────────

  const owed = new Map<string, NativeOwed>();
  const nativeTimers = new Map<string, TimerHandle>();
  const nativeRunning = new Set<string>();
  const nativeWrites = new WriteQueue();

  function persistNative(): Promise<boolean> {
    return nativeWrites.run(async () => {
      const now = clock.now();
      for (const [id, entry] of owed) if (now - entry.at > NATIVE_KEEP_MS) owed.delete(id);
      const kept = [...owed.values()].sort((a, b) => a.at - b.at).slice(-NATIVE_MAX);
      const written = await deps.local.set({ [FANSLY_NATIVE_SENDS_KEY]: kept });
      if (!written.ok) log({ level: 'error', scope: 'fansly.send', msg: 'native send journal write failed', code: 'CG-STORAGE-WRITE', fields: { reason: written.code } });
      return written.ok;
    });
  }

  const nativeRestored = ready.then(async () => {
    const read = await deps.local.get([FANSLY_NATIVE_SENDS_KEY]);
    if (!read.ok) return;
    const rows = read.value[FANSLY_NATIVE_SENDS_KEY];
    for (const row of Array.isArray(rows) ? rows : []) if (isNativeOwed(row)) owed.set(row.attemptId, row);
    // Owed from an earlier event page: told again as soon as the hub and its page are known (or at the next `pump`).
    for (const entry of [...owed.values()]) void deliverNative(entry);
  });

  /** One delivery of an owed registration; a refusal of the hub ends the debt, a failure it may repeat waits. */
  async function deliverNative(entry: NativeOwed, tries = 0): Promise<'registered' | 'refused' | 'undelivered'> {
    if (disposed || nativeRunning.has(entry.attemptId) || !owed.has(entry.attemptId)) return 'undelivered';
    const pageLabel = deps.hub.hubOrigin() === entry.hubOrigin ? deps.hub.pageLabel(entry.pageId) : null;
    if (pageLabel === null) return 'undelivered';
    nativeRunning.add(entry.attemptId);
    try {
      await deps.hub.claim({
        pageLabel,
        fanRef: entry.fanRef,
        body: { action: 'registerNativeSend', attemptId: entry.attemptId, instanceId: deps.instanceId(), purpose: 'greeting', group: entry.group, partIndex: 0, platformMessageId: entry.platformMessageId },
      });
      owed.delete(entry.attemptId);
      await persistNative();
      log({ level: 'info', scope: 'fansly.send', msg: 'native greeting registered', fields: { attemptId: entry.attemptId } });
      return 'registered';
    } catch (error) {
      const retry = isHubCallError(error) && reportRetryable(error.failure);
      log({ level: 'warn', scope: 'fansly.send', msg: 'native greeting registration failed', fields: { attemptId: entry.attemptId, retry } });
      if (!retry) {
        owed.delete(entry.attemptId);
        await persistNative();
        return 'refused';
      }
      if (!nativeTimers.has(entry.attemptId) && !disposed) {
        const delay = REPORT_RETRY_DELAYS_MS[Math.min(tries, REPORT_RETRY_DELAYS_MS.length - 1)] ?? 60_000;
        nativeTimers.set(
          entry.attemptId,
          clock.setTimer(delay, () => {
            nativeTimers.delete(entry.attemptId);
            void deliverNative(entry, tries + 1);
          }),
        );
      }
      return 'undelivered';
    } finally {
      nativeRunning.delete(entry.attemptId);
    }
  }

  async function native(sent: FanslyNativeSend): Promise<'registered' | 'refused' | 'undelivered'> {
    await nativeRestored;
    const hubOrigin = deps.hub.hubOrigin();
    if (hubOrigin === null) return 'undelivered';
    // The same message reported twice (two tabs heard it) is one registration.
    for (const entry of owed.values()) if (entry.platformMessageId === sent.platformMessageId && entry.fanRef === sent.fanRef) return deliverNative(entry);
    let fingerprint: string;
    try {
      fingerprint = await deps.sha256(sent.text);
    } catch {
      return 'undelivered';
    }
    const entry: NativeOwed = {
      attemptId: deps.ids.uuid(),
      hubOrigin,
      pageId: sent.page.pageId,
      fanRef: sent.fanRef,
      group: fanslyGreetingGroup(sent.admission, fingerprint),
      platformMessageId: sent.platformMessageId,
      at: clock.now(),
    };
    owed.set(entry.attemptId, entry);
    // Owed before the first call: a registration lost with the event page would leave the fan open for a second greeting.
    await persistNative();
    return deliverNative(entry);
  }

  return {
    ready,
    send,
    native,
    observeRequest,
    echo,
    history,
    view: (attemptId) => {
      const attempt = attempts.get(attemptId);
      return attempt === undefined ? null : viewOf(attempt);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pump() {
      void ready.then(() => {
        for (const attempt of attempts.values()) report(attempt);
      });
      void nativeRestored.then(() => {
        for (const entry of [...owed.values()]) void deliverNative(entry);
      });
    },
    async clearFinished() {
      await ready;
      for (const attempt of [...attempts.values()]) if (!isFanslySendOpen(attempt.outcome.state) && !attempt.reportPending) attempts.delete(attempt.attemptId);
      await persist();
    },
    facts() {
      let open = 0;
      let unsure = 0;
      let pending = 0;
      for (const attempt of attempts.values()) {
        if (isFanslySendOpen(attempt.outcome.state)) open += 1;
        if (attempt.outcome.state === 'uncertain') unsure += 1;
        if (attempt.reportPending) pending += 1;
      }
      return { open, uncertain: unsure, reportsPending: pending };
    },
    dispose() {
      disposed = true;
      for (const timer of reportTimers.values()) clock.clearTimer(timer);
      reportTimers.clear();
      for (const timer of nativeTimers.values()) clock.clearTimer(timer);
      nativeTimers.clear();
      for (const attempt of attempts.values()) stopRenew(attempt);
    },
  };
}
