// Coach sessions of one tab (AI-089, AI-090, AI-092, AI-099; architecture.md
// §9.4 «Coach: 5 сессий по 50 обменов, до 2 МиБ»). A session is the dialog
// about one fan under one persona: the feed the person sees (finished
// exchanges and failed attempts) and the turn in flight. Only a turn whose
// answer finished usable becomes an exchange and is ever replayed as
// history; a failed or canceled turn keeps its question and drops the
// partial answer. The store lives in the tab's memory: a reload starts
// clean. It keeps at most five sessions (least recently used goes first),
// fifty exchanges each and two mebibytes in all; «Новый диалог» puts the
// current session aside (it stays in the five as history) and starts a new
// one; a change of persona or sign-in wipes everything.

import { type CgErrorWire } from '@cg/contracts/errors';
import { type ChatKey } from '@cg/contracts/ids';
import { STORAGE_LIMITS } from '@cg/contracts/limits';
import { type CoachAnswer, type CoachTurn } from '@cg/contracts/ops';

import { replayedCount, serializeCoachHistory } from './history';

export interface CoachSessionLimits {
  readonly sessions: number;
  readonly exchanges: number;
  readonly totalBytes: number;
}

export const COACH_SESSION_LIMITS: CoachSessionLimits = {
  sessions: STORAGE_LIMITS.coachSessions,
  exchanges: STORAGE_LIMITS.coachExchangesPerSession,
  totalBytes: STORAGE_LIMITS.coachTotalBytes,
};

export interface CoachSessionKey {
  readonly chatKey: ChatKey;
  readonly personaDefinitionId: string;
}

/** A finished turn: the only thing replayed as history. */
export interface CoachExchange {
  readonly kind: 'exchange';
  readonly turnId: string;
  readonly opId: string;
  readonly generationRef: string | null;
  readonly question: string;
  readonly preset: 'situation' | null;
  /** The raw finished answer; the replay projection is applied when serialising, never stored. */
  readonly answerRaw: string;
  readonly answer: CoachAnswer;
  readonly attachedDraft: boolean;
  readonly askedAt: number;
  readonly completedAt: number;
}

/** A turn that did not finish: the question is kept, the partial answer is not (AI-092). */
export interface CoachFailedTurn {
  readonly kind: 'failed';
  readonly turnId: string;
  readonly opId: string | null;
  readonly question: string;
  readonly preset: 'situation' | null;
  readonly attachedDraft: boolean;
  readonly askedAt: number;
  readonly endedAt: number;
  /** `canceled` — «Остановлено вами»; otherwise the one error of the turn. */
  readonly outcome: 'failed' | 'canceled' | 'interrupted';
  readonly error: CgErrorWire | null;
}

export type CoachFeedItem = CoachExchange | CoachFailedTurn;

/** The turn in flight: at most one per session (CG-OP-COACH-BUSY). */
export interface CoachPendingTurn {
  readonly turnId: string;
  readonly question: string;
  readonly preset: 'situation' | null;
  readonly attachedDraft: boolean;
  readonly askedAt: number;
  /** `recap` — the auto-recap step of the composite turn; `coach` — the answer itself. */
  readonly step: 'recap' | 'coach';
  /** The operation of the current step; null while the start is on its way to the background. */
  readonly opId: string | null;
  /** The feed as it was before this turn began: a start that was refused puts it back (AI-099). */
  readonly feedBefore: readonly CoachFeedItem[];
}

export interface CoachSession {
  readonly sessionId: string;
  readonly key: CoachSessionKey;
  readonly createdAt: number;
  readonly feed: readonly CoachFeedItem[];
  readonly pending: CoachPendingTurn | null;
  /** AI-096: the auto-recap was tried for this session (once). */
  readonly autoRecapAttempted: boolean;
  /** Put aside by «Новый диалог»: kept as history, never shown as the current dialog. */
  readonly archived: boolean;
}

export type CoachRefusal = 'busy' | 'no-session' | 'unknown-turn';

const keyOf = (key: CoachSessionKey): string => `${key.chatKey}\u0000${key.personaDefinitionId}`;

/** A fair size of what a session keeps (UTF-16 units → bytes). */
function sessionBytes(session: CoachSession): number {
  let chars = 0;
  for (const item of session.feed) chars += item.question.length + (item.kind === 'exchange' ? item.answerRaw.length * 2 : 0) + 200;
  if (session.pending !== null) chars += session.pending.question.length + 200;
  return chars * 2;
}

export interface CoachStoreDeps {
  readonly newId: () => string;
  readonly limits?: Partial<CoachSessionLimits>;
}

export class CoachSessions {
  /** Insertion order is the LRU order: a touched session moves to the end. */
  private sessions: CoachSession[] = [];
  private readonly limits: CoachSessionLimits;

  constructor(private readonly deps: CoachStoreDeps) {
    this.limits = { ...COACH_SESSION_LIMITS, ...deps.limits };
  }

  /** The current dialog of a chat under a persona, or null when there is none yet. */
  peek(key: CoachSessionKey): CoachSession | null {
    const id = keyOf(key);
    return this.sessions.findLast((session) => !session.archived && keyOf(session.key) === id) ?? null;
  }

  /** The current dialog, created on first use; using it makes it the most recent. */
  open(key: CoachSessionKey, now: number): CoachSession {
    const existing = this.peek(key);
    if (existing !== null) {
      this.touch(existing.sessionId);
      return existing;
    }
    const session: CoachSession = { sessionId: this.deps.newId(), key, createdAt: now, feed: [], pending: null, autoRecapAttempted: false, archived: false };
    this.sessions.push(session);
    this.enforce();
    return session;
  }

  /**
   * AI-090 «Новый диалог»: the current session is put aside and a new one
   * starts. Refused while an answer is on its way.
   */
  newDialog(key: CoachSessionKey, now: number): { readonly ok: true; readonly session: CoachSession } | { readonly ok: false; readonly reason: CoachRefusal } {
    const current = this.peek(key);
    if (current !== null && current.pending !== null) return { ok: false, reason: 'busy' };
    if (current !== null) {
      // An empty dialog is not history worth a slot.
      if (current.feed.length === 0) this.sessions = this.sessions.filter((session) => session.sessionId !== current.sessionId);
      else this.replace({ ...current, archived: true });
    }
    return { ok: true, session: this.open(key, now) };
  }

  /** A question is asked: the session gets its one pending turn. */
  begin(sessionId: string, turn: Omit<CoachPendingTurn, 'opId' | 'feedBefore'>): { readonly ok: true; readonly session: CoachSession } | { readonly ok: false; readonly reason: CoachRefusal } {
    const session = this.byId(sessionId);
    if (session === null) return { ok: false, reason: 'no-session' };
    if (session.pending !== null) return { ok: false, reason: 'busy' };
    const next: CoachSession = {
      ...session,
      pending: { ...turn, opId: null, feedBefore: session.feed },
      autoRecapAttempted: session.autoRecapAttempted || turn.step === 'recap',
      // A new attempt replaces the failed attempts of the same question: the feed keeps one line per question.
      feed: session.feed.filter((item) => item.kind !== 'failed' || item.question !== turn.question),
    };
    this.replace(next);
    this.touch(sessionId);
    return { ok: true, session: next };
  }

  /** The pending turn moved on: an operation was admitted for a step, or the recap step ended. */
  step(sessionId: string, turnId: string, step: CoachPendingTurn['step'], opId: string | null): CoachSession | null {
    const session = this.byId(sessionId);
    if (session === null || session.pending === null || session.pending.turnId !== turnId) return null;
    const next: CoachSession = { ...session, pending: { ...session.pending, step, opId }, autoRecapAttempted: session.autoRecapAttempted || step === 'recap' };
    this.replace(next);
    return next;
  }

  /** The answer finished usable: the turn becomes an exchange. */
  complete(sessionId: string, turnId: string, done: Pick<CoachExchange, 'opId' | 'generationRef' | 'answerRaw' | 'answer' | 'completedAt'>): CoachSession | null {
    const session = this.byId(sessionId);
    const pending = session?.pending ?? null;
    if (session === null || pending === null || pending.turnId !== turnId) return null;
    const exchange: CoachExchange = {
      kind: 'exchange',
      turnId,
      opId: done.opId,
      generationRef: done.generationRef,
      question: pending.question,
      preset: pending.preset,
      answerRaw: done.answerRaw,
      answer: done.answer,
      attachedDraft: pending.attachedDraft,
      askedAt: pending.askedAt,
      completedAt: done.completedAt,
    };
    const next: CoachSession = { ...session, pending: null, feed: [...session.feed, exchange] };
    this.replace(next);
    this.enforce();
    return this.byId(sessionId);
  }

  /** The turn did not finish: its question stays in the feed, its partial answer is dropped. */
  fail(sessionId: string, turnId: string, end: Pick<CoachFailedTurn, 'outcome' | 'error' | 'endedAt'>): CoachSession | null {
    const session = this.byId(sessionId);
    const pending = session?.pending ?? null;
    if (session === null || pending === null || pending.turnId !== turnId) return null;
    const failed: CoachFailedTurn = {
      kind: 'failed',
      turnId,
      opId: pending.opId,
      question: pending.question,
      preset: pending.preset,
      attachedDraft: pending.attachedDraft,
      askedAt: pending.askedAt,
      endedAt: end.endedAt,
      outcome: end.outcome,
      error: end.error,
    };
    const next: CoachSession = { ...session, pending: null, feed: [...session.feed, failed] };
    this.replace(next);
    return next;
  }

  /**
   * The start was refused before anything ran: no turn, no new feed line —
   * the question stays in the input (AI-099). The feed is as it was: a failed
   * attempt this turn was a retry of keeps its line and its «Повторить».
   */
  abandon(sessionId: string, turnId: string): CoachSession | null {
    const session = this.byId(sessionId);
    if (session === null || session.pending === null || session.pending.turnId !== turnId) return null;
    const next: CoachSession = { ...session, pending: null, feed: session.pending.feedBefore };
    this.replace(next);
    return next;
  }

  /** Every session, least recently used first (archived ones included). */
  all(): readonly CoachSession[] {
    return this.sessions;
  }

  byId(sessionId: string): CoachSession | null {
    return this.sessions.find((session) => session.sessionId === sessionId) ?? null;
  }

  /** The session whose pending turn runs this operation. */
  byOp(opId: string): CoachSession | null {
    return this.sessions.find((session) => session.pending?.opId === opId) ?? null;
  }

  /** AI-089: a change of persona, account or sign-in wipes the dialogs it belonged to (all, when no filter is given). */
  reset(filter?: (session: CoachSession) => boolean): number {
    const before = this.sessions.length;
    this.sessions = filter === undefined ? [] : this.sessions.filter((session) => !filter(session));
    return before - this.sessions.length;
  }

  bytes(): number {
    return this.sessions.reduce((sum, session) => sum + sessionBytes(session), 0);
  }

  private touch(sessionId: string): void {
    const session = this.byId(sessionId);
    if (session === null) return;
    this.sessions = [...this.sessions.filter((other) => other.sessionId !== sessionId), session];
  }

  private replace(next: CoachSession): void {
    this.sessions = this.sessions.map((session) => (session.sessionId === next.sessionId ? next : session));
  }

  /** The three caps, cheapest loss first: old exchanges of a long session, then whole sessions least recently used. */
  private enforce(): void {
    this.sessions = this.sessions.map((session) => {
      const exchanges = session.feed.filter((item) => item.kind === 'exchange').length;
      if (exchanges <= this.limits.exchanges) return session;
      let drop = exchanges - this.limits.exchanges;
      return { ...session, feed: session.feed.filter((item) => item.kind !== 'exchange' || drop-- <= 0) };
    });
    const evictable = (session: CoachSession): boolean => session.pending === null;
    while (this.sessions.length > this.limits.sessions) {
      const victim = this.sessions.find((session) => session.archived && evictable(session)) ?? this.sessions.find(evictable);
      if (victim === undefined) break;
      this.sessions = this.sessions.filter((session) => session.sessionId !== victim.sessionId);
    }
    while (this.bytes() > this.limits.totalBytes) {
      const victim = this.sessions.find((session) => session.archived && evictable(session)) ?? (this.sessions.length > 1 ? this.sessions.find(evictable) : undefined);
      if (victim !== undefined) {
        this.sessions = this.sessions.filter((session) => session.sessionId !== victim.sessionId);
        continue;
      }
      // One session left and still too big: its oldest exchange goes.
      const last = this.sessions[0];
      const oldest = last?.feed.find((item) => item.kind === 'exchange');
      if (last === undefined || oldest === undefined) break;
      this.replace({ ...last, feed: last.feed.filter((item) => item !== oldest) });
    }
  }
}

/** The exchanges of a session, oldest first. */
export function exchangesOf(session: CoachSession): CoachExchange[] {
  return session.feed.filter((item): item is CoachExchange => item.kind === 'exchange');
}

/** AI-088: what the next question carries as `coachHistory`. */
export function historyFor(session: CoachSession, limit: number): CoachTurn[] {
  return serializeCoachHistory(exchangesOf(session), limit);
}

/** AI-094: turns above the memory boundary — finished exchanges that are no longer replayed. */
export function outsideMemory(session: CoachSession, limit: number): ReadonlySet<string> {
  const exchanges = exchangesOf(session);
  const kept = replayedCount(exchanges, limit);
  return new Set(exchanges.slice(0, Math.max(0, exchanges.length - kept)).map((exchange) => exchange.turnId));
}
