// The stage profiler of a generation (architecture.md §9.3; DB-011, DB-012,
// DB-013, DB-016). The client marks moments — click → request → meta → first
// chunk → done → parse → render → insert — and the debug footer shows the
// segments between them («запрос 38 · meta 312 · … мс, всего 3,76 с»), a live
// timer while running (every 100 ms, by the UI) and the failed stage when the
// operation failed. The hub's own stages come as durations from the prompt
// manifest («хаб: context 182 · provider 3 106 · stream 2 041»). A stage that
// was not observed is `null` — never a guessed zero (DB-028).

import { type UiTextKey } from '@cg/contracts/i18n/keys';
import { type OpDebugView } from '@cg/contracts/ops';

export const CLIENT_STAGES = ['click', 'request', 'meta', 'firstChunk', 'done', 'parse', 'render', 'insert'] as const;
export type ClientStage = (typeof CLIENT_STAGES)[number];

export type StageMark = OpDebugView['stages'][number];
export type HubStage = NonNullable<OpDebugView['hubStages']>[number];

/** First mark of a stage wins; marks never go back in time. */
export class StageMarks {
  private readonly marks = new Map<ClientStage, number>();

  mark(stage: ClientStage, at: number): boolean {
    if (this.marks.has(stage) || !Number.isFinite(at) || at < 0) return false;
    const latest = Math.max(0, ...this.marks.values());
    this.marks.set(stage, Math.max(Math.round(at), latest));
    return true;
  }

  at(stage: ClientStage): number | null {
    return this.marks.get(stage) ?? null;
  }

  /** OpDebugView.stages: the marks in stage order. */
  toStages(): StageMark[] {
    return CLIENT_STAGES.flatMap((stage) => {
      const at = this.marks.get(stage);
      return at === undefined ? [] : [{ name: stage, at }];
    });
  }
}

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

// ── Hub stages (DB-016) ────────────────────────────────────────────────────

/** The hub's stage names (`summary-cache-check`, `prompt-build`, `llm-ttfb`, `llm-stream`). */
export const HUB_STAGE_NAMES = ['summary-cache-check', 'prompt-build', 'llm-ttfb', 'llm-stream'] as const;
const HUB_STAGES_MAX = 16;
const MAX_STAGE_MS = 86_400_000;

function stageName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().slice(0, 48);
  return name.length > 0 ? name : null;
}

function stageMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_STAGE_MS ? Math.round(value * 10) / 10 : null;
}

/**
 * Reads the hub's stage durations from the context manifest, whatever of
 * the known shapes it uses: `stages` or `timings` as a list of
 * `{name|stage, ms|durationMs}` or as a `name → ms` record. Anything else is
 * no stages, not an error.
 */
export function hubStagesFromManifest(manifest: Readonly<Record<string, unknown>> | null | undefined): HubStage[] {
  if (manifest === null || manifest === undefined) return [];
  const source = manifest['stages'] ?? manifest['timings'] ?? manifest['timingsMs'];
  const out: HubStage[] = [];
  const push = (name: unknown, ms: unknown): void => {
    const n = stageName(name);
    const v = stageMs(ms);
    if (n !== null && v !== null && out.length < HUB_STAGES_MAX && !out.some((stage) => stage.name === n)) out.push({ name: n, ms: v });
  };
  if (Array.isArray(source)) {
    for (const item of source as readonly unknown[]) {
      if (item === null || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      push(record['name'] ?? record['stage'], record['ms'] ?? record['durationMs']);
    }
  } else if (source !== null && typeof source === 'object') {
    for (const [name, ms] of Object.entries(source as Record<string, unknown>)) push(name, ms);
  }
  return out;
}

/** «хаб: context {a}, provider {b}, stream {c}»: context = cache check + prompt build; null when unknown. */
export function hubStageSummary(stages: readonly HubStage[]): { readonly context: number | null; readonly provider: number | null; readonly stream: number | null } {
  const of = (name: string): number | null => stages.find((stage) => stage.name === name)?.ms ?? null;
  const cache = of('summary-cache-check');
  const build = of('prompt-build');
  return {
    context: cache === null && build === null ? null : (cache ?? 0) + (build ?? 0),
    provider: of('llm-ttfb'),
    stream: of('llm-stream'),
  };
}
