// Temporary chat pins in Fansly's own list of chats (2026-11-12): a chatter pins a chat from its row or from the open
// chat's header, and the pinned chats stand as chips in one strip between Fansly's filter chips and the list. A pin is
// the person's own, in this Firefox (storage.local, per creator, never sent to the hub), and goes by itself after
// six hours without activity the extension saw in its chat; at most six a creator, a seventh takes off the quietest.
//
// The background is the one owner of the stored pins (core services/hosts/fansly/pins.ts); a tab asks it
// (`fansly.pins.read`, `fansly.pins.change`, contracts tab-messages-fansly.ts) and hears its changes
// (`fansly.pins.changed`), never writes a whole list. The rules over a list are pure (core
// domain/hosts/fansly/pins.ts). The view a tab draws and the client it draws through are here too, as types only.

import * as z from 'zod/mini';

import { EpochMsSchema, NativeIdSchema, boundedText } from './primitives';

export const FANSLY_PIN_LIMITS = {
  /** Pins of one creator; a seventh takes off the quietest (the smallest `touchedAt`). */
  max: 6,
  /** Six hours without activity the extension saw in the chat: the pin goes by itself. */
  quietMs: 6 * 60 * 60 * 1000,
  /** A fan's name and handle as a chip shows them. */
  nameMaxChars: 64,
  usernameMaxChars: 64,
  /** The strip's height while it stands, CSS pixels. */
  stripPx: 44,
  /** A tab tells the background a chat's activity at most this often per chat (leading and trailing). */
  touchEveryMs: 30_000,
} as const;

export { FANSLY_PIN_GLYPH } from './fansly-pin-glyph';

/** What a pin names: the chat, its one fan, the name and the handle the chip shows. */
export const FanslyPinTargetSchema = z.strictObject({
  groupId: NativeIdSchema,
  fanId: NativeIdSchema,
  name: boundedText(FANSLY_PIN_LIMITS.nameMaxChars),
  username: z.optional(boundedText(FANSLY_PIN_LIMITS.usernameMaxChars)),
});
export type FanslyPinTarget = z.infer<typeof FanslyPinTargetSchema>;

/** One stored pin: its target, when it was pinned and the last activity seen in its chat (epoch ms). */
export const FanslyPinSchema = z.strictObject({
  ...FanslyPinTargetSchema.shape,
  pinnedAt: EpochMsSchema,
  touchedAt: EpochMsSchema,
});
export type FanslyPin = z.infer<typeof FanslyPinSchema>;

/** One creator's pins, oldest pinned first: the order the strip shows them in, which never changes by itself. */
export const FanslyPinListSchema = z.array(FanslyPinSchema).check(z.maxLength(FANSLY_PIN_LIMITS.max));

/** A change a tab asks for: idempotent, never «toggle», never a whole list. */
export type FanslyPinOp =
  | { readonly op: 'pin'; readonly pin: FanslyPinTarget }
  | { readonly op: 'unpin'; readonly groupId: string }
  | { readonly op: 'touch'; readonly groupId: string; readonly at: number };

// ── The tab's view (types only) ──────────────────────────────────────────────

/**
 * A chip of the strip. `in` — added while the strip stood (it enters); `shown`; `tombstone` — taken off while the
 * pointer or the focus is in the strip: an inert, invisible placeholder of its own width, so nothing moves under the
 * pointer; `closing` — its place closes, then it is gone.
 */
export interface FanslyPinChip {
  readonly groupId: string;
  readonly name: string;
  readonly username: string | null;
  /** The circle's letter. */
  readonly initial: string;
  /** The circle's hue, 0–359, from the group id. */
  readonly hue: number;
  /** The fan has the last word (MAIN's `fx.lastWord`); false — the model, or not known. */
  readonly waiting: boolean;
  /** The chat open in the tab. */
  readonly open: boolean;
  readonly state: 'in' | 'shown' | 'tombstone' | 'closing';
}

export interface FanslyPinsView {
  /** The strip is mounted: there is a pin, or the strip still stands while the pointer is over the list. */
  readonly visible: boolean;
  /** The strip's height now: it changes only while the pointer is not over the list. */
  readonly height: 0 | 44;
  readonly chips: readonly FanslyPinChip[];
  /** The open chat in the header: whether it is pinned; null — no direct chat open, or the switch is off. */
  readonly header: { readonly pinned: boolean } | null;
}

/** What the strip and the header button act through (core application/hosts/fansly/pins.ts). */
export interface FanslyPinsClient {
  view(): FanslyPinsView;
  subscribe(listener: (view: FanslyPinsView) => void): () => void;
  /** A chip's click: the chat opens through Fansly's own router; the open chat's own chip does nothing. */
  open(groupId: string): void;
  /** The chip's ×. */
  unpin(groupId: string): void;
  /** The header's button: the open chat pinned, or unpinned. */
  toggleOpen(): void;
  /** The pointer or the keyboard focus is inside the strip (true) or left it (false): its layout is frozen meanwhile. */
  hold(inside: boolean): void;
}

/** The words of the strip and the buttons, by the tab's language (core domain/hosts/fansly/i18n/pins.ts). */
export interface FanslyPinsCopy {
  /** The strip's accessible name. */
  readonly strip: string;
  readonly pin: string;
  readonly unpin: string;
  /** A chip's title: «Имя (@ник). Снимется сам через 6 ч тишины». */
  chipTitle(name: string, username: string | null): string;
  /** The fallback name of a chat whose fan has no name known. */
  readonly chat: string;
}
