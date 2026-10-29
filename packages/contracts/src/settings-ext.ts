// Settings beyond v1: storage key `settings.ext` (1.15.0; R20 FS-SET-1,
// docs/project-unite/architecture.md §12). Settings v1 do not change for a
// second site; what they cannot say lives here, under a version of its own:
// a site's own settings (`hosts`) and a Recap depth above v1's 3000
// (`windows.deep`).
//
// Why a separate key. A build before 1.15.0 neither knows nor touches it:
// its v1 owner writes only `settings`, and its repair drops unknown fields
// only inside `settings`. So new → old (the person changes the theme) → new
// loses nothing: the Fansly settings, the depth and with `enabled` the
// script registration are there again (the rollback acceptance of P4a3,
// core/src/services/settings-owner.test.ts).
//
// The stored value and the view differ on purpose:
// - stored: `{v: 1, hosts?: {'fansly-web'?: {…some fields}}, windows?: {deep?}}`
//   — only what the person set, plus whatever a later build of the same
//   version added. A write changes only the fields its patch names and keeps
//   every other stored field as it is, known or not: each field has one
//   owner, and a default never overwrites a stored value (nor is written
//   down: a later build may change a default);
// - read (`SettingsExt`): every field, defaults filling what is not stored or
//   does not read (named in the load outcome, like v1's repair).
// A stored `v` above this build's is read-only (CG-STORAGE-VERSION) for this
// key only; v1 stays writable.
//
// Light enough for pages and the background; the ChatSpace tab bundle never
// imports it (nor does `settings.ts`: the tab request registry carries v1
// only). Not in the package index for the same reason.

import * as z from 'zod/mini';

import { AI_REQUEST_LIMITS } from './limits';
import { CountSchema } from './primitives';
import { ToneIdSchema } from './settings';

export const SETTINGS_EXT_VERSION = 1;

/**
 * «Заметки» (FS-NOTE-2): «Всегда справа» (`docked`: read for every open chat), «Справа по кнопке» (`drawer`, the
 * default: no Fansly read until the panel opens), «Окно по центру» (`center`). One choice for all tabs.
 */
export const FANSLY_NOTES_VIEWS = ['docked', 'drawer', 'center'] as const;
export type FanslyNotesView = (typeof FANSLY_NOTES_VIEWS)[number];

/**
 * Who waits for a reply in Fansly's own list of chats (2026-10-29): `dot` — a muted terracotta dot on the avatar of a
 * fan who wrote last (the default); `we` — «Мы:» before the preview of a chat where the model wrote last; `off`.
 */
export const FANSLY_INBOX_MARKS = ['dot', 'we', 'off'] as const;
export type FanslyInboxMark = (typeof FANSLY_INBOX_MARKS)[number];

export const SETTINGS_EXT_RANGES = {
  /**
   * The person's Recap depth above v1's 3000 (architecture §12: three limits). Up to 3000 it stays in v1
   * (`generation.windows.deep`); the effective depth is this one when set, else v1's, and never above the hub's
   * `limits.deepMax` (P4b2).
   */
  windowDeep: { min: 3001, max: AI_REQUEST_LIMITS.messageCountMax },
} as const;

const intIn = (range: { readonly min: number; readonly max: number }) => z.int().check(z.gte(range.min), z.lte(range.max));

/** fansly.com (`hosts['fansly-web']`). */
export const FanslySettingsSchema = z.strictObject({
  /** «Fansly включён» (§4): the person's own switch, apart from the browser's permissions — leftover permissions never switch an «off» on. */
  enabled: z.boolean(),
  /** «Fansly через вкладку» (FS-NET-4): requests go through a relay frame in the model's tab. Off by default (X33). */
  viaTab: z.boolean(),
  notesView: z.enum(FANSLY_NOTES_VIEWS),
  /** The mark of a chat waiting for a reply in Fansly's list of chats (2026-10-29). */
  inboxMark: z.enum(FANSLY_INBOX_MARKS),
  /** The tones on Fansly (FS-SND-2, X26); whether a sound plays at all, the volume and the muted accounts are v1's, shared. */
  sound: z.strictObject({ messagesTone: ToneIdSchema, subscribersTone: ToneIdSchema }),
});
export type FanslySettings = z.infer<typeof FanslySettingsSchema>;

/** The Fansly extension's own tones (chime for a message, double for a subscriber: X26) and «Справа по кнопке». */
export const DEFAULT_FANSLY_SETTINGS: FanslySettings = {
  enabled: false,
  viaTab: false,
  notesView: 'drawer',
  inboxMark: 'dot',
  sound: { messagesTone: 'chime', subscribersTone: 'double' },
};

/** Telegram Web A (`hosts['telegram-web']`, Telegram spec §6.3): «Включить Telegram», the person's own switch. */
export const TelegramSettingsSchema = z.strictObject({ enabled: z.boolean() });
export type TelegramSettings = z.infer<typeof TelegramSettingsSchema>;
export const DEFAULT_TELEGRAM_SETTINGS: TelegramSettings = { enabled: false };

/** The key as a build of this version reads it: every field, defaults filling the rest. */
export const SettingsExtSchema = z.strictObject({
  v: z.literal(SETTINGS_EXT_VERSION),
  hosts: z.strictObject({ 'fansly-web': FanslySettingsSchema, 'telegram-web': TelegramSettingsSchema }),
  /** null — no wish above 3000: the depth is v1's. */
  windows: z.strictObject({ deep: z.nullable(intIn(SETTINGS_EXT_RANGES.windowDeep)) }),
});
export type SettingsExt = z.infer<typeof SettingsExtSchema>;

export const DEFAULT_SETTINGS_EXT: SettingsExt = {
  v: SETTINGS_EXT_VERSION,
  hosts: { 'fansly-web': DEFAULT_FANSLY_SETTINGS, 'telegram-web': DEFAULT_TELEGRAM_SETTINGS },
  windows: { deep: null },
};

/** A change: only the named fields are written; `windows.deep: null` removes the wish. */
export const SettingsExtPatchSchema = z.strictObject({
  hosts: z.optional(
    z.strictObject({
      'fansly-web': z.optional(
        z.strictObject({
          enabled: z.optional(z.boolean()),
          viaTab: z.optional(z.boolean()),
          notesView: z.optional(z.enum(FANSLY_NOTES_VIEWS)),
          inboxMark: z.optional(z.enum(FANSLY_INBOX_MARKS)),
          sound: z.optional(z.partial(FanslySettingsSchema.shape.sound)),
        }),
      ),
      'telegram-web': z.optional(z.strictObject({ enabled: z.optional(z.boolean()) })),
    }),
  ),
  windows: z.optional(z.strictObject({ deep: z.optional(z.nullable(intIn(SETTINGS_EXT_RANGES.windowDeep))) })),
});
export type SettingsExtPatch = z.infer<typeof SettingsExtPatchSchema>;

/** A read or a confirmed write of the key, as v1's SettingsState: «Сохранено» only on this, with its revision. */
export const SettingsExtStateSchema = z.strictObject({
  ext: SettingsExtSchema,
  /** Grows on every confirmed write of this key (its own counter, apart from v1's). */
  revision: CountSchema,
  /** A newer build stored the key (CG-STORAGE-VERSION): nothing of it is written. */
  readOnly: z.boolean(),
});
export type SettingsExtState = z.infer<typeof SettingsExtStateSchema>;

/** Outcome of loading the key; v1 of it is the first, so there is no migration yet. */
export type SettingsExtLoadOutcome =
  /** Nothing stored: defaults. */
  | { readonly kind: 'fresh'; readonly ext: SettingsExt }
  /** This build's version; fields that did not read are defaults now, named by path (they stay stored as they were). */
  | { readonly kind: 'current'; readonly ext: SettingsExt; readonly repaired: readonly string[] }
  /** Stored by a newer build: what reads is used, nothing is written. */
  | { readonly kind: 'newer'; readonly ext: SettingsExt; readonly storedVersion: number }
  /** Reading failed; the stored value is left untouched. */
  | { readonly kind: 'unreadable'; readonly code: 'CG-STORAGE-READ' };
