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
// run that outlived a reload — and is read with `op.list`.

import { type CgErrorWire } from '@cg/contracts/errors';
import { chatKeyOf, type ChatKey } from '@cg/contracts/ids';
import { OP_LIMITS, STORAGE_LIMITS } from '@cg/contracts/limits';
import { type Admission, type OpView, type StartOp } from '@cg/contracts/ops';
import { type TabEventPayload } from '@cg/contracts/tab-messages';

import { applyOpDone, applyOpUpdate, isNewerOpState, isTerminalOpState, mirrorFromView, newMirror, type OpMirror } from '../../domain/ops';
import { type RpcAnswer, type TabRpcPort, type TimerClock } from './ports';

type OpUpdate = TabEventPayload<'op.update'>;

/** What the tab remembers about a start beyond the view (never sent anywhere). */
export interface StartMemo {
  /** The Split snapshot of the start (a Hi result does not carry it). */
  readonly split: boolean;
  /** Fix: the person's draft the request was made from (text, revision, fingerprint). */
  readonly fixSource: { readonly text: string; readonly revision: number; readonly digest: string } | null;
  /** The start itself without its spent token, for «Ещё раз». */
  readonly start: Omit<StartOp, 'cause'> | null;
  /**
   * The persona definition the operation was made under; null — not known to
   * this tab. Known for an operation this tab started or reopened (the
   * admission is for the same request, persona included) and for one adopted
   * while it still ran (the background cancels a run the moment its page's
   * persona changes, so a running one is of the current persona). A result
   * adopted already finished says nothing about its persona: it is never
   * inserted and never shown as the current persona's (§7 «Ограда», AI-126).
   */
  readonly personaDefinitionId: string | null;
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

const NO_MEMO: StartMemo = { split: false, fixSource: null, start: null, personaDefinitionId: null };
const EARLY_OPS_MAX = 16;
const EARLY_EVENTS_MAX = 400;
/** Dropped operations remembered so that a later read of the background does not bring them back. */
const TOMBSTONES_MAX = 256;

interface Entry {
  mirror: OpMirror;
  view: OpView;
  memo: StartMemo;
  own: boolean;
  reopenedAt: number | null;
  desynced: boolean;
}

type EarlyEvent = { readonly kind: 'update'; readonly update: OpUpdate } | { readonly kind: 'done'; readonly view: OpView };

function withoutCause(start: StartOp): Omit<StartOp, 'cause'> {
  const { cause: _cause, ...rest } = start;
  return rest;
}

export class OpStore {
  private readonly entries = new Map<string, Entry>();
  private readonly early = new Map<string, EarlyEvent[]>();
  private readonly watched = new Set<ChatKey>();
  private readonly inFlight = new Map<ChatKey, number>();
  private readonly listeners = new Set<(event: OpStoreEvent) => void>();
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
  }

  subscribe(listener: (event: OpStoreEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
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

  // ── commands ─────────────────────────────────────────────────────────────

  async start(start: StartOp, memo: Omit<StartMemo, 'start' | 'split'>): Promise<StartOutcome> {
    const chatKey = chatKeyOf(start.target.chat);
    this.watched.add(chatKey);
    this.inFlight.set(chatKey, (this.inFlight.get(chatKey) ?? 0) + 1);
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
    const now = this.clock.now();
    const fullMemo: StartMemo = { ...memo, split: start.split, start: withoutCause(start) };
    // The admission is for this very request — its persona included: whatever dropped the operation before, it is valid again.
    this.tombstones.delete(opId);
    let reopened = true;
    const known = this.entries.get(opId);
    if (known === undefined) {
      const events = this.early.get(opId) ?? [];
      this.early.delete(opId);
      if (events.length > 0) {
        // A fresh operation: its first events came before this answer.
        reopened = false;
        const view: OpView = { opId, feature: start.feature, surface: start.surface, target: start.target, state: 'admitted', phase: { name: 'admitted', since: now }, startedAt: now, toneUsed: start.tone };
        this.entries.set(opId, { mirror: newMirror(opId, view.phase), view, memo: fullMemo, own: true, reopenedAt: null, desynced: false });
        for (const event of events) {
          if (event.kind === 'update') this.onUpdate(event.update);
          else this.onDone(event.view);
        }
      } else {
        // Not announced to this tab session: an operation it did not start (a cached result, a run that outlived a reload).
        await this.syncChat(chatKey);
        const found = this.entries.get(opId);
        if (found === undefined) {
          const view: OpView = { opId, feature: start.feature, surface: start.surface, target: start.target, state: 'admitted', phase: { name: 'admitted', since: now }, startedAt: now, toneUsed: start.tone };
          this.entries.set(opId, { mirror: newMirror(opId, view.phase), view, memo: fullMemo, own: true, reopenedAt: null, desynced: false });
          reopened = false;
        } else {
          found.own = true;
          if (found.memo.start === null) found.memo = { ...fullMemo, start: null };
        }
      }
    } else {
      // An operation this tab adopted and now asked for by the same request: what the request says holds for it.
      if (known.memo.start === null) known.memo = { ...fullMemo, start: null };
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
    this.watched.add(chatKey);
    const answer = await this.rpc.request('op.list', { scope: 'tab', chatKey });
    if (!answer.ok) return;
    for (const view of answer.payload.ops) {
      const entry = this.entries.get(view.opId);
      if (entry === undefined) {
        if (this.tombstones.has(view.opId)) continue;
        this.entries.set(view.opId, { mirror: mirrorFromView(view), view, memo: this.adoptedMemo(view), own: false, reopenedAt: null, desynced: false });
        this.emit({ kind: 'changed', opId: view.opId });
        if (isTerminalOpState(view.state)) this.emit({ kind: 'done', record: this.recordOf(this.entries.get(view.opId) as Entry) });
        continue;
      }
      if (isTerminalOpState(view.state)) {
        this.onDone(view);
        continue;
      }
      // The tab's own mirror is fresher than a read unless it is taking the run over.
      if (entry.own && view.opId !== reseed) continue;
      entry.mirror = mirrorFromView(view);
      entry.view = view;
      entry.desynced = false;
      this.emit({ kind: 'changed', opId: view.opId });
    }
    this.prune();
  }

  /**
   * The port to the background came back (the event page restarted, or the
   * tab got a new session): events of the gap are lost. Every chat with an
   * operation this tab still shows as running is read again; a run the
   * background no longer knows ended without a word — it is interrupted, so
   * nothing spins forever.
   */
  async resync(): Promise<void> {
    const running = [...this.entries.values()].filter((entry) => !isTerminalOpState(entry.view.state));
    const chats = new Map<ChatKey, string[]>();
    for (const entry of running) {
      const chatKey = chatKeyOf(entry.view.target.chat);
      chats.set(chatKey, [...(chats.get(chatKey) ?? []), entry.view.opId]);
    }
    for (const [chatKey, opIds] of chats) {
      const answer = await this.rpc.request('op.list', { scope: 'tab', chatKey });
      if (!answer.ok) continue;
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
        this.entries.set(view.opId, { mirror: mirrorFromView(view), view, memo: NO_MEMO, own: false, reopenedAt: null, desynced: false });
        this.emit({ kind: 'changed', opId: view.opId });
        if (isTerminalOpState(view.state)) this.emit({ kind: 'done', record: this.recordOf(this.entries.get(view.opId) as Entry) });
      }
      return;
    }
    const wasDone = entry.mirror.done !== null;
    const { mirror, outcome } = applyOpDone(entry.mirror, view);
    if (outcome !== 'applied' || mirror.done === null) return;
    entry.mirror = mirror;
    entry.view = mirror.done;
    entry.desynced = false;
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

  /** Results live 30 minutes; a tab keeps at most its share of them. */
  private prune(): void {
    const now = this.clock.now();
    const kept = (opId: string): boolean => [...this.keepers].some((keeper) => keeper(opId));
    const finished = [...this.entries.values()]
      .filter((entry) => isTerminalOpState(entry.view.state) && !kept(entry.view.opId))
      .sort((a, b) => b.view.startedAt - a.view.startedAt);
    finished.forEach((entry, index) => {
      const expired = entry.view.endedAt !== undefined && now - entry.view.endedAt >= OP_LIMITS.resultTtlMs;
      if (expired || index >= STORAGE_LIMITS.resultsPerTab) this.entries.delete(entry.view.opId);
    });
  }

  private recordOf(entry: Entry): OpRecord {
    return { view: entry.view, memo: entry.memo, own: entry.own, reopenedAt: entry.reopenedAt, desynced: entry.desynced };
  }

  private emit(event: OpStoreEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
