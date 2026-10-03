// Settings, storage key `settings`, schema v1 (architecture.md §5.6, §9.4,
// D-23). The background owns them: writes go one at a time, migrations run
// only forward at background start, a store newer than the build is read-only
// (CG-STORAGE-VERSION). Identity and sign-in are never stored here.

import * as z from 'zod/mini';

import { LOCALES } from './i18n/keys';
import { NativeIdSchema, boundedText, displayText, HubOriginSchema, CountSchema } from './primitives';

export const SETTINGS_SCHEMA_VERSION = 1;

/** The eight synthesized notification tones (SN-013). */
export const SOUND_TONE_IDS = ['chime', 'drop', 'bell', 'arpeggio', 'knock', 'double', 'soft', 'blip'] as const;
export const ToneIdSchema = z.enum(SOUND_TONE_IDS);
export type ToneId = z.infer<typeof ToneIdSchema>;

export const UI_THEMES = ['host', 'system', 'light', 'dark'] as const;
export type UiTheme = (typeof UI_THEMES)[number];
/** `system` resolves to one of the catalog locales by the browser's languages. */
export const UI_LOCALES = ['system', ...LOCALES] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
/** «Вид ответа» (ui-design §7, X10): the dock result printed on the feed, or on a sheet. */
export const UI_RESULT_STYLES = ['bare', 'sheet'] as const;
export type UiResultStyle = (typeof UI_RESULT_STYLES)[number];
export const COACH_AUTO_RECAP = ['off', 'short', 'full'] as const;
export type CoachAutoRecap = (typeof COACH_AUTO_RECAP)[number];

/** Inclusive ranges of the numeric settings (ST-090…ST-096, ST-130). */
export const SETTINGS_RANGES = {
  /** Reply, Coach (ST-090). */
  windowQuick: { min: 5, max: 200 },
  /** Ping (ST-091). */
  windowPing: { min: 5, max: 200 },
  /** Fix (ST-092). */
  windowImprove: { min: 5, max: 200 },
  /** Review, full Recap (ST-093); also capped by bootstrap `limits.deepMax`. */
  windowDeep: { min: 100, max: 3000 },
  coachHistoryLimit: { min: 1, max: 20 },
  volume: { min: 5, max: 100, step: 5 },
  accountLabelMaxChars: 60,
  mutedAccountsMax: 500,
  personasMax: 500,
  accountLabelsMax: 500,
} as const;

const intIn = (range: { readonly min: number; readonly max: number }) => z.int().check(z.gte(range.min), z.lte(range.max));

const VolumeSchema = intIn(SETTINGS_RANGES.volume).check(
  z.refine((v) => v % SETTINGS_RANGES.volume.step === 0, { message: 'volume moves in steps of 5' }),
);

/** Persona assignment of a page: a reference, never a prompt body (§8.2). */
export const PersonaAssignmentSchema = z.strictObject({
  key: boundedText(64),
  definitionId: boundedText(128),
});

/** Hub pageId as a record key (JSON object keys are strings). */
export const PAGE_ID_KEY_PATTERN = /^[1-9]\d{0,15}$/;
const PageIdKeySchema = z.string().check(z.regex(PAGE_ID_KEY_PATTERN));

export const SettingsV1Schema = z.strictObject({
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
  hub: z.strictObject({ baseUrl: HubOriginSchema }),
  ui: z.strictObject({
    theme: z.enum(UI_THEMES),
    locale: z.enum(UI_LOCALES),
    hints: z.boolean(),
    resultStyle: z.enum(UI_RESULT_STYLES),
  }),
  generation: z.strictObject({
    /** Б7: snapshot of this flag is taken when an operation starts. */
    split: z.boolean(),
    /** Б5: messageCount per feature group. */
    windows: z.strictObject({
      quick: intIn(SETTINGS_RANGES.windowQuick),
      ping: intIn(SETTINGS_RANGES.windowPing),
      improve: intIn(SETTINGS_RANGES.windowImprove),
      deep: intIn(SETTINGS_RANGES.windowDeep),
    }),
    coach: z.strictObject({
      historyLimit: intIn(SETTINGS_RANGES.coachHistoryLimit),
      autoRecap: z.enum(COACH_AUTO_RECAP),
    }),
  }),
  sound: z.strictObject({
    messages: z.strictObject({ on: z.boolean(), tone: ToneIdSchema }),
    subscribers: z.strictObject({ on: z.boolean(), tone: ToneIdSchema }),
    volume: VolumeSchema,
    /** Host accounts (OnlyMonster ids) whose sounds are muted. */
    mutedAccounts: z.array(NativeIdSchema).check(z.maxLength(SETTINGS_RANGES.mutedAccountsMax)),
  }),
  personas: z.strictObject({
    byPageId: z.record(PageIdKeySchema, PersonaAssignmentSchema).check(
      z.refine((r) => Object.keys(r).length <= SETTINGS_RANGES.personasMax, { message: 'too many persona assignments' }),
    ),
  }),
  accounts: z.strictObject({
    /** Local labels of host accounts, ≤ 60 characters. */
    labels: z.record(NativeIdSchema, boundedText(SETTINGS_RANGES.accountLabelMaxChars)).check(
      z.refine((r) => Object.keys(r).length <= SETTINGS_RANGES.accountLabelsMax, { message: 'too many account labels' }),
    ),
  }),
  debug: z.strictObject({ enabled: z.boolean(), renderTrace: z.boolean() }),
  onboarding: z.strictObject({
    checklistDismissed: z.boolean(),
    lastSeenVersion: z.nullable(displayText(32)),
    /** The keys footer under a result: shown on the first five results until dismissed (ui-design §4.3). */
    keysFooter: z.strictObject({ shown: CountSchema, dismissed: z.boolean() }),
  }),
});
export type SettingsV1 = z.infer<typeof SettingsV1Schema>;

/** The current settings shape. */
export type Settings = SettingsV1;
export const SettingsSchema = SettingsV1Schema;

export const DEFAULT_HUB_ORIGIN = 'https://gosling-agency.ru';

/**
 * Defaults. Sound tones follow the Fansly extension (X5: the pilot is parity
 * with it): chime for messages, double for subscribers (ST-127, ST-129).
 */
export const DEFAULT_SETTINGS: SettingsV1 = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  hub: { baseUrl: DEFAULT_HUB_ORIGIN },
  ui: { theme: 'host', locale: 'system', hints: true, resultStyle: 'bare' },
  generation: {
    split: false,
    windows: { quick: 100, ping: 100, improve: 25, deep: 3000 },
    coach: { historyLimit: 10, autoRecap: 'off' },
  },
  sound: {
    messages: { on: true, tone: 'chime' },
    subscribers: { on: true, tone: 'double' },
    volume: 50,
    mutedAccounts: [],
  },
  personas: { byPageId: {} },
  accounts: { labels: {} },
  debug: { enabled: false, renderTrace: false },
  onboarding: { checklistDismissed: false, lastSeenVersion: null, keysFooter: { shown: 0, dismissed: false } },
};

/**
 * A change request. Sections merge shallowly; in the two maps a `null` value
 * removes the key. `mutedAccounts` is replaced as a whole.
 */
export const SettingsPatchSchema = z.strictObject({
  hub: z.optional(z.partial(SettingsV1Schema.shape.hub)),
  ui: z.optional(z.partial(SettingsV1Schema.shape.ui)),
  generation: z.optional(
    z.strictObject({
      split: z.optional(z.boolean()),
      windows: z.optional(z.partial(SettingsV1Schema.shape.generation.shape.windows)),
      coach: z.optional(z.partial(SettingsV1Schema.shape.generation.shape.coach)),
    }),
  ),
  sound: z.optional(
    z.strictObject({
      messages: z.optional(z.partial(SettingsV1Schema.shape.sound.shape.messages)),
      subscribers: z.optional(z.partial(SettingsV1Schema.shape.sound.shape.subscribers)),
      volume: z.optional(VolumeSchema),
      mutedAccounts: z.optional(SettingsV1Schema.shape.sound.shape.mutedAccounts),
    }),
  ),
  personas: z.optional(
    z.strictObject({ byPageId: z.record(PageIdKeySchema, z.nullable(PersonaAssignmentSchema)) }),
  ),
  accounts: z.optional(
    z.strictObject({ labels: z.record(NativeIdSchema, z.nullable(boundedText(SETTINGS_RANGES.accountLabelMaxChars))) }),
  ),
  debug: z.optional(z.partial(SettingsV1Schema.shape.debug)),
  onboarding: z.optional(z.partial(SettingsV1Schema.shape.onboarding)),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

/** What the background answers to a read or a confirmed write: «Сохранено» only on this (ST-013…ST-015). */
export const SettingsStateSchema = z.strictObject({
  settings: SettingsV1Schema,
  /** Grows on every confirmed write. */
  revision: CountSchema,
  /** The stored schema is newer than this build (CG-STORAGE-VERSION): nothing is written. */
  readOnly: z.boolean(),
});
export type SettingsState = z.infer<typeof SettingsStateSchema>;

/**
 * One forward migration step `from → from + 1`. Steps run in order at
 * background start, before the first answer; there are no down-migrations.
 * A step gets the raw stored object of version `from` and returns the raw
 * object of version `to`; the result of the last step must pass
 * SettingsSchema. A step never invents sign-in or identity data.
 */
export interface SettingsMigrationStep {
  readonly from: number;
  readonly to: number;
  migrate(stored: Readonly<Record<string, unknown>>): Record<string, unknown>;
}

/** The full chain, contiguous from the oldest supported version to SETTINGS_SCHEMA_VERSION. */
export type SettingsMigrations = readonly SettingsMigrationStep[];

/** Outcome of loading the `settings` key (§9.4). */
export type SettingsLoadOutcome =
  /** Nothing stored yet: defaults. */
  | { readonly kind: 'fresh'; readonly settings: SettingsV1 }
  /** Current version; optional fields that failed their schema were reset to defaults and named here. */
  | { readonly kind: 'current'; readonly settings: SettingsV1; readonly repaired: readonly string[] }
  | { readonly kind: 'migrated'; readonly settings: SettingsV1; readonly from: number; readonly repaired: readonly string[] }
  /** Stored by a newer build: use what is readable, write nothing, show the banner. */
  | { readonly kind: 'newer'; readonly settings: SettingsV1; readonly storedVersion: number }
  /** Reading failed; the stored value is left untouched. */
  | { readonly kind: 'unreadable'; readonly code: 'CG-STORAGE-READ' };

/** `storage.local` keys besides `settings` (§5.6). The hub token key is read by the background only. */
export const STORAGE_KEYS = {
  settings: 'settings',
  authToken: 'auth.token',
  authMeta: 'auth.meta',
  cacheBootstrap: 'cache.bootstrap',
  cacheCatalog: 'cache.catalog',
  presence: 'presence',
  telemetryQueue: 'telemetry.queue',
  /** X8 attempt journal, no text (§6.7.7). */
  sendJournal: 'send.journal',
  newcomersDrafts: 'newcomers.drafts',
} as const;

/** IndexedDB database of the logs (§9.2). */
export const LOG_DB_NAME = 'cg-logs';
