// The media a preview part takes along (decision X53): the person's picks in
// their order, the free previews among them, the price as typed. Pure: the
// picker's controller keeps one Attachment per preview and turns it into a
// SendMedia only when every rule holds — the same rules SendMediaSchema
// checks at every boundary after it.
//
// - A pick goes to the end; picking it again drops it, and with it its free
//   preview mark. A medium that is not ready is never picked.
// - The price is what the person typed: empty, «0» or «free» — free media;
//   otherwise dollars with at most two decimals, a leading «$» allowed, in
//   OnlyFans' $3…$200. It becomes cents without floating-point arithmetic.
// - Free previews mean something only in a priced message, and a priced one
//   keeps at least one medium behind the price.

import { MEDIA_LIMITS, isMediaPriceCents, type MediaItem, type MediaTags, type SendMedia } from '@cg/contracts';

export interface PickedMedia {
  readonly id: string;
  readonly type: MediaItem['type'];
  readonly duration: number;
  readonly thumb: string | null;
  readonly free: boolean;
}

export interface Attachment {
  readonly picks: readonly PickedMedia[];
  /** The price field as typed. */
  readonly price: string;
}

export const EMPTY_ATTACHMENT: Attachment = { picks: [], price: '' };

/** Picks the medium at the end, or drops it when picked; a full attachment and a medium not ready stay as they are. */
export function togglePick(attachment: Attachment, item: MediaItem): Attachment {
  if (attachment.picks.some((pick) => pick.id === item.id)) return { ...attachment, picks: attachment.picks.filter((pick) => pick.id !== item.id) };
  if (!item.ready || attachment.picks.length >= MEDIA_LIMITS.maxMedia) return attachment;
  return { ...attachment, picks: [...attachment.picks, { id: item.id, type: item.type, duration: item.duration, thumb: item.thumb, free: false }] };
}

/** Turns a pick's free-preview mark on or off. */
export function toggleFree(attachment: Attachment, id: string): Attachment {
  return { ...attachment, picks: attachment.picks.map((pick) => (pick.id === id ? { ...pick, free: !pick.free } : pick)) };
}

export type PriceProblem = 'format' | 'decimals' | 'min' | 'max';
export type ParsedPrice = { readonly ok: true; readonly cents: number } | { readonly ok: false; readonly problem: PriceProblem };

/** The typed price in cents (0 — free), or what is wrong with it. */
export function parsePrice(typed: string): ParsedPrice {
  const text = typed.trim().replace(/^\$\s*/, '').replace(',', '.');
  if (text === '' || /^free$/i.test(text) || /^0+(?:\.0{0,2})?$/.test(text)) return { ok: true, cents: 0 };
  const match = /^(\d{1,6})(?:\.(\d*))?$/.exec(text);
  if (match === null) return { ok: false, problem: 'format' };
  const fraction = match[2] ?? '';
  if (fraction.length > 2) return { ok: false, problem: 'decimals' };
  const cents = Number(match[1]) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents < MEDIA_LIMITS.priceMinCents) return { ok: false, problem: 'min' };
  if (cents > MEDIA_LIMITS.priceMaxCents) return { ok: false, problem: 'max' };
  return { ok: true, cents };
}

/** Why the attachment cannot go as it is; null — it can (or there is nothing to send). */
export type AttachmentProblem = { readonly kind: 'price'; readonly problem: PriceProblem } | { readonly kind: 'all-free' };

export function attachmentProblem(attachment: Attachment): AttachmentProblem | null {
  if (attachment.picks.length === 0) return null;
  const price = parsePrice(attachment.price);
  if (!price.ok) return { kind: 'price', problem: price.problem };
  if (price.cents > 0 && attachment.picks.every((pick) => pick.free)) return { kind: 'all-free' };
  return null;
}

export interface AttachmentSummary {
  readonly count: number;
  /** Free previews that go with the price; 0 in a free message (the marks mean nothing there). */
  readonly previews: number;
  /** null — the price is not valid. */
  readonly priceCents: number | null;
}

export function attachmentSummary(attachment: Attachment): AttachmentSummary {
  const price = parsePrice(attachment.price);
  const priceCents = price.ok ? price.cents : null;
  return { count: attachment.picks.length, previews: priceCents !== null && priceCents > 0 ? attachment.picks.filter((pick) => pick.free).length : 0, priceCents };
}

/** The attachment as a send carries it, or null while it is empty or not valid; the tags are the picks' release forms. */
export function sendMediaOf(attachment: Attachment, tags: MediaTags): SendMedia | null {
  if (attachment.picks.length === 0 || attachmentProblem(attachment) !== null) return null;
  const price = parsePrice(attachment.price);
  if (!price.ok || !isMediaPriceCents(price.cents)) return null;
  const priced = price.cents > 0;
  return {
    items: attachment.picks.map((pick) => ({ id: pick.id, type: pick.type, duration: pick.duration, thumb: pick.thumb, free: priced && pick.free })),
    priceCents: price.cents,
    tags: { users: [...tags.users], guests: [...tags.guests] },
  };
}
