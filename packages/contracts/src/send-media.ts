// 1.24.0 (decision X53): the vault media a preview part takes along — one
// message, the part's text as its caption, the media in the person's order, an
// optional price (PPV) and the free previews among them, the creators their
// release forms tag. The price is in cents and goes as OnlyFans takes it —
// USD, $3…$200 — or 0 for free media. Apart from media.ts (what the picker
// reads) so that what imports the send's schemas does not pay for the picker's.

import * as z from 'zod/mini';

import { MEDIA_LIMITS } from './limits';
import { CountSchema, NativeIdSchema } from './primitives';

export const MEDIA_TYPES = ['photo', 'video', 'gif', 'audio'] as const;
export const MediaTypeSchema = z.enum(MEDIA_TYPES);
export type MediaType = z.infer<typeof MediaTypeSchema>;

/** An https address of a thumbnail as the host gives it; anything else is no thumbnail. */
export const MediaThumbSchema = z.string().check(z.maxLength(MEDIA_LIMITS.maxThumbChars), z.regex(/^https:\/\/[^\s"'<>]+$/));

/** The creators a message with these media is tagged with (their release forms): OnlyFans users, guests by their form. */
export const MediaTagsSchema = z.strictObject({
  users: z.array(NativeIdSchema).check(z.maxLength(MEDIA_LIMITS.idsPerRequest)),
  guests: z.array(NativeIdSchema).check(z.maxLength(MEDIA_LIMITS.idsPerRequest)),
});
export type MediaTags = z.infer<typeof MediaTagsSchema>;

/** A price in cents a message may carry: 0 (free media) or OnlyFans' PPV range. */
export const isMediaPriceCents = (cents: number): boolean => Number.isInteger(cents) && (cents === 0 || (cents >= MEDIA_LIMITS.priceMinCents && cents <= MEDIA_LIMITS.priceMaxCents));

/**
 * The media a part takes along (PreviewSendRequest.media): the person's order, each with what the host's composer
 * keeps of it (type, duration, thumbnail: ChatSpace's «back to the composer» of a failed send shows them), the free
 * previews among them, the price, the release-form tags. A free preview belongs to a priced message, and a priced one
 * keeps at least one medium behind the price.
 */
export const SendMediaSchema = z
  .strictObject({
    items: z
      .array(
        z.strictObject({
          id: NativeIdSchema,
          type: MediaTypeSchema,
          duration: CountSchema,
          thumb: z.nullable(MediaThumbSchema),
          free: z.boolean(),
        }),
      )
      .check(z.minLength(1), z.maxLength(MEDIA_LIMITS.maxMedia)),
    priceCents: z.int().check(z.refine(isMediaPriceCents, { message: 'price' })),
    tags: MediaTagsSchema,
  })
  .check(
    z.refine((m) => new Set(m.items.map((item) => item.id)).size === m.items.length, { message: 'repeat' }),
    z.refine((m) => m.priceCents > 0 || m.items.every((item) => !item.free), { message: 'previews need a price' }),
    z.refine((m) => m.priceCents === 0 || m.items.some((item) => !item.free), { message: 'all free' }),
  );
export type SendMedia = z.infer<typeof SendMediaSchema>;
