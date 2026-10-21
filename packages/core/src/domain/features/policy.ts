// Feature policies (RU-001; architecture.md §5.5, §7, §8.4, D-14, D-15): one
// row per AI feature — where its result is shown, what kind of result it
// is, which message window it reads, whether it takes a tone, Split, a
// draft or fresh page text, how it is run again, and its timeouts. The
// controllers and the request builder read this table; nothing else decides
// these things. What a feature needs on a site — the owner's switches, the
// site's capabilities — is not here: that is the feature manifest
// (`@cg/contracts/features/*`), read by `admission` (./admission.ts). The
// feature's key there is its `dockAction`.

import { freshTextSurface, isSplitFeature, type FeatureId } from '@cg/contracts/features';
import { OP_TIMEOUTS, type OpTimeouts } from '@cg/contracts/limits';
import { type OpResult } from '@cg/contracts/ops';

/** Where a result lives: the dock's draft sheet, the dock's analysis sheet (Recap, Review), or the Coach panel. */
export type FeaturePlace = 'draft-sheet' | 'analysis-sheet' | 'coach-panel';

/** The message window a feature reads (Б5): a settings window, or a fixed one. */
export type WindowBucket = 'quick' | 'improve' | 'ping' | 'deep' | 'hi' | 'recap-short';

/** The seven buttons of the strip; the two recap lengths share one. */
export type DockAction = 'reply' | 'fix' | 'hi' | 'ping' | 'review' | 'recap' | 'coach';

export interface FeaturePolicy {
  readonly place: FeaturePlace;
  readonly dockAction: DockAction;
  readonly result: OpResult['kind'];
  readonly window: WindowBucket;
  /** Takes the one-off tone (Б1): Reply only. */
  readonly tone: boolean;
  /** Its output is a message to the fan and may come in parts (D-15). */
  readonly split: boolean;
  /** Needs the person's draft (Fix). */
  readonly requiresDraft: boolean;
  /** May carry fresh page text from the open chat (D-14; Review and Coach since X52 — `freshTextSurface`). */
  readonly freshText: boolean;
  /** Messages a feature needs (AI-051: the deep ones; Ping, 2026-10-21); 0 — no gate. */
  readonly minMessages: number;
  /** «Ещё раз» repeats the request; «Обновить» also bypasses every cache. */
  readonly rerun: 'regenerate' | 'refresh';
  /** The stream is shown while it runs (Fix: only the stage line, AI-025). */
  readonly streamShown: boolean;
  /** Parts of the result can be inserted into the composer. */
  readonly insertable: boolean;
  readonly timeouts: OpTimeouts;
}

/** AI-051: Review and the full Recap need this many messages. */
export const MIN_MESSAGES_FOR_DEEP = 30;
/** Ping is for a conversation of at least this many messages (the owner, 2026-10-21; the hub's `gate_min_messages`). */
export const MIN_MESSAGES_FOR_PING = 10;

function policy(feature: FeatureId, row: Omit<FeaturePolicy, 'split' | 'freshText' | 'timeouts'>): FeaturePolicy {
  return { ...row, split: isSplitFeature(feature), freshText: freshTextSurface(feature) !== null, timeouts: OP_TIMEOUTS[feature] };
}

export const FEATURE_POLICIES: Readonly<Record<FeatureId, FeaturePolicy>> = {
  reply: policy('reply', {
    place: 'draft-sheet',
    dockAction: 'reply',
    result: 'parts',
    window: 'quick',
    tone: true,
    requiresDraft: false,
    minMessages: 0,
    rerun: 'regenerate',
    streamShown: true,
    insertable: true,
  }),
  fix: policy('fix', {
    place: 'draft-sheet',
    dockAction: 'fix',
    result: 'parts',
    window: 'improve',
    tone: false,
    requiresDraft: true,
    minMessages: 0,
    rerun: 'regenerate',
    streamShown: false,
    insertable: true,
  }),
  hi: policy('hi', {
    place: 'draft-sheet',
    dockAction: 'hi',
    result: 'variants',
    window: 'hi',
    tone: false,
    requiresDraft: false,
    minMessages: 0,
    rerun: 'regenerate',
    streamShown: true,
    insertable: true,
  }),
  ping: policy('ping', {
    place: 'draft-sheet',
    dockAction: 'ping',
    result: 'parts',
    window: 'ping',
    tone: false,
    requiresDraft: false,
    minMessages: MIN_MESSAGES_FOR_PING,
    rerun: 'regenerate',
    streamShown: true,
    insertable: true,
  }),
  review: policy('review', {
    place: 'analysis-sheet',
    dockAction: 'review',
    result: 'review',
    window: 'deep',
    tone: false,
    requiresDraft: false,
    minMessages: MIN_MESSAGES_FOR_DEEP,
    rerun: 'refresh',
    streamShown: true,
    insertable: false,
  }),
  recap: policy('recap', {
    place: 'analysis-sheet',
    dockAction: 'recap',
    result: 'recap',
    window: 'deep',
    tone: false,
    requiresDraft: false,
    minMessages: MIN_MESSAGES_FOR_DEEP,
    rerun: 'refresh',
    streamShown: true,
    insertable: false,
  }),
  'recap-short': policy('recap-short', {
    place: 'analysis-sheet',
    dockAction: 'recap',
    result: 'recap',
    window: 'recap-short',
    tone: false,
    requiresDraft: false,
    minMessages: 0,
    rerun: 'refresh',
    streamShown: true,
    insertable: false,
  }),
  coach: policy('coach', {
    place: 'coach-panel',
    dockAction: 'coach',
    result: 'coach',
    window: 'quick',
    tone: false,
    requiresDraft: false,
    minMessages: 0,
    rerun: 'regenerate',
    streamShown: true,
    insertable: true,
  }),
};

export function policyOf(feature: FeatureId): FeaturePolicy {
  return FEATURE_POLICIES[feature];
}

/** Draft features: their result is a message for the composer (Reply, Fix, Hi, Ping). */
export function isDraftFeature(feature: FeatureId): feature is 'reply' | 'fix' | 'hi' | 'ping' {
  return FEATURE_POLICIES[feature].place === 'draft-sheet';
}

/**
 * Help is removed (Б3, owner's ruling): no button; its key ⌘⇧H / Ctrl+Alt+H
 * is still caught in a chat and answered with «Help пока убран» so that it
 * never reaches ChatSpace.
 */
export const HELP_REMOVED = { catalogAction: 'help', reason: 'help-removed' } as const;
