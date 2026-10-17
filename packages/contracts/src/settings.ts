// Settings, storage key `settings`, schema v1 (architecture.md §5.6, §9.4,
// D-23). The background owns them: writes go one at a time, migrations run
// only forward at background start, a store newer than the build is read-only
// (CG-STORAGE-VERSION). Identity and sign-in are never stored here.
//
// v1 does not change for a second site (R20, FS-SET-1): what it cannot say —
// a site's own settings, a Recap depth above 3000 — lives in the separate,
// separately versioned key `settings.ext` (STORAGE_KEYS.settingsExt; its
// schema is settings-ext.ts). A build before 1.15.0 neither knows nor touches
// that key, so a rollback and a return lose nothing.

import * as z from 'zod/mini';

import { LOCALES } from './i18n/keys';
import { HOST_KINDS, type HostKind } from './hosts';
import { CountSchema, HubIntIdSchema, HubOriginSchema, PersonaDefinitionIdSchema, PersonaKeySchema, boundedText, displayText } from './primitives';

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
/**
 * «Размер текста» (1.22.0, decision X49): `large` — our surfaces in a site's tab (the dock, the windows, the panels,
 * the toasts) read the type scale a step up (base 13 → 15 px, captions 11–12 → 13 px). The extension pages keep theirs.
 */
export const UI_TEXT_SIZES = ['normal', 'large'] as const;
export type UiTextSize = (typeof UI_TEXT_SIZES)[number];
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
  /** Review, full Recap (ST-093): v1 stays ≤ 3000; a larger wish lives in settings.ext, admission in `limits.deepMax`. */
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
  key: PersonaKeySchema,
  definitionId: PersonaDefinitionIdSchema,
});

/**
 * A host account across hosts, `${host}:${hostAccountId}` (ChatKey without
 * the fan): the key of the per-account settings, so the fansly-web accounts
 * of R20 never land on an OnlyMonster account with the same number.
 */
export type HostAccountKey = `${HostKind}:${string}`;
export const HOST_ACCOUNT_KEY_PATTERN = new RegExp(`^(?:${HOST_KINDS.join('|')}):[1-9]\\d{0,29}$`);
export const HostAccountKeySchema = z.custom<HostAccountKey>((value) => typeof value === 'string' && HOST_ACCOUNT_KEY_PATTERN.test(value));

export function hostAccountKeyOf(host: HostKind, hostAccountId: string): HostAccountKey {
  return `${host}:${hostAccountId}`;
}

/**
 * Whose persona choices `personas.byPageId` holds: pageIds are numbers of
 * one hub, so the background clears the map (and sets this) whenever another
 * hub origin or another user signs in. Written by the background only.
 */
export const PersonaScopeSchema = z.strictObject({ hubOrigin: HubOriginSchema, userId: HubIntIdSchema });

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
    /**
     * 1.22.0 (X49): optional — a store written before reads as `normal`, with nothing to repair; a build before 1.22.0
     * drops it (its repair keeps only the fields it knows), and the text is normal there.
     */
    textSize: z.optional(z.enum(UI_TEXT_SIZES)),
  }),
  generation: z.strictObject({
    /** Б7: snapshot of this flag is taken when an operation starts. */
    split: z.boolean(),
    /**
     * «Помнить тон в чате» (1.18.0, decision X45): on — a tone chosen for Reply stays for that chat until the person
     * changes it or opens another chat, as in the OnlyFans desktop; off — the one-off tone of Б1, gone once a Reply
     * took it. Optional: a store written before 1.18.0 has no such field and reads as on, with nothing to repair; a
     * build before 1.18.0 drops it (its repair keeps only the fields it knows), and the choice reads as on again.
     */
    rememberTone: z.optional(z.boolean()),
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
    /** Host accounts whose sounds are muted. */
    mutedAccounts: z.array(HostAccountKeySchema).check(z.maxLength(SETTINGS_RANGES.mutedAccountsMax)),
  }),
  personas: z.strictObject({
    scope: z.nullable(PersonaScopeSchema),
    byPageId: z.record(PageIdKeySchema, PersonaAssignmentSchema).check(
      z.refine((r) => Object.keys(r).length <= SETTINGS_RANGES.personasMax, { message: 'too many persona assignments' }),
    ),
  }),
  accounts: z.strictObject({
    /** Local labels of host accounts, ≤ 60 characters. */
    labels: z.record(HostAccountKeySchema, boundedText(SETTINGS_RANGES.accountLabelMaxChars)).check(
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
 * Defaults. Sound tones are the OnlyFans desktop app's own — blip for
 * messages, arpeggio for subscribers (ST-127, ST-129; 1.12.0, decision X26):
 * a chatter who works OnlyFans here and Fansly in the Fansly extension (chime,
 * double) hears which of the two rings. Until 1.12.0 they were the Fansly
 * extension's; a stored chime or double is a choice and stays.
 *
 * The language is Russian (ST-135, I18-001; 1.14.0, decision X29): the
 * chatters, the guide and the site are Russian, and a browser set to English
 * — a stock Firefox, an antidetect profile — says nothing about its person.
 * «Как в системе» and English stay a choice in the settings. Until 1.14.0 the
 * default was `system`, and the first start writes the defaults down: an
 * install made before 1.14.0 has `system` stored and keeps it (no migration;
 * the person switches in «Вид и звук»).
 */
export const DEFAULT_SETTINGS: SettingsV1 = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  hub: { baseUrl: DEFAULT_HUB_ORIGIN },
  ui: { theme: 'host', locale: 'ru', hints: true, resultStyle: 'bare', textSize: 'normal' },
  generation: {
    split: false,
    rememberTone: true,
    windows: { quick: 100, ping: 100, improve: 25, deep: 3000 },
    coach: { historyLimit: 10, autoRecap: 'off' },
  },
  sound: {
    messages: { on: true, tone: 'blip' },
    subscribers: { on: true, tone: 'arpeggio' },
    volume: 50,
    mutedAccounts: [],
  },
  personas: { scope: null, byPageId: {} },
  accounts: { labels: {} },
  debug: { enabled: false, renderTrace: false },
  onboarding: { checklistDismissed: false, lastSeenVersion: null, keysFooter: { shown: 0, dismissed: false } },
};

/** Sections only the options page may change (`settings.patchRestricted`, §14): the hub address and debug. */
export const SETTINGS_OPTIONS_ONLY_SECTIONS = ['hub', 'debug'] as const;

/**
 * A change request. Sections merge shallowly; in the two maps a `null` value
 * removes the key. `mutedAccounts` is replaced as a whole. `personas.scope`
 * is never patched: the background owns it.
 */
export const SettingsPatchSchema = z.strictObject({
  hub: z.optional(z.partial(SettingsV1Schema.shape.hub)),
  ui: z.optional(z.partial(SettingsV1Schema.shape.ui)),
  generation: z.optional(
    z.strictObject({
      split: z.optional(z.boolean()),
      rememberTone: z.optional(z.boolean()),
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
    z.strictObject({ labels: z.record(HostAccountKeySchema, z.nullable(boundedText(SETTINGS_RANGES.accountLabelMaxChars))) }),
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
  /**
   * 1.15.0 (R20, FS-SET-1): what settings v1 cannot say, its own schema version (settings-ext.ts). The v1 owner
   * never writes it, and builds before 1.15.0 do not know it: their v1 repair drops unknown fields only inside
   * `settings`, so a rollback keeps it for the return.
   */
  settingsExt: 'settings.ext',
} as const;

/** IndexedDB database of the logs (§9.2). */
export const LOG_DB_NAME = 'cg-logs';
