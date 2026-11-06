// The stage profiler of a generation (architecture.md §9.3; DB-011, DB-012,
// DB-013). The client marks moments — click → request → meta → first
// chunk → done → parse → render → insert — and the debug footer shows the
// segments between them («запрос 38 · meta 312 · …», «всего 3,76 с»), a live
// timer while running (every 100 ms, by the UI) and the failed stage when the
// operation failed. A stage that was not observed is `null` — never a guessed
// zero (DB-028).

import { type UiTextKey } from '@cg/contracts/i18n/keys';
import { type OpDebugView } from '@cg/contracts/ops';

export const CLIENT_STAGES = ['click', 'request', 'meta', 'firstChunk', 'done', 'parse', 'render', 'insert'] as const;
export type ClientStage = (typeof CLIENT_STAGES)[number];

export type StageMark = OpDebugView['stages'][number];

/** The footer's segments: each between two marks, named by the catalog's `debug.stage.*` words. */
export const PROFILE_SEGMENTS = [
  { name: 'request', from: 'click', to: 'request' },
  { name: 'meta', from: 'request', to: 'meta' },
  { name: 'firstChunk', from: 'meta', to: 'firstChunk' },
  { name: 'stream', from: 'firstChunk', to: 'done' },
  { name: 'parse', from: 'done', to: 'parse' },
  { name: 'render', from: 'parse', to: 'render' },
  { name: 'insert', from: 'render', to: 'insert' },
] as const satisfies readonly { readonly name: string; readonly from: ClientStage; readonly to: ClientStage }[];

export type SegmentName = (typeof PROFILE_SEGMENTS)[number]['name'];

/** The catalog word of each segment (the insert has no `debug.stage.*` word of its own: «вставить»). */
export const SEGMENT_LABEL_KEYS: { readonly [S in SegmentName]: UiTextKey } = {
  request: 'debug.stage.request',
  meta: 'debug.stage.meta',
  firstChunk: 'debug.stage.firstChunk',
  stream: 'debug.stage.stream',
  parse: 'debug.stage.parse',
  render: 'debug.stage.render',
  insert: 'result.keys.insert',
};

export interface ProfileSegment {
  readonly name: SegmentName;
  readonly ms: number | null;
  readonly status: 'done' | 'running' | 'failed' | 'pending';
}

export interface Profile {
  readonly segments: readonly ProfileSegment[];
  /** Click → the last mark (or now while running); null without a click mark. */
  readonly totalMs: number | null;
}

/**
 * DB-011…DB-013: segments from marks. While `running`, the open segment grows
 * with `now` (the 100 ms live timer). When `failed`, the open segment is the
 * failed one; segments after it stay pending.
 */
export function profileOf(stages: readonly StageMark[], state: 'running' | 'done' | 'failed', now: number): Profile {
  const at = new Map<string, number>(stages.map((stage) => [stage.name, stage.at]));
  let open = false;
  const segments = PROFILE_SEGMENTS.map((segment): ProfileSegment => {
    const from = at.get(segment.from);
    const to = at.get(segment.to);
    if (from !== undefined && to !== undefined) return { name: segment.name, ms: Math.max(0, to - from), status: 'done' };
    if (from !== undefined && !open) {
      open = true;
      if (state === 'running') return { name: segment.name, ms: Math.max(0, now - from), status: 'running' };
      if (state === 'failed') return { name: segment.name, ms: null, status: 'failed' };
    }
    return { name: segment.name, ms: null, status: 'pending' };
  });
  const click = at.get('click');
  if (click === undefined) return { segments, totalMs: null };
  const last = Math.max(click, ...stages.map((stage) => stage.at));
  return { segments, totalMs: Math.max(0, (state === 'running' ? Math.max(now, last) : last) - click) };
}
