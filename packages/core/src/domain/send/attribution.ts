// Who sent each message, and how its text was written (Chat Memory week 1;
// hub `clientSendAttributions` `composedWith`). The tab knows the draft — ours
// or the person's own — and the background knows which button made an insert of
// ours (the operation's feature, from `op.reportSent` of the same message).
// Pure.

import type { SendAttributionComposedWith } from '@cg/contracts/hub';
import type { SendWrote, SentDraft } from '@cg/contracts/host';

/** How a linked draft was written: a text that descends from our insert is `ours`, the person's own is `hand`. */
export function wroteOf(draft: SentDraft): SendWrote {
  if (draft.insertIntentId !== null || draft.provenance === 'our-insert') return 'ours';
  return draft.provenance === 'human-or-unknown' ? 'hand' : 'unknown';
}

/** The buttons whose insert the hub's record names (the operation's feature, contracts FEATURE_IDS). */
const COMPOSED_WITH_FEATURES: ReadonlySet<string> = new Set<SendAttributionComposedWith>(['reply', 'fix', 'hi', 'ping', 'coach']);

/** The hub's word for the button behind an operation's insert; a feature with no word of its own (Recap, Voice) is `unknown`. */
export function composedWithOfFeature(feature: string | null | undefined): SendAttributionComposedWith {
  return feature !== null && feature !== undefined && COMPOSED_WITH_FEATURES.has(feature) ? (feature as SendAttributionComposedWith) : 'unknown';
}

/**
 * The record's `composedWith`: the person's own text is `hand`; an insert of ours is the button the background learned
 * for this very message (`learned`), else `unknown` — never a guess.
 */
export function composedWithOf(wrote: SendWrote | undefined, learned: SendAttributionComposedWith | null): SendAttributionComposedWith {
  if (wrote === 'hand') return 'hand';
  if (wrote === 'ours') return learned ?? 'unknown';
  return 'unknown';
}
