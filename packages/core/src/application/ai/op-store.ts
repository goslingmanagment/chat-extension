// The tab's mirror of AI operations (architecture.md §5.4 `op.update` /
// `op.done`, §7; AI-124, AI-127, AI-128, AI-137). Operations live in the
// background: this store only starts them, follows them and remembers what
// the tab needs to show them. A start answers with an operation id — a new
// one, the running one of the same request (AI-127), or a cached result
// (AI-128). Stream text arrives in 50 ms batches numbered per operation; the
// terminal view replaces it, and only its result can be acted on. A chat
// switch changes nothing here: records are kept by operation, so a result
// waits for its chat (AI-124).
//
// Events of an operation may arrive before the answer to its `op.start`
// (the background emits the first batch while it still handles the start):
// they wait in a small buffer. An admitted id that came with no event is an
// operation this tab session did not start — another tab's cached result, a
// run that outlived a reload — and is read with `op.list`; batches that
// landed while that read was on its way are counted in (their text is in
// the answer), so the next batch is not taken for a gap. Two starts of one
// chat in flight at once (a double click) are told apart: the later one
// waits for the earlier before it decides whether its operation is new.
//
// A Coach turn with auto-recap is one start and two operations (§7 «один
// составной слот»): the admitted one is the recap step, and its terminal
// view names the answer step the background put into the chat's slot at the
// same moment (`OpView.continuedBy`). That one is this tab's own from its
// first event on — nothing is started for it from here.
//
// What the tab holds is bounded: results live 30 minutes and at most the
// tab's share of them, the early buffer and the followed chats are capped,
// and whoever keeps state by operation hears which ones were dropped.

import { type CgErrorWire } from '@cg/contracts/errors';
import { chatKeyOf, type ChatKey } from '@cg/contracts/ids';
import { OP_LIMITS, STORAGE_LIMITS } from '@cg/contracts/limits';
import { type Admission, type OpView, type StartOp } from '@cg/contracts/ops';
import { type TabEventPayload } from '@cg/contracts/tab-messages';

import { coachTurnSteps } from '../../domain/coach';
import { applyOpDone, applyOpUpdate, isNewerOpState, isTerminalOpState, mirrorFromView, newMirror, type OpMirror } from '../../domain/ops';
import { type RpcAnswer, type TabRpcPort, type TimerClock } from './ports';

type OpUpdate = TabEventPayload<'op.update'>;

/** What the tab remembers about a start beyond the view (never sent anywhere). */
export interface StartMemo {
  /** The Split snapshot of the start (a Hi result does not carry it). */
  readonly split: boolean;
  /** Fix: the person's draft the request was made from (text, revision, fingerprint). */
  readonly fixSource: { readonly text: string; readonly revision: number; readonly digest: string } | null;
  /**
   * The persona definition the operation was made under; null — not known to
   * this tab. Known for an operation this tab started or reopened (the
   * admission is for the same request, persona included) and for one adopted
   * while it still ran (the background cancels a run the moment its page's
   * persona changes, so a running one is of the current persona). A result
   * adopted already finished says nothing about its persona: it is never
   * inserted and never shown as the current persona's (§7 «Ограда», AI-126).
   * When the owner edits the persona (its key stays) the page's choice follows
   * its new definition, and so does this (`followPersona`): the same persona.
   */
  readonly personaDefinitionId: string | null;
  /**
   * What the site's AI policy keeps of the start's proof for the verdict on its result (`AiHostPolicy.fingerprint`,
   * R20 F10); null — nothing (ChatSpace, an operation this tab did not start). Never a text.
   */
  readonly fingerprint: unknown;
}

export interface OpRecord {
  /** The view as the tab knows it now: the state, phase and stream text of the batches, or the terminal view. */
  readonly view: OpView;
  readonly memo: StartMemo;
  /** This tab session started it (or took it over): its batches come here. */
  readonly own: boolean;
  /** The start answered with an already finished result (AI-128): when it was reopened. */
  readonly reopenedAt: number | null;
  /** A batch was missed: the stream preview is frozen until the terminal view. */
  readonly desynced: boolean;
}

export type StartOutcome =
  | { readonly kind: 'started'; readonly opId: string; readonly reopened: boolean }
  /** CG-OP-CHAT-BUSY or CG-OP-TAB-LIMIT with the running list; nothing was admitted. */
  | { readonly kind: 'refused'; readonly admission: Extract<Admission, { ok: false }> }
  | { readonly kind: 'error'; readonly error: CgErrorWire };

export type OpStoreEvent =
  | { readonly kind: 'changed'; readonly opId: string }
  /** The terminal view arrived (once per operation; the stale mark comes as `changed`). */
  | { readonly kind: 'done'; readonly record: OpRecord };

/** A page's persona the owner edited: its choice moved from one definition to another of the same key. */
export interface PersonaFollow {
  readonly pageId: number;
  readonly from: string;
  readonly to: string;
}

const NO_MEMO: StartMemo = { split: false, fixSource: null, personaDefinitionId: null, fingerprint: null };
const EARLY_OPS_MAX = 16;
const EARLY_EVENTS_MAX = 400;
/** Dropped operations remembered so that a later read of the background does not bring them back. */
const TOMBSTONES_MAX = 256;
/** Chats whose results this tab follows (terminal views of their other operations are adopted); the least recently used goes first. */
export const WATCHED_CHATS_MAX = 64;
/** A read that failed right after the port came back is made once more after this long. */
export const RESYNC_RETRY_MS = 2_000;

interface Entry {
  mirror: OpMirror;
  view: OpView;
  memo: StartMemo;
  /** A start of this tab made the record: the memo is that start's, and a later start of the same request keeps it. */
  readonly made?: true;
  own: boolean;
  reopenedAt: number | null;
  desynced: boolean;
}

type EarlyEvent = { readonly kind: 'update'; readonly update: OpUpdate } | { readonly kind: 'done'; readonly view: OpView };

/** An operation as it is the moment it was admitted, before any event of it. */
function admittedView(opId: string, start: Pick<StartOp, 'feature' | 'surface' | 'target' | 'tone'>, now: number): OpView {
  return { opId, feature: start.feature, surface: start.surface, target: start.target, state: 'admitted', phase: { name: 'admitted', since: now }, startedAt: now, toneUsed: start.tone };
}

export class OpStore {
  private readonly entries = new Map<string, Entry>();
  private readonly early = new Map<string, EarlyEvent[]>();
  private readonly watched = new Set<ChatKey>();
  private readonly inFlight = new Map<ChatKey, number>();
  /** The starts of a chat still being handled, as one chain: a later one may wait for the earlier. */
  private readonly starting = new Map<ChatKey, Promise<void>>();
  private readonly listeners = new Set<(event: OpStoreEvent) => void>();
  private readonly dropListeners = new Set<(opIds: readonly string[]) => void>();
  private resyncTimer: unknown = null;
  private readonly keepers = new Set<(opId: string) => boolean>();
  /** Operations a sign-in or persona change dropped, and when: the background may still list them for half an hour. */
  private readonly tombstones = new Map<string, number>();
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    private readonly rpc: TabRpcPort,
    private readonly clock: TimerClock,
    /** The persona definition assigned to a page now, as this tab knows it; null — not known. */
    private readonly personaOf: (pageId: number) => string | null = () => null,
  ) {
    this.unsubscribe.push(
      rpc.onEvent('op.update', (update) => this.onUpdate(update)),
      rpc.onEvent('op.done', ({ view }) => this.onDone(view)),
    );
  }

  dispose(): void {
    for (const off of this.unsubscribe.splice(0)) off();
    this.listeners.clear();
    this.dropListeners.clear();
    if (this.resyncTimer !== null) this.clock.clearTimer(this.resyncTimer);
    this.resyncTimer = null;
  }

  subscribe(listener: (event: OpStoreEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Results that left the store by age or by the tab's cap: whoever keeps state by operation drops it too. */
  onDropped(listener: (opIds: readonly string[]) => void): () => void {
    this.dropListeners.add(listener);
    return () => {
      this.dropListeners.delete(listener);
    };
  }

  /**
   * A result someone still shows (an answer of a Coach dialog) outlives the
   * 30-minute shelf: it is kept while a keeper asks for it.
   */
  keep(keeper: (opId: string) => boolean): () => void {
    this.keepers.add(keeper);
    return () => {
      this.keepers.delete(keeper);
    };
  }

  // ── reads ────────────────────────────────────────────────────────────────

  get(opId: string): OpRecord | null {
    const entry = this.entries.get(opId);
    return entry === undefined ? null : this.recordOf(entry);
  }

  /** Operations of one chat, newest first. */
  ofChat(chatKey: ChatKey): OpRecord[] {
    return this.all().filter((record) => chatKeyOf(record.view.target.chat) === chatKey);
  }

  /** Every known operation, newest first. */
  all(): OpRecord[] {
    return [...this.entries.values()].map((entry) => this.recordOf(entry)).sort((a, b) => b.view.startedAt - a.view.startedAt);
  }

  /** The operation running in a chat (one per chat across the extension), if this tab knows of one. */
  runningIn(chatKey: ChatKey): OpRecord | null {
    return this.ofChat(chatKey).find((record) => !isTerminalOpState(record.view.state)) ?? null;
  }

  /**
   * A finished result of a board that its own controller hands to the dock (§6.5): that controller made it and
   * vouches for what an adopted, already finished result does not say by itself — the persona it was made under
   * and its Split snapshot. Only what this tab does not know is taken: a persona it knows otherwise refuses the
   * hand-over. null — no such finished operation of a board in that chat here, or it is not that persona's.
   *
   * Every check comes before the one write: a hand-over that names an operation of the dock itself, or of another
   * chat, vouches for nothing — a result whose persona this tab does not know stays one that is never inserted
   * (§7 «Ограда»).
   */
  vouch(opId: string, chatKey: ChatKey, personaDefinitionId: string, split: boolean): OpRecord | null {
    const entry = this.entries.get(opId);
    if (entry === undefined || !isTerminalOpState(entry.view.state)) return null;
    const { surface, target } = entry.view;
    if ((surface !== 'preview' && surface !== 'newcomers') || chatKeyOf(target.chat) !== chatKey) return null;
    const known = entry.memo.personaDefinitionId;
    if (known !== null && known !== personaDefinitionId) return null;
    if (known === null) entry.memo = { ...entry.memo, personaDefinitionId, split };
    return this.recordOf(entry);
  }

  // ── commands ─────────────────────────────────────────────────────────────

  async start(start: StartOp, memo: Omit<StartMemo, 'split'>): Promise<StartOutcome> {
    const chatKey = chatKeyOf(start.target.chat);
    this.watch(chatKey);
    this.inFlight.set(chatKey, (this.inFlight.get(chatKey) ?? 0) + 1);
    // The starts of one chat are a chain: this one ends when it returns, whatever it returns.
    const earlier = this.starting.get(chatKey) ?? null;
    let finished: () => void = () => undefined;
    const mine = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const chain = (earlier ?? Promise.resolve()).then(() => mine);
    this.starting.set(chatKey, chain);
    try {
      return await this.runStart(start, memo, chatKey, earlier);
    } finally {
      finished();
      if (this.starting.get(chatKey) === chain) this.starting.delete(chatKey);
    }
  }

  private async runStart(start: StartOp, memo: Omit<StartMemo, 'split'>, chatKey: ChatKey, earlier: Promise<void> | null): Promise<StartOutcome> {
    let answer: RpcAnswer<Admission>;
    try {
      answer = await this.rpc.request('op.start', start);
    } finally {
      const left = (this.inFlight.get(chatKey) ?? 1) - 1;
      if (left <= 0) this.inFlight.delete(chatKey);
      else this.inFlight.set(chatKey, left);
    }
    if (!answer.ok) {
      this.adoptLeftovers(chatKey);
      return { kind: 'error', error: answer.error };
    }
    const admission = answer.payload;
    if (!admission.ok) {
      this.adoptLeftovers(chatKey);
      return { kind: 'refused', admission };
    }
    const opId = admission.opId;
    // Only what «Ещё раз» and Fix read of the start: the request itself (its fresh page text above all) is not kept.
    const fullMemo: StartMemo = { ...memo, split: start.split };
    // The admission is for this very request — its persona included: whatever dropped the operation before, it is valid again.
    this.tombstones.delete(opId);
    // Nothing announced this operation yet and an earlier start of this chat is still being handled (a double
    // click): it may be that start's own operation, admitted a moment ago. Let it say so first.
    if (earlier !== null && !this.entries.has(opId) && (this.early.get(opId)?.length ?? 0) === 0) await earlier;
    const now = this.clock.now();
    // A composite Coach turn is admitted as its recap step; the terminal view says what the operation really was.
    const first = coachTurnSteps(start)?.recap ?? start;
    let reopened = true;
    const known = this.entries.get(opId);
    if (known === undefined) {
      const events = this.early.get(opId) ?? [];
      this.early.delete(opId);
      if (events.length > 0) {
        // A fresh operation: its first events came before this answer.
        reopened = false;
        const view = admittedView(opId, first, now);
        this.entries.set(opId, { mirror: newMirror(opId, view.phase), view, memo: fullMemo, made: true, own: true, reopenedAt: null, desynced: false });
        this.replay(events);
      } else {
        // Not announced to this tab session: an operation it did not start (a cached result, a run that outlived a reload).
        await this.syncChat(chatKey);
        const found = this.entries.get(opId);
        if (found === undefined) {
          const view = admittedView(opId, first, now);
          this.entries.set(opId, { mirror: newMirror(opId, view.phase), view, memo: fullMemo, made: true, own: true, reopenedAt: null, desynced: false });
          reopened = false;
        } else {
          found.own = true;
          if (!found.made) found.memo = fullMemo;
        }
      }
    } else {
      // An operation this tab adopted and now asked for by the same request: what the request says holds for it.
      if (!known.made) known.memo = fullMemo;
      if (!known.own && !isTerminalOpState(known.view.state)) {
        // The background attached this tab to the run: the batches restart, the text so far is read again.
        await this.syncChat(chatKey, opId);
        known.own = true;
      }
    }
    this.adoptLeftovers(chatKey);
    const entry = this.entries.get(opId);
    if (entry !== undefined && reopened && isTerminalOpState(entry.view.state)) entry.reopenedAt = now;
    this.prune();
    this.emit({ kind: 'changed', opId });
    return { kind: 'started', opId, reopened };
  }

  /** Explicit cancel (button, ⌘. / Ctrl+.); the terminal view follows as an event. */
  cancel(opId: string): Promise<RpcAnswer<{ state: OpView['state'] }>> {
    return this.rpc.request('op.cancel', { opId });
  }

  /**
   * Reads what the background knows about a chat (its running operation,
   * its stored results) and follows it from now on. `reseed` names a running
   * operation whose text must be taken from the answer (a take-over).
   */
  async syncChat(chatKey: ChatKey, reseed?: string): Promise<void> {
    this.watch(chatKey);
    const answer = await this.rpc.request('op.list', { scope: 'tab', chatKey });
    if (!answer.ok) return;
    for (const view of answer.payload.ops) {
      const entry = this.entries.get(view.opId);
      if (entry === undefined) {
        if (this.tombstones.has(view.opId)) continue;
        this.entries.set(view.opId, { mirror: mirrorFromView(view), view, memo: this.adoptedMemo(view), own: false, reopenedAt: null, desynced: false });
        this.absorbEarly(view.opId);
        this.emit({ kind: 'changed', opId: view.opId });
        const adopted = this.entries.get(view.opId);
        // A view that was terminal in the answer; one that ended in the buffer meanwhile already said so.
        if (adopted !== undefined && isTerminalOpState(view.state)) this.emit({ kind: 'done', record: this.recordOf(adopted) });
        continue;
      }
      if (isTerminalOpState(view.state)) {
        this.onDone(view);
        continue;
      }
      // The tab's own mirror is fresher than a read unless it is taking the run over.
      if (entry.own && view.opId !== reseed) continue;
      // Batches that already came here (the background attached this tab meanwhile) are in the answer's text:
      // the count goes on from them, so the next batch is not taken for a gap.
      entry.mirror = { ...mirrorFromView(view), seq: entry.mirror.seq };
      entry.view = view;
      entry.desynced = false;
      this.emit({ kind: 'changed', opId: view.opId });
    }
    this.prune();
  }

  /**
   * Batches of an operation that landed before its record existed (while
   * `op.list` was on its way): their text is in the view the record was
   * made from, so only their count and a terminal view among them matter.
   */
  private absorbEarly(opId: string): void {
    const events = this.early.get(opId);
    const entry = this.entries.get(opId);
    if (events === undefined || entry === undefined) return;
    this.early.delete(opId);
    let seq = entry.mirror.seq;
    for (const event of events) if (event.kind === 'update' && event.update.seq > seq) seq = event.update.seq;
    if (entry.mirror.done === null) entry.mirror = { ...entry.mirror, seq };
    const done = events.findLast((event) => event.kind === 'done');
    if (done !== undefined && done.kind === 'done') this.onDone(done.view);
  }

  /** Follows a chat; the least recently used one goes when there are too many. */
  private watch(chatKey: ChatKey): void {
    this.watched.delete(chatKey);
    this.watched.add(chatKey);
    while (this.watched.size > WATCHED_CHATS_MAX) {
      const oldest = this.watched.values().next().value;
      if (oldest === undefined) break;
      this.watched.delete(oldest);
    }
  }

  /**
   * The port to the background came back (the event page restarted, or the
   * tab got a new session): events of the gap are lost. Every chat with an
   * operation this tab still shows as running is read again; a run the
   * background no longer knows ended without a word — it is interrupted, so
   * nothing spins forever.
   */
  async resync(retry = true): Promise<void> {
    if (this.resyncTimer !== null) this.clock.clearTimer(this.resyncTimer);
    this.resyncTimer = null;
    const running = [...this.entries.values()].filter((entry) => !isTerminalOpState(entry.view.state));
    const chats = new Map<ChatKey, string[]>();
    for (const entry of running) {
      const chatKey = chatKeyOf(entry.view.target.chat);
      chats.set(chatKey, [...(chats.get(chatKey) ?? []), entry.view.opId]);
    }
    let unread = false;
    for (const [chatKey, opIds] of chats) {
      const answer = await this.rpc.request('op.list', { scope: 'tab', chatKey });
      if (!answer.ok) {
        unread = true;
        continue;
      }
      const known = new Map(answer.payload.ops.map((view) => [view.opId, view]));
      for (const opId of opIds) {
        const entry = this.entries.get(opId);
        if (entry === undefined || isTerminalOpState(entry.view.state)) continue;
        const view = known.get(opId);
        const now = this.clock.now();
        if (view === undefined) {
          this.onDone({ ...entry.view, state: 'interrupted', phase: { name: 'settled', since: now }, endedAt: now, error: { code: 'CG-OP-INTERRUPTED' } });
        } else if (isTerminalOpState(view.state)) {
          this.onDone(view);
        } else {
          // Still running: the text so far is the background's; the batches of the new session continue from it.
          entry.mirror = mirrorFromView(view);
          entry.view = view;
          entry.desynced = false;
          this.emit({ kind: 'changed', opId });
        }
      }
      // An answer step named by a recap step whose end was just read here: it was followed a moment ago with
      // nothing known of it, and the same answer holds its state and text so far.
      for (const view of answer.payload.ops) {
        const entry = this.entries.get(view.opId);
        if (entry === undefined || !entry.own || opIds.includes(view.opId) || entry.mirror.done !== null || entry.mirror.seq !== 0) continue;
        if (isTerminalOpState(view.state)) this.onDone(view);
        else {
          entry.mirror = mirrorFromView(view);
          entry.view = view;
          this.emit({ kind: 'changed', opId: view.opId });
        }
      }
    }
    // The background's own list could not be read (no hub is asked here): once more after a moment, so a run
    // whose end was lost with the port does not keep spinning until the next reconnect.
    if (unread && retry) {
      this.resyncTimer = this.clock.setTimer(RESYNC_RETRY_MS, () => {
        this.resyncTimer = null;
        void this.resync(false);
      });
    }
  }

  /**
   * The owner edited a page's persona (its key stays): what this tab holds of it under the old definition is the
   * same persona's, under the new one — inserted and shown as before.
   */
  followPersona(moves: readonly PersonaFollow[]): void {
    for (const [opId, entry] of this.entries) {
      const move = moves.find((candidate) => candidate.pageId === entry.view.target.binding.pageId && candidate.from === entry.memo.personaDefinitionId);
      if (move === undefined) continue;
      entry.memo = { ...entry.memo, personaDefinitionId: move.to };
      this.emit({ kind: 'changed', opId });
    }
  }

  /**
   * Drops what a sign-in or persona change invalidated; the background
   * cancels the runs itself. The background keeps finished results for half
   * an hour whatever the persona: a dropped operation is remembered, so a
   * later read of a chat (`op.list`) or a late `op.done` does not bring it
   * back as if it were of the new persona (AI-126).
   */
  drop(filter: (record: OpRecord) => boolean): string[] {
    const dropped: string[] = [];
    const now = this.clock.now();
    for (const [opId, entry] of this.entries) {
      if (!filter(this.recordOf(entry))) continue;
      this.entries.delete(opId);
      this.early.delete(opId);
      this.tombstones.set(opId, now);
      dropped.push(opId);
    }
    for (const [opId, at] of this.tombstones) {
      if (now - at < OP_LIMITS.resultTtlMs && this.tombstones.size <= TOMBSTONES_MAX) break;
      this.tombstones.delete(opId);
    }
    return dropped;
  }

  private replay(events: readonly EarlyEvent[]): void {
    for (const event of events) {
      if (event.kind === 'update') this.onUpdate(event.update);
      else this.onDone(event.view);
    }
  }

  /**
   * The answer step of a composite Coach turn of this tab: the background put
   * it into the chat's slot when the recap step ended and named it there. It
   * is this tab's own operation — its batches come here from the first one —
   * made under the same persona as the step before it. Nothing is started.
   */
  private follow(opId: string, recap: Entry): void {
    if (this.entries.has(opId) || this.tombstones.has(opId)) return;
    const view = admittedView(opId, { feature: 'coach', surface: recap.view.surface, target: recap.view.target, tone: null }, this.clock.now());
    // The same start's memo: its Split snapshot, its persona and what the site's policy kept of its proof.
    const memo: StartMemo = { ...recap.memo, fixSource: null };
    this.entries.set(opId, { mirror: newMirror(opId, view.phase), view, memo, own: true, reopenedAt: null, desynced: false });
    const events = this.early.get(opId) ?? [];
    this.early.delete(opId);
    this.replay(events);
    this.emit({ kind: 'changed', opId });
  }

  /** What is known of an operation this tab did not start: nothing, except the persona of one that still runs. */
  private adoptedMemo(view: OpView): StartMemo {
    if (isTerminalOpState(view.state)) return NO_MEMO;
    const personaDefinitionId = this.personaOf(view.target.binding.pageId);
    return personaDefinitionId === null ? NO_MEMO : { ...NO_MEMO, personaDefinitionId };
  }

  // ── events ───────────────────────────────────────────────────────────────

  private onUpdate(update: OpUpdate): void {
    const entry = this.entries.get(update.opId);
    if (entry === undefined) {
      this.buffer(update.opId, { kind: 'update', update });
      return;
    }
    const { mirror, outcome } = applyOpUpdate(entry.mirror, update);
    if (outcome === 'applied') entry.mirror = mirror;
    else if (outcome === 'gap') {
      // A batch is missing: follow the state and the phase, freeze the text until the terminal view.
      const current = entry.mirror;
      entry.mirror = {
        ...current,
        seq: update.seq,
        state: isNewerOpState(current.state, update.state) ? update.state : current.state,
        phase: update.phase.since >= current.phase.since ? update.phase : current.phase,
        firstChunkAt: current.firstChunkAt ?? update.firstChunkAt ?? null,
      };
      entry.desynced = true;
    } else return;
    entry.view = this.runningView(entry);
    this.emit({ kind: 'changed', opId: update.opId });
  }

  private onDone(view: OpView): void {
    const entry = this.entries.get(view.opId);
    if (entry === undefined) {
      // Dropped by a sign-in or persona change: its late end (or its «устарело» mark) is nobody's.
      if (this.tombstones.has(view.opId)) return;
      const chatKey = chatKeyOf(view.target.chat);
      // An answer to a start of this chat is still on its way: this may be its operation.
      if ((this.inFlight.get(chatKey) ?? 0) > 0) this.buffer(view.opId, { kind: 'done', view });
      else if (this.watched.has(chatKey)) {
        const adopted: Entry = { mirror: mirrorFromView(view), view, memo: NO_MEMO, own: false, reopenedAt: null, desynced: false };
        this.entries.set(view.opId, adopted);
        this.emit({ kind: 'changed', opId: view.opId });
        if (isTerminalOpState(view.state)) this.emit({ kind: 'done', record: this.recordOf(adopted) });
        this.prune();
      }
      return;
    }
    const wasDone = entry.mirror.done !== null;
    const { mirror, outcome } = applyOpDone(entry.mirror, view);
    if (outcome !== 'applied' || mirror.done === null) return;
    entry.mirror = mirror;
    entry.view = mirror.done;
    entry.desynced = false;
    // The turn goes on: its answer step is known before anybody hears that the recap step ended.
    if (!wasDone && entry.own && mirror.done.continuedBy !== undefined) this.follow(mirror.done.continuedBy, entry);
    this.emit({ kind: 'changed', opId: view.opId });
    if (!wasDone) this.emit({ kind: 'done', record: this.recordOf(entry) });
  }

  private runningView(entry: Entry): OpView {
    const { mirror, view } = entry;
    const next: { -readonly [K in keyof OpView]: OpView[K] } = { ...view, state: mirror.state, phase: mirror.phase };
    if (mirror.text.length > 0) next.text = mirror.text;
    if (mirror.firstChunkAt !== null) next.firstChunkAt = mirror.firstChunkAt;
    return next;
  }

  private buffer(opId: string, event: EarlyEvent): void {
    const list = this.early.get(opId) ?? [];
    if (list.length >= EARLY_EVENTS_MAX) return;
    list.push(event);
    this.early.delete(opId);
    this.early.set(opId, list);
    while (this.early.size > EARLY_OPS_MAX) {
      const oldest = this.early.keys().next().value;
      if (oldest === undefined) break;
      this.early.delete(oldest);
    }
  }

  /** Buffered terminal views of other operations of a followed chat become records once no start is in flight. */
  private adoptLeftovers(chatKey: ChatKey): void {
    if ((this.inFlight.get(chatKey) ?? 0) > 0) return;
    for (const [opId, events] of this.early) {
      const done = events.findLast((event) => event.kind === 'done');
      if (done === undefined || done.kind !== 'done' || chatKeyOf(done.view.target.chat) !== chatKey) continue;
      this.early.delete(opId);
      if (!this.entries.has(opId)) this.onDone(done.view);
    }
  }

  /** Results live 30 minutes; a tab keeps at most its share of them. Whoever keeps state by operation hears what went. */
  private prune(): void {
    const now = this.clock.now();
    const kept = (opId: string): boolean => [...this.keepers].some((keeper) => keeper(opId));
    const finished = [...this.entries.values()]
      .filter((entry) => isTerminalOpState(entry.view.state) && !kept(entry.view.opId))
      .sort((a, b) => b.view.startedAt - a.view.startedAt);
    const dropped: string[] = [];
    finished.forEach((entry, index) => {
      const expired = entry.view.endedAt !== undefined && now - entry.view.endedAt >= OP_LIMITS.resultTtlMs;
      if (!expired && index < STORAGE_LIMITS.resultsPerTab) return;
      this.entries.delete(entry.view.opId);
      dropped.push(entry.view.opId);
    });
    if (dropped.length > 0) for (const listener of [...this.dropListeners]) listener(dropped);
  }

  private recordOf(entry: Entry): OpRecord {
    return { view: entry.view, memo: entry.memo, own: entry.own, reopenedAt: entry.reopenedAt, desynced: entry.desynced };
  }

  private emit(event: OpStoreEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
