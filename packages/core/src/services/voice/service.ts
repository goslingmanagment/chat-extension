// The voice notes of the background (1.47.0; contracts voice.ts): one
// session per chat — its draft, its script and the takes of it — kept in
// storage.local, so a reload, a closed tab or a restarted browser keeps what
// the person paid for; the script through the shared scheduler; the paid
// takes; their state until it settles; the checked MP3.
//
// A take is the one paid step. It is written to storage BEFORE the hub is
// asked (`voiceNoteCreate`, its id the hub's `clientRequestId`), and it is
// never asked again by itself: an answer that does not come leaves it
// `uncertain`, and only the person's «Проверить» asks again — with the same
// id, which the hub answers with the note it already has (or admits once).
// A refusal the hub states (quota, script, a switch) spent nothing. Reads
// (status, audio) are free and are repeated with a growing pause.
//
// The sessions are the signed-in person's: another sign-in finds none of the
// previous one's (their notes are not that person's to read).
//
// 1.49.0: what a page may still voice today (`voiceNoteAllowance`), for the
// studio's line beside «Озвучить» — a free read, kept a few seconds, read
// again once a take of the page moves. It decides nothing: the hub refuses a
// take over the limit itself and charges nothing.

import type { CgCode, CgErrorWire } from '@cg/contracts/errors';
import type { ChatRef, HumanCause } from '@cg/contracts/ids';
import { chatKeyOf } from '@cg/contracts/ids';
import {
  VOICE_LIMITS,
  VOICE_TONE_REPLY,
  VOICE_TONES,
  VoiceSessionSchema,
  type VoiceAllowance,
  type VoiceAllowanceQuery,
  type VoiceAudio,
  type VoiceNoteCreateRequest,
  type VoiceNoteRef,
  type VoiceNoteView,
  type VoiceOpView,
  type VoiceScriptStartWire,
  type VoiceSession,
  type VoiceTake,
  type VoiceTone,
  type VoiceWriteResult,
} from '@cg/contracts/voice';
import { bytesToBase64, canonicalVoiceScript, looksLikeMp3, readNoteView, takeMayMove, voiceScriptIssue } from '../../domain/voice';
import type { StartOutcome } from '../scheduler';
import type { KeyValuePort, ServiceLog } from '../storage/ports';

/** The storage.local key of the sessions (budgets.ts). */
export const VOICE_SESSIONS_KEY = 'voice.sessions';

/** The hub's voice routes, through the facade. */
export interface VoiceHubPort {
  create(request: VoiceNoteCreateRequest): Promise<VoiceNoteView>;
  status(ref: VoiceNoteRef): Promise<VoiceNoteView>;
  audio(ref: VoiceNoteRef): Promise<ArrayBuffer>;
  /** 1.49.0: what the page may still voice today. */
  allowance(query: VoiceAllowanceQuery): Promise<VoiceAllowance>;
}

/**
 * How a failed hub call reads: its error, and whether the request reached the hub. `no` — the hub layer refused it
 * itself (a switch, a capability, the page); `refused` — the hub answered a refusal (nothing was admitted or spent);
 * `unknown` — no answer that says so (a lost connection, a timeout, an unreadable answer, a server failure).
 */
export interface VoiceFailure {
  readonly error: CgErrorWire;
  readonly reached: 'no' | 'refused' | 'unknown';
}

/** The page of a request's sender, as the core checks it (granted, and the tab's own binding). */
export type VoicePageLookup =
  | { readonly ok: true; readonly page: { readonly pageId: number; readonly pageLabel: string; readonly platform: string } }
  | { readonly ok: false; readonly code: CgCode };

export interface VoiceServiceDeps<S> {
  readonly now: () => number;
  readonly ids: { uuid(): string };
  readonly timers: { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void };
  readonly store: KeyValuePort;
  readonly hub: VoiceHubPort;
  readonly failure: (error: unknown) => VoiceFailure;
  readonly page: (pageId: number, sender: S) => Promise<VoicePageLookup>;
  /** The label of a granted page for the background's own reads (no tab asks); null — not granted now. */
  readonly pageLabel: (pageId: number) => string | null;
  /** The tab session of a sender; null — not a tab. */
  readonly tabOf: (sender: S) => string | null;
  /** Spends the click's token (kind `generate`, surface `dock`) of that tab; false — not a click of ours. */
  readonly redeem: (tabSessionId: string, cause: HumanCause) => boolean;
  /** The shared scheduler: the voice script's start and its kept view. */
  readonly ops: {
    start(tabSessionId: string, start: VoiceScriptStartWire): Promise<StartOutcome>;
    view(opId: string): VoiceOpView | null;
  };
  /** Who is signed in: the sessions are theirs; null — nobody. */
  readonly owner: () => { readonly hubOrigin: string; readonly userId: number } | null;
  readonly emit: (change: { readonly chat: ChatRef; readonly conversationRef: string; readonly session: VoiceSession | null }) => void;
  readonly sha256: (bytes: ArrayBuffer) => Promise<string>;
  readonly log: ServiceLog;
}

interface Stored {
  readonly v: 1;
  readonly owner: { readonly hubOrigin: string; readonly userId: number } | null;
  readonly sessions: readonly unknown[];
}

/** A page's day allowance as the hub last said (null — the read failed): when, and in which round of the page's takes. */
interface KeptAllowance {
  readonly value: VoiceAllowance | null;
  readonly at: number;
  readonly round: number;
}

/** A take's free status reads: a pause that grows with each failure, and a time after which nobody waits by itself. */
interface PollState {
  failures: number;
  nextAt: number;
}

/** A take in flight longer than this is not read by itself any more: «Проверить» is the person's (the hub's lease is 2 min). */
const WAIT_BY_ITSELF_MS = 15 * 60_000;
/** The MP3s handed out lately, kept in memory so a replay or an attach does not download again. */
const AUDIO_CACHE = 8;

const fail = (code: CgCode, session: VoiceSession | null = null): VoiceWriteResult => ({ ok: false, error: { code }, session });

export class VoiceService<S> {
  private sessions = new Map<string, VoiceSession>();
  private owner: Stored['owner'] = null;
  private loaded: Promise<void> | null = null;
  /** One write after another: a write reads the sessions as the last one left them. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Takes whose create this background is asking right now: a `creating` take not here was asked by an earlier one. */
  private readonly inFlight = new Set<string>();
  private readonly polls = new Map<string, PollState>();
  private pollTimer: unknown = null;
  private readonly audioCache = new Map<string, VoiceAudio>();
  /** 1.49.0: the pages' day allowances, by pageId. */
  private readonly allowances = new Map<number, KeptAllowance>();
  /** Grows each time a take of the page moves: an allowance read before that is older than the move. */
  private readonly allowanceRounds = new Map<number, number>();
  /** The read of a page's allowance on its way, one at a time. */
  private readonly allowanceReads = new Map<number, { readonly round: number; readonly read: Promise<VoiceAllowance | null> }>();

  constructor(private readonly deps: VoiceServiceDeps<S>) {}

  // ── reads ────────────────────────────────────────────────────────────────

  async read(sender: S, pageId: number, conversationRef: string): Promise<{ readonly session: VoiceSession | null }> {
    const page = await this.deps.page(pageId, sender);
    if (!page.ok) return { session: null };
    await this.ready();
    return { session: this.byChat(pageId, conversationRef) };
  }

  /** The background woke: the sessions are read, an earlier background's open creates turn uncertain, reads go on. */
  async resume(): Promise<void> {
    await this.ready();
  }

  // ── the day's allowance (1.49.0) ─────────────────────────────────────────

  /**
   * What the sender's page may still voice today: kept for `VOICE_LIMITS.allowanceTtlMs`, read from the hub again
   * once a take of the page moved; one read of a page at a time. A failure reads as not known (null), never as an
   * error of the studio; nothing paid is ever asked by it.
   */
  async allowance(sender: S, pageId: number): Promise<{ readonly allowance: VoiceAllowance | null }> {
    const page = await this.deps.page(pageId, sender);
    if (!page.ok) return { allowance: null };
    await this.ready();
    return { allowance: await this.allowanceOf(pageId, page.page.pageLabel) };
  }

  private allowanceOf(pageId: number, pageLabel: string): Promise<VoiceAllowance | null> {
    const round = this.allowanceRounds.get(pageId) ?? 0;
    const kept = this.allowances.get(pageId);
    if (kept !== undefined && kept.round === round && this.deps.now() - kept.at < VOICE_LIMITS.allowanceTtlMs) return Promise.resolve(kept.value);
    const pending = this.allowanceReads.get(pageId);
    if (pending !== undefined && pending.round === round) return pending.read;
    const read = this.readAllowance(pageId, pageLabel, round);
    this.allowanceReads.set(pageId, { round, read });
    return read;
  }

  private async readAllowance(pageId: number, pageLabel: string, round: number): Promise<VoiceAllowance | null> {
    let value: VoiceAllowance | null = null;
    try {
      value = await this.deps.hub.allowance({ pageLabel });
    } catch (error) {
      this.log('info', 'voice allowance not known', this.deps.failure(error).error.code);
    }
    // A take of the page moved while the read was on its way: its answer may be older than the move, so it is not kept.
    if ((this.allowanceRounds.get(pageId) ?? 0) === round) this.allowances.set(pageId, { value, at: this.deps.now(), round });
    if (this.allowanceReads.get(pageId)?.round === round) this.allowanceReads.delete(pageId);
    return value;
  }

  /** A take of the page moved (the hub answered its create, or it settled): the next read of the allowance asks the hub. */
  private allowanceMoved(pageId: number): void {
    this.allowanceRounds.set(pageId, (this.allowanceRounds.get(pageId) ?? 0) + 1);
    this.allowances.delete(pageId);
  }

  // ── the script ───────────────────────────────────────────────────────────

  script(sender: S, start: VoiceScriptStartWire, sessionId: string | null): Promise<VoiceWriteResult> {
    return this.serial(async () => {
      const tab = this.deps.tabOf(sender);
      if (tab === null) return fail('CG-UI-FAILED');
      const page = await this.deps.page(start.target.binding.pageId, sender);
      if (!page.ok) return fail(page.code);
      await this.ready();
      const tone = toneOf(start.tone);
      if (tone === null) return fail('CG-UI-FAILED');
      const { pageId } = start.target.binding;
      const existing = this.byChat(pageId, start.target.conversationRef);
      // The tab named a session that is no longer the chat's (another tab started anew): it reads the chat again.
      if (sessionId !== null && existing?.sessionId !== sessionId) return fail('CG-CONTEXT-CHANGED', existing);
      if (existing !== null && sessionId !== null && existing.writing !== null) return fail('CG-OP-CHAT-BUSY', existing);
      const outcome = await this.deps.ops.start(tab, start);
      if (outcome.kind === 'refused') return fail(outcome.code, existing);
      if (!outcome.admission.ok) return fail(outcome.admission.code, existing);
      const opId = outcome.admission.opId;
      const now = this.deps.now();
      const base: VoiceSession =
        sessionId === null || existing === null
          ? {
              sessionId: this.deps.ids.uuid(),
              pageId,
              chat: start.target.chat,
              conversationRef: start.target.conversationRef,
              fanRef: start.target.fanRef,
              createdAt: now,
              updatedAt: now,
              revision: 0,
              draft: start.draft.text.slice(0, VOICE_LIMITS.draftMaxChars),
              script: null,
              writing: null,
              error: null,
              takes: [],
            }
          : existing;
      const next: VoiceSession = { ...base, draft: start.draft.text.slice(0, VOICE_LIMITS.draftMaxChars), writing: { opId, tone, startedAt: now }, error: null };
      const replaced = existing !== null && existing.sessionId !== next.sessionId ? existing : null;
      const saved = await this.put(next, replaced);
      if (!saved.ok) return saved;
      // A start that reopened a script already written (the same draft and tone, kept by the scheduler) is done now.
      const view = this.deps.ops.view(opId);
      if (view !== null && isTerminal(view.state)) return this.applyScript(view);
      return saved;
    });
  }

  /** The scheduler ended a `voice-script` operation: its session takes the script, or says why not. */
  scriptDone(view: VoiceOpView): void {
    void this.serial(() => this.applyScript(view));
  }

  private async applyScript(view: VoiceOpView): Promise<VoiceWriteResult> {
    await this.ready();
    const session = [...this.sessions.values()].find((candidate) => candidate.writing?.opId === view.opId) ?? null;
    if (session === null || session.writing === null) return fail('CG-CONTEXT-CHANGED');
    const writing = session.writing;
    let next: VoiceSession;
    if (view.state === 'done' && view.result !== undefined && view.generationRef !== undefined) {
      next = { ...session, writing: null, error: null, script: { tone: writing.tone, generationRef: view.generationRef, original: view.result.script, edited: null } };
    } else if (view.state === 'canceled') {
      next = { ...session, writing: null, error: null };
    } else {
      // A failure keeps the script there was: a rewrite that did not happen loses nothing.
      next = { ...session, writing: null, error: view.error === null || view.error === undefined ? { code: 'CG-OP-INTERRUPTED' } : { code: view.error.code } };
    }
    return this.put(next);
  }

  edit(sender: S, sessionId: string, text: string): Promise<VoiceWriteResult> {
    return this.serial(async () => {
      const found = await this.ownSession(sender, sessionId);
      if (!found.ok) return found.result;
      const session = found.session;
      if (session.script === null) return fail('CG-CONTEXT-CHANGED', session);
      const edited = canonicalVoiceScript(text) === canonicalVoiceScript(session.script.original) ? null : text;
      if (edited === session.script.edited) return { ok: true, session };
      return this.put({ ...session, script: { ...session.script, edited } });
    });
  }

  // ── takes ────────────────────────────────────────────────────────────────

  take(sender: S, sessionId: string, takeId: string, script: string, cause: HumanCause): Promise<VoiceWriteResult> {
    return this.serial(async () => {
      const tab = this.deps.tabOf(sender);
      if (tab === null) return fail('CG-UI-FAILED');
      const found = await this.ownSession(sender, sessionId);
      if (!found.ok) return found.result;
      const session = found.session;
      // The same click twice (a double click, a repeated message): the take it made, nothing new.
      if (session.takes.some((take) => take.takeId === takeId)) return { ok: true, session };
      if (!this.deps.redeem(tab, cause)) return fail('CG-UI-FAILED', session);
      if (session.script === null) return fail('CG-CONTEXT-CHANGED', session);
      if (session.writing !== null) return fail('CG-OP-CHAT-BUSY', session);
      if (session.takes.length >= VOICE_LIMITS.takesPerSession) return fail('CG-UI-FAILED', session);
      const canonical = canonicalVoiceScript(script);
      // What the hub refuses for certain is not asked at all; its own cap of characters is its to say (a setting).
      const issue = voiceScriptIssue(canonical, VOICE_LIMITS.scriptMaxChars);
      if (issue !== null) return fail('CG-VOICE-SCRIPT', session);
      const take: VoiceTake = {
        takeId,
        createdAt: this.deps.now(),
        script: canonical,
        sourceGenerationRef: session.script.generationRef,
        state: 'creating',
        voiceNoteId: null,
        audio: null,
        billed: null,
        error: null,
        attached: null,
      };
      const edited = canonical === canonicalVoiceScript(session.script.original) ? null : script;
      // Written before the hub is asked: a create that leaves no trace here is never paid for unseen.
      const saved = await this.put({ ...session, script: { ...session.script, edited }, takes: [...session.takes, take] });
      if (!saved.ok) return saved;
      this.inFlight.add(takeId);
      void this.create(session.sessionId, takeId);
      return saved;
    });
  }

  /**
   * «Проверить»: a take whose create got no answer is asked again with the same id (the hub answers the note it has,
   * or admits it once — the person's click, never this service by itself); one the hub knows is read (free).
   */
  check(sender: S, sessionId: string, takeId: string, cause: HumanCause): Promise<VoiceWriteResult> {
    return this.serial(async () => {
      const tab = this.deps.tabOf(sender);
      if (tab === null) return fail('CG-UI-FAILED');
      const found = await this.ownSession(sender, sessionId);
      if (!found.ok) return found.result;
      const session = found.session;
      const take = session.takes.find((candidate) => candidate.takeId === takeId);
      if (take === undefined) return fail('CG-CONTEXT-CHANGED', session);
      if (!this.deps.redeem(tab, cause)) return fail('CG-UI-FAILED', session);
      if (this.inFlight.has(takeId)) return { ok: true, session };
      if (take.voiceNoteId === null && (take.state === 'uncertain' || take.state === 'creating')) {
        const saved = await this.put(withTake(session, { ...take, state: 'creating', error: null }));
        if (!saved.ok) return saved;
        this.inFlight.add(takeId);
        void this.create(session.sessionId, takeId);
        return saved;
      }
      if (take.voiceNoteId !== null) {
        this.polls.delete(takeId);
        void this.readStatus(session.sessionId, takeId);
      }
      return { ok: true, session };
    });
  }

  /** The person's «Прикрепить» as the composer showed it: in the field, or handed over and not seen. */
  attached(sender: S, sessionId: string, takeId: string, state: 'attached' | 'unknown'): Promise<VoiceWriteResult> {
    return this.serial(async () => {
      const found = await this.ownSession(sender, sessionId);
      if (!found.ok) return found.result;
      const take = found.session.takes.find((candidate) => candidate.takeId === takeId);
      if (take === undefined) return fail('CG-CONTEXT-CHANGED', found.session);
      return this.put(withTake(found.session, { ...take, attached: { state, at: this.deps.now() } }));
    });
  }

  discard(sender: S, sessionId: string): Promise<{ readonly discarded: boolean }> {
    return this.serial(async () => {
      const found = await this.ownSession(sender, sessionId);
      if (!found.ok) return { discarded: false };
      const session = found.session;
      this.sessions.delete(session.sessionId);
      for (const take of session.takes) {
        this.audioCache.delete(take.takeId);
        this.polls.delete(take.takeId);
      }
      if (!(await this.persist())) {
        this.sessions.set(session.sessionId, session);
        return { discarded: false };
      }
      this.deps.emit({ chat: session.chat, conversationRef: session.conversationRef, session: null });
      return { discarded: true };
    });
  }

  /** «Очистить локальные данные»: every session goes (the hub keeps the audio). */
  clear(): Promise<void> {
    return this.serial(async () => {
      await this.ready();
      const gone = [...this.sessions.values()];
      this.sessions.clear();
      this.audioCache.clear();
      this.polls.clear();
      this.allowances.clear();
      await this.persist();
      for (const session of gone) this.deps.emit({ chat: session.chat, conversationRef: session.conversationRef, session: null });
    });
  }

  // ── audio ────────────────────────────────────────────────────────────────

  /** A ready take's MP3, checked against the hub's sha256 and length and read as an MP3 before anyone plays or attaches it. */
  async audio(sender: S, sessionId: string, takeId: string): Promise<{ readonly ok: true; readonly audio: VoiceAudio } | { readonly ok: false; readonly error: CgErrorWire }> {
    const found = await this.ownSession(sender, sessionId);
    if (!found.ok) return { ok: false, error: found.result.ok ? { code: 'CG-UNKNOWN' } : found.result.error };
    const take = found.session.takes.find((candidate) => candidate.takeId === takeId);
    if (take === undefined || take.state !== 'ready' || take.audio === null || take.voiceNoteId === null) return { ok: false, error: { code: 'CG-CONTEXT-CHANGED' } };
    const cached = this.audioCache.get(takeId);
    if (cached !== undefined) {
      this.audioCache.delete(takeId);
      this.audioCache.set(takeId, cached);
      return { ok: true, audio: cached };
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await this.deps.hub.audio({ pageLabel: found.pageLabel, voiceNoteId: take.voiceNoteId });
    } catch (error) {
      const failure = this.deps.failure(error);
      if (failure.error.code === 'CG-VOICE-EXPIRED') void this.serial(() => this.markTake(sessionId, takeId, (current) => ({ ...current, state: 'expired', error: { code: 'CG-VOICE-EXPIRED' } })));
      return { ok: false, error: failure.error };
    }
    const expected = take.audio;
    const sha = bytes.byteLength === expected.bytes ? await this.deps.sha256(bytes) : null;
    if (sha !== expected.sha256 || !looksLikeMp3(new Uint8Array(bytes))) {
      this.deps.log({ level: 'warn', scope: 'bg.voice', msg: 'audio does not match its note', code: 'CG-VOICE-CORRUPT', fields: { bytes: bytes.byteLength, expected: expected.bytes } });
      return { ok: false, error: { code: 'CG-VOICE-CORRUPT' } };
    }
    const audio: VoiceAudio = { mime: 'audio/mpeg', base64: bytesToBase64(new Uint8Array(bytes)), sha256: expected.sha256, bytes: expected.bytes };
    this.audioCache.set(takeId, audio);
    while (this.audioCache.size > AUDIO_CACHE) this.audioCache.delete(this.audioCache.keys().next().value as string);
    return { ok: true, audio };
  }

  // ── the hub ──────────────────────────────────────────────────────────────

  /** The one create of a take, or the person's second one with the same id. Its answer is written; none is never retried. */
  private async create(sessionId: string, takeId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const take = session?.takes.find((candidate) => candidate.takeId === takeId);
    if (session === undefined || take === undefined) {
      this.inFlight.delete(takeId);
      return;
    }
    let view: VoiceNoteView | null = null;
    let failure: VoiceFailure | null = null;
    try {
      const pageLabel = this.deps.pageLabel(session.pageId);
      if (pageLabel === null) failure = { error: { code: 'CG-BINDING-NOT-GRANTED' }, reached: 'no' };
      else {
        view = await this.deps.hub.create({
          pageLabel,
          body: {
            clientRequestId: take.takeId,
            conversationRef: session.conversationRef,
            // On Fansly the fan is named apart from the group (HF-4а); on OnlyFans the chat is the fan.
            ...(session.fanRef === session.conversationRef ? {} : { fanRef: session.fanRef }),
            sourceGenerationRef: take.sourceGenerationRef,
            script: take.script,
          },
        });
      }
    } catch (error) {
      failure = this.deps.failure(error);
    }
    this.inFlight.delete(takeId);
    // Whatever the hub answered (admitted, refused) — or did not — its count of the page's day may have moved; before
    // the tabs hear of the take, so that their read of the allowance follows it.
    this.allowanceMoved(session.pageId);
    await this.serial(() =>
      this.markTake(sessionId, takeId, (current) => {
        if (view !== null) {
          const reading = readNoteView(view);
          return { ...current, voiceNoteId: view.voiceNoteId, state: reading.state, error: reading.error, billed: reading.billed, audio: reading.audio };
        }
        const read = failure ?? { error: { code: 'CG-UNKNOWN' }, reached: 'unknown' as const };
        // A refusal said by the hub (or by our hub layer before any request) spent nothing; anything else may have.
        return read.reached === 'unknown'
          ? { ...current, state: 'uncertain', error: { code: 'CG-VOICE-UNCERTAIN', ...(read.error.detail === undefined ? {} : { detail: read.error.detail }) }, billed: null }
          : { ...current, state: 'refused', error: read.error, billed: false };
      }),
    );
    this.log(view === null ? 'warn' : 'info', view === null ? 'voice take not admitted' : 'voice take admitted', failure?.error.code, { reached: failure?.reached ?? 'yes' });
    this.schedulePoll(VOICE_LIMITS.pollMs);
  }

  /** One free read of a take's state; a failure waits longer before the next one. */
  private async readStatus(sessionId: string, takeId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const take = session?.takes.find((candidate) => candidate.takeId === takeId);
    if (session === undefined || take === undefined || take.voiceNoteId === null) return;
    const voiceNoteId = take.voiceNoteId;
    try {
      const pageLabel = this.deps.pageLabel(session.pageId);
      if (pageLabel === null) throw new Error('page not granted');
      const view = await this.deps.hub.status({ pageLabel, voiceNoteId });
      this.polls.delete(takeId);
      // A take that settled (rendered, failed and given back, expired): the page's day as the hub counts it moved.
      if (readNoteView(view).state !== take.state) this.allowanceMoved(session.pageId);
      await this.serial(() =>
        this.markTake(sessionId, takeId, (current) => {
          const reading = readNoteView(view);
          if (!takeMayMove(current.state, reading.state)) return current;
          return { ...current, state: reading.state, error: reading.error, billed: reading.billed ?? current.billed, audio: reading.audio ?? current.audio };
        }),
      );
    } catch (error) {
      const failure = this.deps.failure(error);
      const poll = this.polls.get(takeId) ?? { failures: 0, nextAt: 0 };
      poll.failures += 1;
      poll.nextAt = this.deps.now() + Math.min(VOICE_LIMITS.pollMaxMs, VOICE_LIMITS.pollMs * 2 ** poll.failures);
      this.polls.set(takeId, poll);
      if (failure.error.code === 'CG-VOICE-EXPIRED') await this.serial(() => this.markTake(sessionId, takeId, (current) => ({ ...current, state: 'expired', error: { code: 'CG-VOICE-EXPIRED' } })));
    }
  }

  private schedulePoll(ms: number): void {
    if (this.pollTimer !== null) return;
    if (!this.hasWork()) return;
    this.pollTimer = this.deps.timers.set(() => {
      this.pollTimer = null;
      void this.pollOnce();
    }, ms);
  }

  private hasWork(): boolean {
    for (const session of this.sessions.values()) for (const take of session.takes) if (take.state === 'working' && take.voiceNoteId !== null) return true;
    return false;
  }

  private async pollOnce(): Promise<void> {
    const now = this.deps.now();
    const due: [string, string][] = [];
    for (const session of this.sessions.values()) {
      for (const take of session.takes) {
        if (take.state !== 'working' || take.voiceNoteId === null) continue;
        if (now - take.createdAt > WAIT_BY_ITSELF_MS) {
          // Nobody waits by itself any longer: the take says so, «Проверить» reads it again.
          await this.serial(() => this.markTake(session.sessionId, take.takeId, (current) => ({ ...current, state: 'uncertain', error: { code: 'CG-VOICE-UNCERTAIN' } })));
          continue;
        }
        if ((this.polls.get(take.takeId)?.nextAt ?? 0) > now) continue;
        due.push([session.sessionId, take.takeId]);
      }
    }
    for (const [sessionId, takeId] of due) await this.readStatus(sessionId, takeId);
    this.schedulePoll(VOICE_LIMITS.pollMs);
  }

  // ── storage ──────────────────────────────────────────────────────────────

  private ready(): Promise<void> {
    const owner = this.deps.owner();
    if (this.loaded === null) this.loaded = this.load();
    return this.loaded.then(async () => {
      // Another person signed in: the sessions were the previous one's, and their notes are not this one's to read.
      if (owner !== null && !sameOwner(owner, this.owner)) {
        this.sessions.clear();
        this.audioCache.clear();
        this.polls.clear();
        this.allowances.clear();
        this.owner = owner;
        await this.persist();
      }
    });
  }

  private async load(): Promise<void> {
    const answer = await this.deps.store.get([VOICE_SESSIONS_KEY]);
    if (!answer.ok) {
      this.log('warn', 'voice sessions unreadable', answer.code);
      return;
    }
    const raw = answer.value[VOICE_SESSIONS_KEY] as Partial<Stored> | undefined;
    if (raw === undefined || raw.v !== 1 || !Array.isArray(raw.sessions)) return;
    this.owner = raw.owner ?? null;
    const now = this.deps.now();
    let changed = false;
    for (const value of raw.sessions) {
      const parsed = VoiceSessionSchema.safeParse(value);
      if (!parsed.success || now - parsed.data.updatedAt > VOICE_LIMITS.sessionTtlMs) {
        changed = true;
        continue;
      }
      let session = parsed.data;
      // A create an earlier background was asking: its answer is lost with it — uncertain, never asked again by itself.
      if (session.takes.some((take) => take.state === 'creating')) {
        session = { ...session, takes: session.takes.map((take) => (take.state === 'creating' ? { ...take, state: 'uncertain', error: { code: 'CG-VOICE-UNCERTAIN' } } : take)) };
        changed = true;
      }
      // A script an earlier background was writing: the scheduler keeps its end, or it was interrupted.
      if (session.writing !== null) {
        const view = this.deps.ops.view(session.writing.opId);
        if (view === null || isTerminal(view.state)) {
          session = { ...session, writing: null, error: view === null ? { code: 'CG-OP-INTERRUPTED' } : session.error };
          if (view !== null && view.state === 'done' && view.result !== undefined && view.generationRef !== undefined) {
            session = { ...session, error: null, script: { tone: session.writing?.tone ?? 'calm', generationRef: view.generationRef, original: view.result.script, edited: null } };
          }
          changed = true;
        }
      }
      this.sessions.set(session.sessionId, session);
    }
    if (changed) await this.persist();
    this.schedulePoll(0);
  }

  /** Keeps a session (and drops the one it replaces): the sessions in storage, then the tabs told. */
  private async put(session: VoiceSession, replaced: VoiceSession | null = null): Promise<VoiceWriteResult> {
    const next: VoiceSession = { ...session, updatedAt: this.deps.now(), revision: session.revision + 1 };
    const before = this.sessions.get(session.sessionId) ?? null;
    if (replaced !== null) this.sessions.delete(replaced.sessionId);
    this.sessions.set(next.sessionId, next);
    this.trim();
    if (!(await this.persist())) {
      // Not kept: the memory follows the storage, and nothing that needed the write (a paid create) happens.
      if (before === null) this.sessions.delete(next.sessionId);
      else this.sessions.set(before.sessionId, before);
      if (replaced !== null) this.sessions.set(replaced.sessionId, replaced);
      return fail('CG-STORAGE-WRITE', before);
    }
    if (replaced !== null) this.deps.emit({ chat: replaced.chat, conversationRef: replaced.conversationRef, session: null });
    this.deps.emit({ chat: next.chat, conversationRef: next.conversationRef, session: next });
    return { ok: true, session: next };
  }

  /** The least recently touched sessions beyond the cap go; a session with a take in flight stays. */
  private trim(): void {
    if (this.sessions.size <= VOICE_LIMITS.sessions) return;
    const idle = [...this.sessions.values()].filter((session) => !session.takes.some((take) => take.state === 'creating' || take.state === 'working')).sort((a, b) => a.updatedAt - b.updatedAt);
    while (this.sessions.size > VOICE_LIMITS.sessions && idle.length > 0) this.sessions.delete(idle.shift()!.sessionId);
  }

  private async persist(): Promise<boolean> {
    const value: Stored = { v: 1, owner: this.owner, sessions: [...this.sessions.values()] };
    const answer = await this.deps.store.set({ [VOICE_SESSIONS_KEY]: value });
    if (!answer.ok) this.log('error', 'voice sessions not written', answer.code);
    return answer.ok;
  }

  private async markTake(sessionId: string, takeId: string, change: (take: VoiceTake) => VoiceTake): Promise<VoiceWriteResult> {
    const session = this.sessions.get(sessionId);
    const take = session?.takes.find((candidate) => candidate.takeId === takeId);
    if (session === undefined || take === undefined) return fail('CG-CONTEXT-CHANGED');
    const next = change(take);
    if (next === take) return { ok: true, session };
    return this.put(withTake(session, next));
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private byChat(pageId: number, conversationRef: string): VoiceSession | null {
    for (const session of this.sessions.values()) if (session.pageId === pageId && session.conversationRef === conversationRef) return session;
    return null;
  }

  /** A session of the sender's own page, or why not. */
  private async ownSession(sender: S, sessionId: string): Promise<{ readonly ok: true; readonly session: VoiceSession; readonly pageLabel: string } | { readonly ok: false; readonly result: VoiceWriteResult }> {
    await this.ready();
    const session = this.sessions.get(sessionId) ?? null;
    if (session === null) return { ok: false, result: fail('CG-CONTEXT-CHANGED') };
    const page = await this.deps.page(session.pageId, sender);
    if (!page.ok) return { ok: false, result: fail(page.code, null) };
    return { ok: true, session, pageLabel: page.page.pageLabel };
  }

  private log(level: 'info' | 'warn' | 'error', msg: string, code?: CgCode, fields?: Readonly<Record<string, string | number | boolean | null>>): void {
    this.deps.log({ level, scope: 'bg.voice', msg, ...(code === undefined ? {} : { code }), ...(fields === undefined ? {} : { fields }) });
  }
}

function withTake(session: VoiceSession, take: VoiceTake): VoiceSession {
  return { ...session, takes: session.takes.map((candidate) => (candidate.takeId === take.takeId ? take : candidate)) };
}

function toneOf(tone: VoiceScriptStartWire['tone']): VoiceTone | null {
  return VOICE_TONES.find((preset) => VOICE_TONE_REPLY[preset] === tone) ?? null;
}

function isTerminal(state: VoiceOpView['state']): boolean {
  return state === 'done' || state === 'failed' || state === 'canceled' || state === 'interrupted';
}

function sameOwner(a: { readonly hubOrigin: string; readonly userId: number }, b: Stored['owner']): boolean {
  return b !== null && a.hubOrigin === b.hubOrigin && a.userId === b.userId;
}

/** The chat a session is of, as the tabs key it. */
export function voiceChatKey(session: Pick<VoiceSession, 'chat'>): string {
  return chatKeyOf(session.chat);
}
