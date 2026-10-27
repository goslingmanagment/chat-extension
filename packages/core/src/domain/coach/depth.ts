// How much of the chat a Coach question reads (2026-10-27, the owner: «по дефолту надо хотя бы поставить 300»,
// «оптимально догрузите ещё 300, в идеале все за 3000»). A question reads the chat's latest N messages of the hub
// archive: the chat's own choice for this tab's session, else the settings' number (300). The window offers the
// steps below the whole archive and the whole archive itself, each with how far back it reaches; under an answer
// whose ```more note says older messages would change it, two depths to ask again at — the optimal one (twice what
// it read, on a step) and the ideal one (the whole archive, as far as a question may read). Pure.

import { AI_REQUEST_LIMITS } from '@cg/contracts/limits';
import { COACH_WINDOW_DEFAULT, SETTINGS_RANGES, type SettingsV1 } from '@cg/contracts/settings';
import { type Msg } from '@cg/contracts/vm';

/** The depths the window's menu offers below the whole archive. */
export const COACH_DEPTH_STEPS: readonly number[] = [100, 300, 600, 1000, 1500];
/** The steps an «оптимально» may land on: at least twice what the answer read. */
const OPTIMAL_STEPS: readonly number[] = [300, 600, 1000, 1500, 3000, 5000];
/** What the hub reads for Coach without `coach-depth-v1`: its ordinary cap. */
export const COACH_ORDINARY_CAP = 1500;
/** At most this many depths one feed read dates (the hub's bound). */
export const COACH_DEPTH_MARKS_MAX = 8;

/** The settings' number of Coach (`generation.coach.window`), 300 where a store has none. */
export function coachWindowOf(settings: SettingsV1): number {
  const value = settings.generation.coach.window;
  return value === undefined ? COACH_WINDOW_DEFAULT : Math.max(SETTINGS_RANGES.coachWindow.min, Math.min(SETTINGS_RANGES.coachWindow.max, value));
}

/** The most a Coach question may read: the hub's deep window to a hub with `coach-depth-v1`, its ordinary 1500 otherwise. */
export function coachDepthCap(deepMax: number, deep: boolean): number {
  const cap = Math.max(AI_REQUEST_LIMITS.messageCountMin, Math.min(AI_REQUEST_LIMITS.messageCountMax, deepMax));
  return deep ? cap : Math.min(cap, COACH_ORDINARY_CAP);
}

/** A depth held to what a question may read. */
export function clampDepth(value: number, cap: number): number {
  return Math.max(AI_REQUEST_LIMITS.messageCountMin, Math.min(cap, Math.trunc(value)));
}

/** What the conversation's archive holds, as a feed's first page dated it (`FeedPage.depth`). */
export interface DepthFacts {
  readonly stored: number;
  readonly oldestAt: string | null;
  readonly complete: boolean;
  /** The time of the N-th newest message, by N. */
  readonly marks: ReadonlyMap<number, string | null>;
}

/** The depths a first page should date: the menu's steps, the chat's and the settings' numbers, up to the cap; eight at most. */
export function depthMarksFor(values: readonly number[], cap: number): number[] {
  const wanted = new Set<number>();
  for (const value of [...COACH_DEPTH_STEPS, ...values]) if (Number.isFinite(value) && value >= 1 && value <= cap) wanted.add(Math.trunc(value));
  return [...wanted].sort((a, b) => a - b).slice(0, COACH_DEPTH_MARKS_MAX);
}

/** The whole archive as one depth: what it holds, as far as a question may read; the cap when its size is not known. */
export function wholeDepth(cap: number, facts: DepthFacts | null): number {
  return facts === null ? cap : clampDepth(Math.max(1, facts.stored), cap);
}

export interface DepthOption {
  readonly window: number;
  /** The whole archive (or all a question may read). */
  readonly all: boolean;
}

/**
 * The menu: the steps below the whole archive (and the chat's or the settings' own number when it is none of them),
 * then the whole archive. A step at or above what the archive holds is the whole archive.
 */
export function depthOptions(input: { readonly value: number; readonly usual: number; readonly cap: number; readonly facts: DepthFacts | null }): DepthOption[] {
  const whole = wholeDepth(input.cap, input.facts);
  const steps = new Set<number>(COACH_DEPTH_STEPS);
  steps.add(input.usual);
  steps.add(input.value);
  const below = [...steps].filter((step) => step >= AI_REQUEST_LIMITS.messageCountMin && step < whole).sort((a, b) => a - b);
  return [...below.map((window) => ({ window, all: false })), { window: whole, all: true }];
}

/** Whether a depth reads the whole archive (or all a question may read). */
export function readsAll(value: number, cap: number, facts: DepthFacts | null): boolean {
  return value >= wholeDepth(cap, facts);
}

export interface MoreDepths {
  /** «Ещё 300»: twice what the answer read, on a step, below the ideal; null — none fits. */
  readonly optimal: number | null;
  /** «Всю переписку»: the whole archive, as far as a question may read; null — nothing older to read. */
  readonly ideal: number | null;
  /** The archive holds nothing older than the answer read. */
  readonly exhausted: boolean;
  /** The archive holds more than a question may read, and the answer read that much. */
  readonly capped: boolean;
}

/**
 * What «Coach хочет дочитать» offers under an answer that read `read` messages. `stored` — what the archive holds
 * (the feed's count, or what the answer was served when it asked for more than there was); null — not known.
 */
export function moreDepths(input: { readonly read: number; readonly stored: number | null; readonly cap: number }): MoreDepths {
  const top = input.stored === null ? input.cap : Math.min(input.stored, input.cap);
  if (input.read >= top) {
    const exhausted = input.stored !== null && input.read >= input.stored;
    return { optimal: null, ideal: null, exhausted, capped: !exhausted };
  }
  const optimal = OPTIMAL_STEPS.find((step) => step >= input.read * 2 && step < top) ?? null;
  return { optimal, ideal: top, exhausted: false, capped: false };
}

const DAY_MS = 86_400_000;

/**
 * How far back a depth reaches, from the time of its oldest message: «2 недели» on the chip, «последние 2 недели» in
 * the menu; from half a year on, the date it starts at («с 14 мар»). null — the time is not known.
 */
export function depthSpan(at: string | null, now: number, form: 'chip' | 'menu'): Msg | null {
  if (at === null) return null;
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return null;
  const days = Math.max(0, (now - time) / DAY_MS);
  const chip = form === 'chip';
  if (days < 1.5) return { key: chip ? 'coach.depth.span.day' : 'coach.depth.last.day' };
  if (days < 10) return { key: chip ? 'coach.depth.span.days' : 'coach.depth.last.days', params: { n: Math.round(days) } };
  if (days < 26) return { key: chip ? 'coach.depth.span.weeks' : 'coach.depth.last.weeks', params: { n: Math.max(1, Math.round(days / 7)) } };
  if (days < 183) return { key: chip ? 'coach.depth.span.months' : 'coach.depth.last.months', params: { n: Math.max(1, Math.round(days / 30.44)) } };
  return { key: 'coach.depth.since', params: { date: { time: at, style: 'date' } } };
}

/** The time a depth reaches back to: its own mark, or the oldest message when it reads the whole archive. */
export function depthReach(window: number, all: boolean, facts: DepthFacts | null): string | null {
  if (facts === null) return null;
  if (all) return facts.oldestAt;
  return facts.marks.get(window) ?? null;
}
