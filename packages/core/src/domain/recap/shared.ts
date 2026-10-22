// Shared recaps of the hub as local copies (H-13, REC-01, AI-061, AI-063,
// AI-065; architecture.md §7 «Recap: общий и досье», §8.5). `recap.read`
// answers the full and the short recap of a page, fan and persona — the
// same for every granted chatter; this module turns a body, or a recap
// this tab just generated, into the copy a slot keeps. The text is prepared
// once here (AI-137): reasoning out, line ends normalised, a recap of either
// length cut into its headed blocks.

import { RECAP_TRANSCRIPT_COVERAGES, type RecapBody, type SharedRecaps } from '@cg/contracts/hub';
import { type CoverageLevel, type OpView, type ResultMarkVM } from '@cg/contracts/ops';
import { type RecapLength } from '@cg/contracts/vm';

import { recapBlocks, recapText } from '../output/recap';
import { type RecapCopy } from './slots';

type TranscriptCoverage = (typeof RECAP_TRANSCRIPT_COVERAGES)[number];

/**
 * The hub's transcript coverage as our coverage word: the whole history was
 * read — complete; only a window — partial; anything else — unknown.
 */
export function coverageLevelOf(transcriptCoverage: string | null): CoverageLevel {
  const known = (RECAP_TRANSCRIPT_COVERAGES as readonly string[]).includes(transcriptCoverage ?? '') ? (transcriptCoverage as TranscriptCoverage) : null;
  if (known === 'full-history') return 'complete';
  return known === 'window' ? 'partial' : 'unknown';
}

const count = (value: number | null): number | null => (value !== null && Number.isInteger(value) && value >= 0 ? value : null);

export interface CopyIds {
  /** A new local handle (UUID) for a copy the tab has not held before. */
  readonly newLocalId: () => string;
  readonly now: number;
  readonly stale?: ResultMarkVM | null;
}

/** A shared recap body as a slot copy; null when the body has no text. */
export function copyOfShared(body: RecapBody, length: RecapLength, savedToProfile: boolean | null, ids: CopyIds): RecapCopy | null {
  const markdown = recapText(body.text);
  if (markdown.length === 0) return null;
  return {
    length,
    id: body.generationRef,
    revision: body.generatedAt,
    localId: ids.newLocalId(),
    markdown,
    blocks: recapBlocks(markdown),
    coverage: { level: coverageLevelOf(body.coverage.transcriptCoverage), requested: count(body.coverage.requestedCount), served: count(body.coverage.keptCount) },
    savedToProfile: length === 'full' ? savedToProfile : null,
    source: 'hub',
    opId: null,
    stale: ids.stale ?? null,
    storedAt: ids.now,
  };
}

/** Both slots of a `recap.read` answer. */
export function copiesOfShared(shared: SharedRecaps, ids: CopyIds): { readonly short: RecapCopy | null; readonly full: RecapCopy | null } {
  return {
    short: shared.short === null ? null : copyOfShared(shared.short, 'short', null, ids),
    full: shared.full === null ? null : copyOfShared(shared.full, 'full', shared.fullSavedToProfile, ids),
  };
}

/**
 * A recap this tab generated, as a copy of the shared artifact it has just
 * become on the hub. Its id is the generation ref of the result; nothing of
 * it is private to this chatter.
 */
export function copyOfResult(view: Pick<OpView, 'opId' | 'feature' | 'result' | 'endedAt'>, ids: Omit<CopyIds, 'stale'>): RecapCopy | null {
  const result = view.result;
  if (result === undefined || result.kind !== 'recap' || (view.feature !== 'recap' && view.feature !== 'recap-short')) return null;
  const length: RecapLength = view.feature === 'recap' ? 'full' : 'short';
  const coverage = result.coverage;
  return {
    length,
    id: result.shared.generationRef,
    revision: new Date(view.endedAt ?? ids.now).toISOString(),
    localId: ids.newLocalId(),
    markdown: result.markdown,
    blocks: recapBlocks(result.markdown),
    coverage: coverage === null ? { level: 'unknown', requested: null, served: null } : { level: coverage.level, requested: coverage.requested, served: coverage.served },
    savedToProfile: length === 'full' ? false : null,
    source: 'generated',
    opId: view.opId,
    stale: null,
    storedAt: ids.now,
  };
}
