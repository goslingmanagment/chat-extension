// Reply tones (Б1; AI-002…AI-008). The parity set is Casual, Flirt, Sell,
// Spice (ids `casual`, `flirty`, `upsell`, `spicy`); no tone means the
// persona alone (the hub's `none`). A chosen tone is one-off, as in the old
// Fansly extension (decision X68, the owner: «как в старом»): it goes with
// the next Reply and is gone once that request is admitted. X45's «Помнить
// тон в чате» is retired: a stored `generation.rememberTone` is read by
// nothing. There is no default tone. «Ещё раз» repeats the tone of the
// original.

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

/**
 * AI-008: the hotkey walks no tone → Casual → Flirt → Sell → Spice → no tone and starts nothing — over the site's own
 * tones when it has fewer (Telegram spec §6.6).
 */
export function nextTone(current: Tone | null, order: readonly Tone[] = TONE_ORDER): Tone | null {
  if (current === null) return order[0] ?? null;
  const index = order.indexOf(current);
  return index < 0 || index === order.length - 1 ? null : (order[index + 1] ?? null);
}

/** AI-006: picking the tone that is already chosen takes it off. */
export function toggleTone(current: Tone | null, picked: Tone | null): Tone | null {
  return picked === current ? null : picked;
}

/**
 * AI-003: the tone left in the chat after a Reply was admitted with `used` — the same one while the person keeps
 * tones in the chat (X45), none when a tone is one-off (Б1).
 */
export function toneAfterStart(used: Tone | null, remember: boolean): Tone | null {
  return remember ? used : null;
}

/** X68: tones are one-off whatever a store from before says (X45's «Помнить тон в чате» is retired). */
export function remembersTone(_settings?: { readonly generation: { readonly rememberTone?: boolean | undefined } } | null): boolean {
  return false;
}

/**
 * AI-003: what a chat the person left keeps of its tone — nothing while tones are kept in the chat (the desktop's
 * «until the chat switches», X45); the unused one-off tone otherwise, as before.
 */
export function toneOnLeave(tone: Tone | null, remember: boolean): Tone | null {
  return remember ? null : tone;
}

/** AI-007: «Ещё раз» without a new choice repeats the original's tone. */
export function toneForRegenerate(original: Pick<OpView, 'toneUsed' | 'feature'>): Tone | null {
  return original.feature === 'reply' ? original.toneUsed : null;
}
