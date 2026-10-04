// The scheduler's baseline reading of a finished generation (architecture.md
// §7 «Разбор и Split», D-15, AI-132): Hi → `[VARIANT]` variants each split by
// `[NEXT]`; Reply, Fix, Ping → `[NEXT]` parts; Review and Recap whole; Coach
// as prose. Actions on a result open only after `done` and a full parse; an
// answer with no usable part is CG-OUTPUT-UNUSABLE, never a silent empty
// result. R11 owns the real parsers (answer cleanup AI-135, Review XML,
// Coach drafts) and plugs them in as drivers; this baseline keeps the
// scheduler whole and testable until they land.

import { type CgCode } from '@cg/contracts/errors';
import { type FeatureId } from '@cg/contracts/features';
import { SPLIT_MARKERS } from '@cg/contracts/hub';
import { PART_LIMITS } from '@cg/contracts/limits';
import { OpResultSchema, type OpResult } from '@cg/contracts/ops';

export interface ParseContext {
  /** Split was asked for at the start (Б7); one part then reads «получилась одна часть» (AI-011). */
  readonly splitRequested: boolean;
  /** `meta.requestId`; recaps are shared by it (H-13). */
  readonly generationRef: string | null;
}

export type ParseOutcome = { readonly ok: true; readonly result: OpResult } | { readonly ok: false; readonly code: CgCode };

const UNUSABLE: ParseOutcome = { ok: false, code: 'CG-OUTPUT-UNUSABLE' };

/** `[NEXT]` parts, trimmed, empty ones dropped. */
export function splitParts(text: string): string[] {
  return text
    .split(SPLIT_MARKERS.next)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Hi: `[VARIANT]` variants, each split into parts; empty variants dropped. */
export function splitVariants(text: string): string[][] {
  return text
    .split(SPLIT_MARKERS.variant)
    .map(splitParts)
    .filter((variant) => variant.length > 0);
}

function checked(result: OpResult): ParseOutcome {
  return OpResultSchema.safeParse(result).success ? { ok: true, result } : UNUSABLE;
}

export function basicParseResult(feature: FeatureId, text: string, ctx: ParseContext): ParseOutcome {
  if (text.trim().length === 0) return UNUSABLE;
  switch (feature) {
    case 'reply':
    case 'fix':
    case 'ping': {
      const parts = splitParts(text);
      if (parts.length === 0 || parts.length > PART_LIMITS.maxParts) return UNUSABLE;
      return checked({ kind: 'parts', parts, splitRequested: ctx.splitRequested });
    }
    case 'hi': {
      const variants = splitVariants(text);
      if (variants.length === 0 || variants.length > PART_LIMITS.maxVariants) return UNUSABLE;
      return checked({ kind: 'variants', variants });
    }
    case 'review':
      return checked({ kind: 'review', doc: null, raw: text.trim() });
    case 'recap':
    case 'recap-short':
      if (ctx.generationRef === null) return UNUSABLE;
      return checked({ kind: 'recap', markdown: text.trim(), coverage: null, shared: { generationRef: ctx.generationRef } });
    case 'coach':
      return checked({ kind: 'coach', answer: { prose: text.trim(), blocks: null, drafts: [] } });
  }
}
