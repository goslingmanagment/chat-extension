// What every view model shares (architecture.md §10.2 п. 1). Each one carries
// `view`, one of seven states, so a surface never mistakes "still loading" for
// "nothing there", a failed read for an empty list (ER-025, SP-029), or a
// missing right for an outage. `null` in a field means unknown, never 0.

import { type CgCode, type CgErrorView } from '../errors';
import { type FeatureId } from '../features';
import { type HostCapability } from '../host';
import { type IsoTimestamp, type Uuid } from '../primitives';
import { type UiAction } from './actions';
import { type HotkeyLabel, type ReasonVM } from './catalog';
import { type Msg } from './i18n';

export const VM_VIEW_STATES = ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'] as const;
export type VmViewState = (typeof VM_VIEW_STATES)[number];

/**
 * - `loading` — no first answer yet; `stage` names what is going on («Проверяю сохранённые рекапы…», a scan phase).
 * - `ready` — complete data.
 * - `empty` — the source answered and there is nothing to show; `why` is the empty text.
 * - `partial` — data is shown but incomplete: coverage, truncation, a lagging archive, a degraded host, a failed sub-source.
 * - `error` — the read or the work failed; the error card with its own «Повторить» (never an empty list).
 * - `forbidden` — the person may not see this: not signed in, no binding, no right, no persona, debug off.
 * - `offline` — the hub or the background does not answer; cached data may still be shown with its age.
 *
 * Data fields of a view model may be filled in every state except where the
 * model says otherwise: a dock keeps its strip while forbidden, a board keeps
 * its last rows while offline.
 */
export type VmView =
  | { readonly s: 'loading'; readonly since: number | null; readonly stage: Msg | null }
  | { readonly s: 'ready' }
  | { readonly s: 'empty'; readonly why: Msg }
  | { readonly s: 'partial'; readonly gaps: readonly PartialGap[] }
  | { readonly s: 'error'; readonly error: CgErrorView; readonly retry: UiAction | null }
  | { readonly s: 'forbidden'; readonly error: CgErrorView; readonly fix: UiAction | null }
  | { readonly s: 'offline'; readonly error: CgErrorView; readonly retry: UiAction | null; readonly lastGoodAt: number | null };

/** Why a view is `partial`; each gap is shown, none is hidden behind a full-looking list. */
export type PartialGap =
  | { readonly kind: 'coverage'; readonly level: 'partial' | 'unknown' }
  /** A list cut at the visible limit (1000 rows) with the rest behind the server cursor. */
  | { readonly kind: 'truncated'; readonly shown: number; readonly total: number | null }
  /** The hub archive is behind the chat; null = by an unknown amount. */
  | { readonly kind: 'archive-lag'; readonly messages: number | null; readonly minutes: number | null }
  /** A sub-source failed while the rest is shown (stats failed under a working board). */
  | { readonly kind: 'source-failed'; readonly source: string; readonly code: CgCode }
  | { readonly kind: 'host-degraded'; readonly capabilities: readonly HostCapability[] }
  /** Cached data older than its refresh period is shown while a new read runs. */
  | { readonly kind: 'stale-cache'; readonly asOf: IsoTimestamp | null };

export const COVERAGE_LEVELS = ['complete', 'partial', 'unknown'] as const;
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

/** «данные на 09:18, охват полный»: every number from the hub carries this (SpendersStatsVM, footers). */
export interface DataStamp {
  readonly asOf: IsoTimestamp | null;
  readonly coverage: CoverageLevel;
}

/** A button whose action the controller already decided; the UI dispatches it unchanged. */
export interface ActionButtonVM {
  readonly label: Msg;
  readonly action: UiAction;
  readonly enabled: boolean;
  readonly reason: ReasonVM | null;
  readonly hotkey: HotkeyLabel | null;
}

/** A running generation: «Идут сейчас» under the refusal of a fourth, in the palette, in the status page. */
export interface RunningOpVM {
  readonly opId: Uuid;
  readonly feature: FeatureId;
  /** Display only; null = unknown. */
  readonly fanLabel: string | null;
  readonly startedAt: number;
  readonly inThisTab: boolean;
  /** «Перейти»: navigates to that chat. */
  readonly go: UiAction;
  /** «Отменить». */
  readonly cancel: UiAction;
}
