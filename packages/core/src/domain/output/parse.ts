// The result of a finished generation (architecture.md §7 «Разбор и Split»,
// D-15; AI-132): the parser the background's scheduler runs on the whole
// answer after `done`, one per feature. Actions on a result exist only after
// this parse; an answer with nothing usable is CG-OUTPUT-UNUSABLE and is
// never retried by itself. Recap and Review are never split.

import { type FeatureId } from '@cg/contracts/features';
import { OpResultSchema, type OpResult } from '@cg/contracts/ops';

import { type ParseContext, type ParseOutcome } from '../ops/result';
import { coachPreview, parseCoachAnswer } from './coach';
import { hideOpenThinkBlock } from './cleanup';
import { parseDraft } from './drafts';
import { withoutMarkers } from './markers';
import { recapText } from './recap';
import { parseReviewDoc, reviewPreview } from './review';

const UNUSABLE: ParseOutcome = { ok: false, code: 'CG-OUTPUT-UNUSABLE' };

/** A result that does not fit its contract schema is not a result. */
function checked(result: OpResult): ParseOutcome {
  return OpResultSchema.safeParse(result).success ? { ok: true, result } : UNUSABLE;
}

export function parseOutput(feature: FeatureId, text: string, ctx: ParseContext): ParseOutcome {
  if (text.trim().length === 0) return UNUSABLE;
  switch (feature) {
    case 'reply':
    case 'fix':
    case 'ping':
    case 'hi': {
      const parsed = parseDraft(feature, text, ctx.splitRequested);
      return parsed.ok ? checked(parsed.result) : parsed;
    }
    case 'review': {
      // AI-052: a frame that does not read is the raw text, not an error.
      const raw = text.trim();
      return checked({ kind: 'review', doc: parseReviewDoc(raw), raw });
    }
    case 'recap':
    case 'recap-short': {
      // Recaps are shared by their generation (H-13): no ref, no shared artifact.
      if (ctx.generationRef === null) return UNUSABLE;
      const markdown = recapText(text);
      return markdown.length === 0 ? UNUSABLE : checked({ kind: 'recap', markdown, coverage: null, shared: { generationRef: ctx.generationRef } });
    }
    case 'coach': {
      const answer = parseCoachAnswer(text);
      return answer === null ? UNUSABLE : checked({ kind: 'coach', answer });
    }
  }
}

/**
 * The text shown while an answer streams (§7: a preview without actions):
 * no reasoning block, no Split marker or piece of one, no XML frame of a
 * Review, no draft fence of Coach. Any chunking of the same text gives the
 * same preview once the text is whole.
 */
export function streamPreview(feature: FeatureId, text: string): string {
  switch (feature) {
    case 'review':
      return reviewPreview(hideOpenThinkBlock(text));
    case 'coach':
      return coachPreview(text);
    case 'recap':
    case 'recap-short':
      return hideOpenThinkBlock(text).trim();
    case 'reply':
    case 'fix':
    case 'ping':
    case 'hi':
      return withoutMarkers(hideOpenThinkBlock(text)).trim();
  }
}
