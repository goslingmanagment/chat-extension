// Negative checks of the client's own state (R02; docs/parity,
// PARITY_EXCEPTIONS): no local archive of conversations, no legacy of the old
// clients, no two-step sign-in. Two layers run now — the frozen contracts the
// client is built on (storage keys and limits, settings v1, the tab protocol,
// UI actions and texts) and a scan of every shipped source. The runtime layer
// — what the platform storage really writes (R07) and what the sign-in facade
// really sends (R08) — is the integrator's, once those packages exist.

import {
  CATALOG_ACTION_IDS,
  DEFAULT_SETTINGS,
  DeviceTokenIssueRequestSchema,
  DraftSnapshotSchema,
  FEATURE_IDS,
  HUB_AI_FEATURES,
  LOG_DB_NAME,
  OP_LIMITS,
  PersonaAssignmentSchema,
  PREFERENCE_KEYS,
  SETTINGS_SCHEMA_VERSION,
  SettingsSchema,
  SPENDERS_BOARD,
  SpendersQuerySchema,
  STORAGE_KEYS,
  STORAGE_LIMITS,
  TAB_REQUEST_TYPES,
  TAB_REQUESTS,
  UI_ACTION_TYPES,
  UI_TEXT_KEYS,
  UiActionSchema,
} from '@cg/contracts';
import { PARITY_EXCEPTIONS } from '@cg/contracts/parity/exceptions';
import { HOTKEYS } from '@chatgoose/hotkeys';
import { describe, expect, it } from 'vitest';

import { WORLD } from '../scenarios/hub';
import { createFakeHub } from '../fake-hub/hub';
import { hubCall } from '../fake-hub/kit';
import { findInClientSources } from './sources';

const settingPaths = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.entries(value).flatMap(([key, inner]) => [`${prefix}${key}`, ...settingPaths(inner, `${prefix}${key}.`)]) : [];
const SETTING_PATHS = settingPaths(DEFAULT_SETTINGS);
const rowsOf = (id: string): readonly string[] => PARITY_EXCEPTIONS.find((exception) => exception.id === id)?.rows ?? [];
/** The registries name what is forbidden; the hub's auth wire carries the desktop's reservation shape. */
const REGISTRIES = ['packages/contracts/src/parity/exceptions.ts', 'packages/contracts/src/hub/auth.ts'];
const STORAGE_VALUES: readonly string[] = Object.values(STORAGE_KEYS);
/**
 * architecture.md §6.1: the isolated side reads ChatSpace's own composer draft
 * (`localStorage['chat-space:draft:of:…']`, same origin, read-only through the
 * `DraftStorage` port). That is the host's storage, not ours: the host adapter
 * and the ChatSpace entry point, where its adapter is assembled — the one
 * place that hands the page's storage to that port (`getItem` only) — may name
 * it, nothing may write it.
 */
const HOST_DRAFT_READERS = /^(?:packages\/host-chatspace\/src\/isolated\/|apps\/extension\/src\/entrypoints\/chatspace\.content\.ts:)/;
const tabRequest = (type: string) => (TAB_REQUESTS as unknown as Record<string, { readonly req: { safeParse(value: unknown): { success: boolean } } }>)[type];

describe('[HB-010] [RB-027] NEG-NO-LOCAL-ARCHIVE', () => {
  it('lists exactly these rows', () => {
    expect(rowsOf('NEG-NO-LOCAL-ARCHIVE')).toEqual(['HB-010', 'RB-027']);
  });

  it('the extension stores only the STORAGE_KEYS and the log database; none of them holds conversations', () => {
    expect(STORAGE_VALUES).toEqual(['settings', 'auth.token', 'auth.meta', 'cache.bootstrap', 'cache.catalog', 'presence', 'telemetry.queue', 'send.journal', 'newcomers.drafts']);
    expect(STORAGE_VALUES.filter((key) => /message|chat|conversation|archive|transcript|history|thread|offline|feed/i.test(key))).toEqual([]);
    expect(LOG_DB_NAME).toBe('cg-logs');
  });

  it('what may hold text is a small, capped, expiring working set (§9.4), never an archive to work offline from', () => {
    for (const cap of ['resultsTotalBytes', 'coachTotalBytes', 'previewFeedsTotalBytes', 'previewDraftsTotalBytes'] as const) {
      expect(STORAGE_LIMITS[cap], cap).toBeGreaterThan(0);
      expect(STORAGE_LIMITS[cap], cap).toBeLessThanOrEqual(4 * 1024 * 1024);
    }
    // At most ten previews of a hundred messages each — a preview's working set, not a local copy of the archive.
    expect(STORAGE_LIMITS.previewFeeds * STORAGE_LIMITS.previewFeedMessages).toBeLessThanOrEqual(1000);
    expect(OP_LIMITS.resultTtlMs).toBeLessThanOrEqual(60 * 60_000);
    expect(STORAGE_LIMITS.previewDraftTtlMs).toBeLessThanOrEqual(24 * 60 * 60_000);
    // (`generation.coach.historyLimit` is how many Coach exchanges go to the hub, not a store.)
    expect([...SETTING_PATHS, ...PREFERENCE_KEYS].filter((key) => /offline|cache|archive/i.test(key))).toEqual([]);
  });

  it('no shipped source uses web storage or the Cache API, opens another IndexedDB database, or keeps an offline archive', () => {
    expect(findInClientSources(/\b(?:sessionStorage|openDatabase)\b|\bcaches\.open\b/, REGISTRIES)).toEqual([]);
    expect(findInClientSources(/\blocalStorage\b/, REGISTRIES).filter((hit) => !HOST_DRAFT_READERS.test(hit))).toEqual([]);
    expect(findInClientSources(/\blocalStorage\s*(?:\.\s*(?:setItem|removeItem|clear)\b|\[[^\]]*\]\s*=(?!=))/, REGISTRIES)).toEqual([]);
    expect(findInClientSources(/\bindexedDB\.open\((?!\s*(?:LOG_DB_NAME\b|['"`]cg-logs['"`]))/, REGISTRIES)).toEqual([]);
    expect(findInClientSources(/\b(?:messageArchive|chatArchive|localArchive|offlineCache|offlineMode|messagesCache|cachedMessages|conversationCache|transcriptCache)\b/i, REGISTRIES)).toEqual([]);
  });
});

describe('[AI-103] [SP-005] [HK-035] [ST-066] [ST-138] [AU-020] [DB-021] [CS-026] NEG-LEGACY', () => {
  it('lists exactly these rows', () => {
    expect(rowsOf('NEG-LEGACY')).toEqual(['AI-103', 'SP-005', 'HK-035', 'ST-066', 'ST-138', 'AU-020', 'DB-021', 'CS-026']);
  });

  it('[ST-138] [AU-020] storage starts at settings v1 and reads nothing of the old clients: old versions, removed settings and legacy keys are refused', () => {
    expect(SETTINGS_SCHEMA_VERSION).toBe(1);
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(1);
    expect(SettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    // The Fansly extension's v9, v11, v17 and the like are not a starting point.
    for (const version of [0, 9, 11, 17]) expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, schemaVersion: version }).success, `v${version}`).toBe(false);
    for (const legacy of ['rail', 'ofapiKey', 'anthropicKey', 'legacy', 'quarantine', 'microQuota']) {
      expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, [legacy]: {} }).success, legacy).toBe(false);
    }
    expect([...SETTING_PATHS, ...PREFERENCE_KEYS, ...STORAGE_VALUES].filter((key) => /rail|microQuota|ofapi|anthropic|legacy|quarantin|migrat/i.test(key))).toEqual([]);
  });

  it('[AI-103] no old help-me feature anywhere (Help itself is NEG-HELP)', () => {
    expect([...FEATURE_IDS, ...HUB_AI_FEATURES, ...CATALOG_ACTION_IDS, ...UI_ACTION_TYPES, ...UI_TEXT_KEYS].filter((name) => /help-?me/i.test(name))).toEqual([]);
  });

  it('[SP-005] the board reads pages of 200 up to 1000 rows; there is no «retry with 500» of the old Core', () => {
    expect(SPENDERS_BOARD).toMatchObject({ pageSize: 200, maxPages: 5, maxRows: 1000 });
    const query = { scope: 'page', pageLabel: WORLD.pages.one.pageLabel, period: '30d', offset: 0 };
    expect(SpendersQuerySchema.safeParse({ ...query, limit: SPENDERS_BOARD.pageSize }).success).toBe(true);
    for (const limit of [500, 1000]) expect(SpendersQuerySchema.safeParse({ ...query, limit }).success, String(limit)).toBe(false);
  });

  it('[HK-035] the cheatsheet has its own groups, none comparing with the OnlyFans app or the old clients', () => {
    // `navigation` (J/K, ⌘U, ⌘1–9, `]`) came with contracts 1.2.0: this client's own keys, not a comparison with another one.
    expect(UI_TEXT_KEYS.filter((key) => key.startsWith('cheatsheet.group.'))).toEqual([
      'cheatsheet.group.ai',
      'cheatsheet.group.windows',
      'cheatsheet.group.before',
      'cheatsheet.group.result',
      'cheatsheet.group.navigation',
    ]);
    expect(UI_TEXT_KEYS.filter((key) => /differ|ofApp|of-app|desktop|fansly|legacy/i.test(key))).toEqual([]);
    expect(HOTKEYS.filter((hotkey) => JSON.stringify(hotkey).match(/differ|of-?app/i) !== null)).toEqual([]);
  });

  it('[ST-066] personas in settings are references, never bodies; nothing exports, imports or restores them', () => {
    expect(Object.keys(PersonaAssignmentSchema.shape)).toEqual(['key', 'definitionId']);
    expect([...UI_ACTION_TYPES, ...TAB_REQUEST_TYPES].filter((name) => /persona/i.test(name))).toEqual(['ChoosePersona', 'persona.set']);
    expect([...UI_ACTION_TYPES, ...TAB_REQUEST_TYPES, ...UI_TEXT_KEYS].filter((name) => /persona.*(?:export|import|restore|backup)|(?:export|import|restore|backup).*persona/i.test(name))).toEqual([]);
  });

  it('[DB-021] [CS-026] no transcript card in debug; the draft carries no old rich options (hidden text, GIF, tags)', () => {
    expect(UI_TEXT_KEYS.filter((key) => /transcript/i.test(key))).toEqual([]);
    expect(Object.keys(DraftSnapshotSchema.shape)).toEqual(['identity', 'revision', 'plainText', 'provenance', 'digest']);
    expect([...UI_ACTION_TYPES, ...UI_TEXT_KEYS].filter((name) => /rich|gif|hiddenText|hidden-text|composer\.tag/i.test(name))).toEqual([]);
  });

  it('no shipped source brings the legacy back: help-me, the 500 fallback, the OF-app group, persona export, removed settings, legacy keys and quarantine, the transcript card, rich options, migrations from old clients', () => {
    expect(findInClientSources(/\bhelp-?me\b|\bhelpMe\b/i, REGISTRIES)).toEqual([]);
    expect(findInClientSources(/\b(?:limit|pageSize|rows)\s*[:=]\s*500\b|\bretryWith500\b/, REGISTRIES)).toEqual([]);
    expect(findInClientSources(/\b(?:differsFromOf|ofAppDiff\w*|differs-from-of)\b/i, REGISTRIES)).toEqual([]);
    expect(findInClientSources(/\b(?:exportPersonas|importPersonas|personasExport|personasImport|restorePersonas)\b/i, REGISTRIES)).toEqual([]);
    expect(findInClientSources(/\bmicroQuota\b|\brail\.micro/, REGISTRIES)).toEqual([]);
    expect(findInClientSources(/\b(?:ofapiKey|anthropicKey|legacyKey\w*|quarantin\w*)\b/i, REGISTRIES)).toEqual([]);
    expect(findInClientSources(/\b(?:TranscriptCard|transcriptCard|transcript-card)\b/, REGISTRIES)).toEqual([]);
    expect(findInClientSources(/\b(?:richOptions|hiddenText|gifPicker|composerTags)\b/, REGISTRIES)).toEqual([]);
    expect(findInClientSources(/\bmigrate(?:From)?(?:V(?:9|11|17)|Legacy|Fansly|Desktop)\b|\bfansly-chat\b|\bchatgoose-desktop\b/i, REGISTRIES)).toEqual([]);
  });
});

describe('[AU-003] [ST-059] NEG-SIGNIN-MODEL', () => {
  it('lists exactly these rows', () => {
    expect(rowsOf('NEG-SIGNIN-MODEL')).toEqual(['AU-003', 'ST-059']);
  });

  it('[AU-003] sign-in is one step: login and password in, an active narrow token out; no reservation, no credential journal', () => {
    const signIn = tabRequest('session.signIn');
    expect(signIn?.req.safeParse({ login: 'chatter1', password: 'p' }).success).toBe(true);
    for (const extra of [{ mode: 'pending' }, { reservationId: 1 }, { resume: true }]) expect(signIn?.req.safeParse({ login: 'chatter1', password: 'p', ...extra }).success, Object.keys(extra)[0]).toBe(false);
    // The extension always asks for `client: 'chat-extension'`, which the contract allows only with mode active.
    const body = { username: 'chatter1', password: 'p', label: 'Firefox · test · ChatSpace', client: 'chat-extension' };
    expect(DeviceTokenIssueRequestSchema.safeParse({ ...body, mode: 'active' }).success).toBe(true);
    expect(DeviceTokenIssueRequestSchema.safeParse({ ...body, mode: 'pending' }).success).toBe(false);
    expect(STORAGE_VALUES.filter((key) => key.startsWith('auth.'))).toEqual(['auth.token', 'auth.meta']);
    expect([...TAB_REQUEST_TYPES, ...UI_ACTION_TYPES, ...STORAGE_VALUES].filter((name) => /reserv|credential|activate|resume|journal.*(?:sign|auth)|(?:sign|auth).*journal/i.test(name))).toEqual([]);
  });

  it('[AU-003] a pending reservation is never a working sign-in at the hub', async () => {
    const hub = createFakeHub();
    const issued = await hubCall(hub.fetch, hub.origin, 'authIssueDeviceTokenWithPassword', { username: WORLD.user.username, password: 'synthetic-password', label: 'desktop', mode: 'pending' });
    const reservation = (await issued.json()) as { mode: string; token: string };
    expect(reservation.mode).toBe('pending');
    expect((await hubCall(hub.fetch, hub.origin, 'me', null, { token: reservation.token })).status).toBe(401);
  });

  it('[ST-059] sign-out always clears the sign-in locally; there is no separate «forget locally»', () => {
    const signOut = tabRequest('session.signOut');
    expect(signOut?.req.safeParse({}).success).toBe(true);
    for (const extra of [{ local: true }, { localOnly: true }, { forget: true }]) expect(signOut?.req.safeParse(extra).success, Object.keys(extra)[0]).toBe(false);
    expect(UiActionSchema.safeParse({ type: 'SignOut' }).success).toBe(true);
    expect(UiActionSchema.safeParse({ type: 'SignOut', localOnly: true }).success).toBe(false);
    expect([...TAB_REQUEST_TYPES, ...UI_ACTION_TYPES, ...UI_TEXT_KEYS].filter((name) => /forget/i.test(name))).toEqual([]);
  });

  it('no shipped source keeps a credential journal, asks for a pending token or forgets the sign-in apart from sign-out', () => {
    expect(findInClientSources(/\b(?:credentialJournal|signInJournal|reservationId|reservationExpiresAt)\b|\bmode:\s*['"]pending['"]/, REGISTRIES)).toEqual([]);
    expect(findInClientSources(/\bforget(?:Local\w*|SignIn|Session)\b|\bForgetLocal\w*|forget-local/i, REGISTRIES)).toEqual([]);
  });
});
