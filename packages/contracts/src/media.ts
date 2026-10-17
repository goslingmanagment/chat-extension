// 1.28.0 (decision X53): media of the model's vault in a preview send — what
// the picker reads and what a part takes along. The host reads its own API
// for it (OnlyMonster's, with the page's own session), the way its own vault
// dialog does: the folders, one folder's media, which of them this fan
// already got or bought, and the release forms the platform tags a message
// with. None of it is a chat's history: checked live on 2026-10-17, these
// reads leave an unread chat unread (X53). The picker never loads a chat.
// What a part takes along is send-media.ts.

import * as z from 'zod/mini';

import { type ChatRef } from './ids';
import { MEDIA_LIMITS } from './limits';
import { CountSchema, IsoTimestampSchema, NativeIdSchema, displayText, type NativeId } from './primitives';
import { MediaFolderIdSchema, MediaIdSchema, MediaTagsSchema, MediaThumbSchema, MediaTypeSchema, type MediaFolderId, type MediaTags } from './send-media';

/** The folder of every medium (OnlyMonster's «All Media»), then the vault's own folders by id. */

/** `messages`, `posts` — the platform's own folders; `custom` — the model's; anything else — `other`. */
export const MEDIA_FOLDER_KINDS = ['messages', 'posts', 'custom', 'other'] as const;

export const MediaFolderSchema = z.strictObject({
  id: NativeIdSchema,
  name: displayText(200),
  kind: z.enum(MEDIA_FOLDER_KINDS),
  photos: CountSchema,
  videos: CountSchema,
  /** GIFs and audio together. */
  other: CountSchema,
});
export type MediaFolder = z.infer<typeof MediaFolderSchema>;

export const MediaItemSchema = z.strictObject({
  id: NativeIdSchema,
  type: MediaTypeSchema,
  /** Seconds; 0 — a photo, or not said. */
  duration: CountSchema,
  /** The platform finished processing it and the account may send it; a medium that is not is shown, never picked. */
  ready: z.boolean(),
  thumb: z.nullable(MediaThumbSchema),
  createdAt: z.nullable(IsoTimestampSchema),
});
export type MediaItem = z.infer<typeof MediaItemSchema>;

export const MediaFoldersPageSchema = z.strictObject({
  items: z.array(MediaFolderSchema).check(z.maxLength(MEDIA_LIMITS.foldersPage)),
  hasMore: z.boolean(),
});
export type MediaFoldersPage = z.infer<typeof MediaFoldersPageSchema>;

export const MediaItemsPageSchema = z.strictObject({
  items: z.array(MediaItemSchema).check(z.maxLength(MEDIA_LIMITS.mediasPage)),
  hasMore: z.boolean(),
});
export type MediaItemsPage = z.infer<typeof MediaItemsPageSchema>;

/**
 * What this fan got of a medium (OnlyMonster's per-fan media status): `paid` — bought, `unpaid` — sent for a price
 * and not bought, `free` — sent free. A medium never sent to the fan has no entry.
 */
export const MEDIA_FAN_STATES = ['paid', 'unpaid', 'free'] as const;
export const MediaFanStateSchema = z.strictObject({
  id: NativeIdSchema,
  state: z.enum(MEDIA_FAN_STATES),
  /** The price it was sent for, cents; null — free or not said. */
  priceCents: z.nullable(z.int().check(z.gte(0), z.lte(10_000_000))),
});
export type MediaFanState = z.infer<typeof MediaFanStateSchema>;

/**
 * Why a read brought nothing, as the open chat's read says it (host.ts OPEN_CHAT_FAILURES): `endpoint` — the page has
 * not requested its API yet, `session` — no session token, `http` — an error status, `timeout`, `network`, `invalid` —
 * an answer of another shape; and the port's own: `account` — the account is not one the page has loaded,
 * `unavailable` — no bridge or no answer from MAIN.
 */
export const MEDIA_READ_FAILURES = ['endpoint', 'session', 'http', 'timeout', 'network', 'invalid', 'account'] as const;
export type MediaReadFailure = (typeof MEDIA_READ_FAILURES)[number] | 'unavailable';

/** What a read resolves with; it never rejects. */
export type MediaRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: MediaReadFailure; readonly status: number | null };

/** The vault of the account a preview is on (HostPort.media). Reads only; nothing here sends or loads a chat. */
export interface MediaPort {
  folders(hostAccountId: NativeId, offset: number): Promise<MediaRead<MediaFoldersPage>>;
  items(hostAccountId: NativeId, folder: MediaFolderId, offset: number): Promise<MediaRead<MediaItemsPage>>;
  /** Up to MEDIA_LIMITS.idsPerRequest ids. */
  fanStates(chat: ChatRef, ids: readonly NativeId[]): Promise<MediaRead<readonly MediaFanState[]>>;
  /** Up to MEDIA_LIMITS.idsPerRequest ids. */
  tags(hostAccountId: NativeId, ids: readonly NativeId[]): Promise<MediaRead<MediaTags>>;
}

const OffsetSchema = z.int().check(z.gte(0), z.lte(100_000));
const MediaIdsSchema = z.array(NativeIdSchema).check(z.minLength(1), z.maxLength(MEDIA_LIMITS.idsPerRequest));

/**
 * The bridge request `media` (isolated → MAIN): one read of the picker. MAIN finds the account's OnlyFans id in the
 * page's loaded `accounts` (`account` — not loaded, nothing requested) and asks ChatSpace's API: `folders` — a page of
 * the vault's folders; `items` — a page of one folder's media; `states` — what the fan got of these media; `tags` —
 * their release forms (the one POST of the picker: ChatSpace's own composer asks it the same way, for the tags a
 * message with these media carries).
 */
export const MediaRequestSchema = z.discriminatedUnion('of', [
  z.strictObject({ of: z.literal('folders'), acc: NativeIdSchema, offset: OffsetSchema }),
  z.strictObject({ of: z.literal('items'), acc: NativeIdSchema, folder: MediaFolderIdSchema, offset: OffsetSchema }),
  z.strictObject({ of: z.literal('states'), acc: NativeIdSchema, fan: NativeIdSchema, ids: MediaIdsSchema }),
  z.strictObject({ of: z.literal('tags'), acc: NativeIdSchema, ids: z.array(MediaIdSchema).check(z.minLength(1), z.maxLength(MEDIA_LIMITS.idsPerRequest)) }),
]);
export type MediaRequest = z.infer<typeof MediaRequestSchema>;

/** MAIN's answer to `media`: the value of its kind, or why there is none (`status` — the HTTP status of `http`). */
export const MediaAnswerSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    value: z.union([MediaFoldersPageSchema, MediaItemsPageSchema, z.array(MediaFanStateSchema).check(z.maxLength(MEDIA_LIMITS.idsPerRequest)), MediaTagsSchema]),
  }),
  z.strictObject({ ok: z.literal(false), failure: z.enum(MEDIA_READ_FAILURES), status: z.nullable(z.int().check(z.gte(100), z.lte(599))) }),
]);
export type MediaAnswer = z.infer<typeof MediaAnswerSchema>;
