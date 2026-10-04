// The debug view of one operation (architecture.md §5.5 `OpView.debug`,
// §9.3; DB-009, DB-011, DB-014, DB-016, DB-017). The background feeds every
// hub frame and its own marks into one builder per operation and puts
// `view()` into OpView.debug only while debug mode is on. Reasoning text and
// the prompt never go to a log: reasoning only into this view (≤ 64 000
// characters, cut with a mark), the prompt only into the snapshot store.

import { type HubFrame } from '@cg/contracts/hub';
import { type OpDebugView } from '@cg/contracts/ops';

import { CLIENT_STAGES, StageMarks, hubStagesFromManifest, type ClientStage, type HubStage } from './profiler';
import { TRUNCATED_MARK } from './prompt';
import { usageOf, type UsageFrame } from './usage';

export type ContextFrame = Extract<HubFrame, { readonly type: 'context_v1' }>;

/** DB-009: the context card from `context_v1` — the reader that served, coverage, window and fresh-text counts. */
export function contextCard(frame: ContextFrame): NonNullable<OpDebugView['context']> {
  return {
    source: frame.source.slice(0, 64) || 'unknown',
    coverage: frame.coverage.slice(0, 64) || 'unknown',
    windowRequested: frame.window.requested,
    windowServed: frame.window.served,
    liveAccepted: frame.live.accepted,
    liveRejected: frame.live.rejected,
  };
}

export const REASONING_MAX_CHARS = 64_000;

/** DB-014: reasoning deltas, debug only, cut with a mark at the limit. */
export class ReasoningBuffer {
  private parts: string[] = [];
  private length = 0;
  private cut = false;

  append(delta: string): void {
    if (this.cut || delta.length === 0) return;
    const room = REASONING_MAX_CHARS - TRUNCATED_MARK.length - this.length;
    if (delta.length <= room) {
      this.parts.push(delta);
      this.length += delta.length;
      return;
    }
    this.parts.push(delta.slice(0, Math.max(0, room)), TRUNCATED_MARK);
    this.length += Math.max(0, room) + TRUNCATED_MARK.length;
    this.cut = true;
  }

  text(): string | null {
    return this.length === 0 ? null : this.parts.join('');
  }

  get truncated(): boolean {
    return this.cut;
  }
}

/** One operation's debug facts, frame by frame. */
export class OpDebugBuilder {
  private readonly marks = new StageMarks();
  private readonly reasoning = new ReasoningBuffer();
  private usage: UsageFrame | null = null;
  private context: OpDebugView['context'] = null;
  private model: string | null = null;
  private hubStages: HubStage[] = [];
  private promptToken: string | null = null;

  /** The click that started the operation. */
  constructor(clickAt: number) {
    this.marks.mark('click', clickAt);
  }

  /** A client mark: `request` when the call left, `parse`, `render`, `insert` from the tab. */
  mark(stage: ClientStage, at: number): void {
    this.marks.mark(stage, at);
  }

  onFrame(frame: HubFrame, at: number): void {
    switch (frame.type) {
      case 'meta':
        this.marks.mark('meta', at);
        this.model = frame.model.length > 0 ? frame.model.slice(0, 80) : null;
        break;
      case 'content_delta':
        if (frame.text.length > 0) this.marks.mark('firstChunk', at);
        break;
      case 'reasoning_delta':
        this.reasoning.append(frame.text);
        break;
      case 'usage':
        this.usage = frame;
        break;
      case 'context_v1':
        this.context = contextCard(frame);
        break;
      case 'debug_input_v1':
        this.hubStages = hubStagesFromManifest(frame.contextManifest);
        break;
      case 'done':
        this.marks.mark('done', at);
        break;
      case 'error':
        break;
    }
  }

  /** The opaque token of this operation's prompt snapshot (DB-006). */
  setPromptToken(token: string | null): void {
    this.promptToken = token === null ? null : token.slice(0, 128);
  }

  markOf(stage: ClientStage): number | null {
    return this.marks.at(stage);
  }

  get usageFrame(): UsageFrame | null {
    return this.usage;
  }

  view(): OpDebugView {
    return {
      stages: this.marks.toStages().slice(0, CLIENT_STAGES.length),
      usage: usageOf(this.usage),
      reasoning: this.reasoning.text(),
      promptToken: this.promptToken,
      context: this.context,
      model: this.model,
      hubStages: this.hubStages,
    };
  }
}
