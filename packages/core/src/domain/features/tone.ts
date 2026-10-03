// Reply tones (Б1; AI-002…AI-008). The parity set is Casual, Flirt, Sell,
// Spice (ids `casual`, `flirty`, `upsell`, `spicy`); no tone means the
// persona alone (the hub's `none`). A chosen tone is one-off: it goes with
// the next Reply of that chat and is gone once that request is admitted.
// There is no default tone. «Ещё раз» repeats the tone of the original.

import { TONES, type Tone } from '@cg/contracts/features';
import { type UiTextKey } from '@cg/contracts/i18n/keys';
import { type OpView } from '@cg/contracts/ops';

/** AI-002: the menu order; «Без тона» is the UI's last item. */
export const TONE_ORDER: readonly Tone[] = TONES;

/** AI-004: nothing is chosen until the person chooses. */
export const DEFAULT_TONE: Tone | null = null;

export const TONE_LABEL_KEYS: Readonly<Record<Tone, UiTextKey>> = {
  casual: 'dock.tone.casual',
  flirty: 'dock.tone.flirty',
  upsell: 'dock.tone.upsell',
  spicy: 'dock.tone.spicy',
};

/** AI-008: the hotkey walks no tone → Casual → Flirt → Sell → Spice → no tone and starts nothing. */
export function nextTone(current: Tone | null): Tone | null {
  if (current === null) return TONE_ORDER[0] ?? null;
  const index = TONE_ORDER.indexOf(current);
  return index < 0 || index === TONE_ORDER.length - 1 ? null : (TONE_ORDER[index + 1] ?? null);
}

/** AI-006: picking the tone that is already chosen takes it off. */
export function toggleTone(current: Tone | null, picked: Tone | null): Tone | null {
  return picked === current ? null : picked;
}

/** AI-003: the tone left after a Reply was admitted with it — none. */
export function toneAfterStart(): Tone | null {
  return null;
}

/** AI-007: «Ещё раз» without a new choice repeats the original's tone. */
export function toneForRegenerate(original: Pick<OpView, 'toneUsed' | 'feature'>): Tone | null {
  return original.feature === 'reply' ? original.toneUsed : null;
}
