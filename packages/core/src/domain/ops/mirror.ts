// The tab's mirror of a running operation (architecture.md §5.4 `op.update`,
// §7; AI-137, AI-138, RB-016, RB-017, RB-020). The background sends stream
// text in 50 ms batches, each with the next `seq` of its operation and the
// text appended since the previous one, then one terminal `op.done`. The
// mirror applies a batch only when it is the next one of its own operation:
// an older or repeated `seq` changes nothing (newer state wins), a gap asks
// for a resync, and nothing moves after `op.done`. A resync, a reload or the
// palette's «Перейти» re-attaches the tab: the background answers the view
// with the text so far and restarts the batches at seq 1 for this tab, and
// the tab seeds a fresh mirror from that view (mirrorFromView). A render the
// tab deferred to its next frame is dropped when the chat changed meanwhile.

import { type FeatureId } from '@cg/contracts/features';
import { type ChatKey } from '@cg/contracts/ids';
import { type OpState, type OpView, type Phase } from '@cg/contracts/ops';
import { type TabEventPayload } from '@cg/contracts/tab-messages';

import { isNewerOpState, isTerminalOpState } from './states';

export type OpUpdate = TabEventPayload<'op.update'>;

export interface OpMirror {
  readonly opId: string;
  /** The last applied batch; 0 — none yet (the first batch is seq 1). */
  readonly seq: number;
  readonly state: OpState;
  readonly phase: Phase;
  readonly text: string;
  readonly firstChunkAt: number | null;
  /** The terminal view, once `op.done` arrived. */
  readonly done: OpView | null;
}

export type MirrorOutcome = 'applied' | 'stale' | 'gap' | 'foreign' | 'after-done';

export function newMirror(opId: string, phase: Phase): OpMirror {
  return { opId, seq: 0, state: 'admitted', phase, text: '', firstChunkAt: null, done: null };
}

/** A mirror seeded from the view a (re-)attach answered: the text so far, the next batch is seq 1. */
export function mirrorFromView(view: OpView): OpMirror {
  return {
    opId: view.opId,
    seq: 0,
    state: view.state,
    phase: view.phase,
    text: view.text ?? '',
    firstChunkAt: view.firstChunkAt ?? null,
    done: isTerminalOpState(view.state) ? view : null,
  };
}

/** Applies one `op.update` batch. */
export function applyOpUpdate(mirror: OpMirror, update: OpUpdate): { readonly mirror: OpMirror; readonly outcome: MirrorOutcome } {
  if (update.opId !== mirror.opId) return { mirror, outcome: 'foreign' };
  if (mirror.done !== null) return { mirror, outcome: 'after-done' };
  if (update.seq <= mirror.seq) return { mirror, outcome: 'stale' };
  if (update.seq !== mirror.seq + 1) return { mirror, outcome: 'gap' };
  const state = update.state === mirror.state || isNewerOpState(mirror.state, update.state) ? update.state : mirror.state;
  return {
    mirror: {
      ...mirror,
      seq: update.seq,
      state,
      phase: update.phase.since >= mirror.phase.since ? update.phase : mirror.phase,
      text: mirror.text + update.append,
      firstChunkAt: mirror.firstChunkAt ?? update.firstChunkAt ?? null,
    },
    outcome: 'applied',
  };
}

/**
 * The terminal view replaces the streamed text: actions only on its result
 * (§7). A finished view comes again only to add the «устарело» marker (a fan
 * wrote after the generation); anything else after `op.done` is stale.
 */
export function applyOpDone(mirror: OpMirror, view: OpView): { readonly mirror: OpMirror; readonly outcome: MirrorOutcome } {
  if (view.opId !== mirror.opId) return { mirror, outcome: 'foreign' };
  const done = mirror.done;
  if (done !== null) {
    const marksStale = view.state === done.state && done.stale === undefined && view.stale !== undefined;
    return marksStale ? { mirror: { ...mirror, done: { ...done, stale: view.stale } }, outcome: 'applied' } : { mirror, outcome: 'stale' };
  }
  if (!isTerminalOpState(view.state)) return { mirror, outcome: 'stale' };
  return {
    mirror: { ...mirror, state: view.state, phase: view.phase, text: view.text ?? mirror.text, firstChunkAt: view.firstChunkAt ?? mirror.firstChunkAt, done: view },
    outcome: 'applied',
  };
}

/**
 * AI-138: when the result panel opens. Reply, Hi and Ping (and the analysis
 * features) open with the first chunk or the cost line; Fix does not show
 * its stream and opens only with the finished result.
 */
export function panelOpens(feature: FeatureId, mirror: Pick<OpMirror, 'state' | 'firstChunkAt'>, usageSeen: boolean): boolean {
  if (isTerminalOpState(mirror.state)) return true;
  if (feature === 'fix') return false;
  return mirror.firstChunkAt !== null || usageSeen;
}

/** Whether the streamed text is shown while the operation runs (Fix: never, AI-138). */
export function showsStream(feature: FeatureId): boolean {
  return feature !== 'fix';
}

/**
 * RB-017: a render the tab put off to its next frame belongs to the chat it
 * was scheduled for; a chat change in between drops it.
 */
export class DeferredRender {
  private generation = 0;
  private chat: ChatKey | null = null;

  constructor(chat: ChatKey | null) {
    this.chat = chat;
  }

  /** A ticket for one deferred render. */
  schedule(): number {
    return this.generation;
  }

  /** The route moved: every outstanding ticket of the old chat is void. */
  chatChanged(chat: ChatKey | null): void {
    if (chat === this.chat) return;
    this.chat = chat;
    this.generation += 1;
  }

  /** Render only when nothing changed since `schedule()`. */
  stillCurrent(ticket: number): boolean {
    return ticket === this.generation;
  }
}
