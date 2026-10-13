// The owner's hub configuration as the fake hub models it (hub-pr-plan.md PR 7–8,
// §4.12): the master switch, the `*` and per-page feature flags, the served
// capabilities, limits, minVersion, explicit host bindings, plus the fake
// hub's own knobs. Bootstrap is computed from it the way the hub does
// (apps/runtime/src/services/client-features.ts): a page's feature by
// `evaluateClientFeature` — platform → master → flag (the page's own row
// wins over `*`) → binding → capability — and the top-level `flags` by
// `clientBootstrapFlags`, from the `*` row ALONE. Presets reproduce the
// scenarios' BOOTSTRAP_PILOT_PAGES, BOOTSTRAP_PILOT_ON and BOOTSTRAP_ALL_OFF
// exactly (config.test.ts).
//
// What each flag needs of the hub is the HUB's table (`CLIENT_FEATURE_REQUIREMENTS`
// there), repeated in the scenarios (`HUB_FEATURE_CAPABILITIES`) as it stands at
// 6ee3d627 — the commit production runs and the SDK is vendored from. The
// client does not carry that table (R20 F4: it reads the page's feature, and
// only its own transport needs on top — `CLIENT_FLAG_REQUIREMENTS`).

import {
  CLIENT_FEATURE_FLAG_NAMES,
  CLIENT_HUB_CAPABILITY_NAMES,
  hasCapability,
  narrowToken,
  type Bootstrap,
  type BootstrapLimits,
  type ClientFeatureFlag,
  type FeatureAvailability,
  type HubPageRef,
} from '@cg/contracts';

import { BINDING_KEY_ONE, BINDING_KEY_VIP, HUB_FEATURE_CAPABILITIES, PILOT_FLAGS_OFF, SCENARIO_DATA, WORLD } from '../scenarios/hub';
import { iso } from './clock';
import { type BootstrapPresetName, type FakeHubConfigPatch } from './types';

/** The preset of a fake hub nobody configured: the pilot as the owner runs it (a row per page, an empty `*`). */
export const DEFAULT_PRESET: BootstrapPresetName = 'pilot-pages';

export interface FakePage {
  readonly pageId: number;
  readonly pageLabel: string;
  readonly title: string;
  readonly platform: 'onlyfans' | 'fansly';
  readonly platformAccountId: string | null;
  readonly bindingRevision: number;
  readonly modelSlug: string;
  readonly modelName: string;
}

/** The synthetic pages (scenarios/hub/world.ts): two OF pilot pages and one Fansly page. */
export const FAKE_PAGES: readonly FakePage[] = [
  { ...WORLD.pages.one, platform: 'onlyfans', modelSlug: 'model-one', modelName: 'Model One' },
  { ...WORLD.pages.vip, platform: 'onlyfans', modelSlug: 'model-one', modelName: 'Model One' },
  { ...WORLD.pages.fansly, platform: 'fansly', modelSlug: 'model-two', modelName: 'Model Two' },
];

export const pageRefOf = (page: FakePage): HubPageRef => ({ id: page.pageId, label: page.pageLabel, platform: page.platform, modelSlug: page.modelSlug, modelName: page.modelName });

export interface FakeHubConfig {
  readonly master: boolean;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly pageFlags: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  readonly capabilities: readonly string[];
  readonly minVersion: string;
  readonly bindingsByHost: Readonly<Record<string, number>>;
  readonly limits: BootstrapLimits;
  /** Grows on every owner change (= custody `flagRevision`). */
  readonly configRevision: number;
  readonly narrowTokens: boolean;
  /** H-2: `client/bootstrap` is deployed. */
  readonly clientBootstrap: boolean;
  readonly quotaRequestsToday: number | null;
  readonly generationVisibleAfterMs: number;
  readonly spendersTotal: number;
  readonly aiChunkDelayMs: number;
  /** The model's drafts name the fan they were written for (`@<fanRef>` after every part). */
  readonly aiNameFan: boolean;
  /** The model's whole answer per hub feature, in place of the synthetic one. */
  readonly aiTexts: Readonly<Record<string, string>>;
}

const allFlags = (on: (flag: ClientFeatureFlag) => boolean): Record<string, boolean> => Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, on(flag)]));

/** Pilot capabilities: every one but client-health (B′ ingest still off). */
export const PILOT_CAPABILITIES: readonly string[] = CLIENT_HUB_CAPABILITY_NAMES.filter((capability) => capability !== 'client-health-perf-v1');

const BASE = {
  pageFlags: {},
  narrowTokens: true,
  clientBootstrap: true,
  quotaRequestsToday: 120,
  generationVisibleAfterMs: 0,
  spendersTotal: 1240,
  aiChunkDelayMs: 0,
  aiNameFan: false,
  aiTexts: {},
} as const;

export function presetConfig(name: BootstrapPresetName): FakeHubConfig {
  switch (name) {
    case 'pilot-pages': {
      // What the owner really does: nothing in `*`, a row per pilot page that names only what is ON there.
      // A flag the row does not name falls back to `*` — so a test still switches X8 on for everyone with
      // `flags`, and switches a pilot flag off with `pageFlags`.
      const row = Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.filter((flag) => !PILOT_FLAGS_OFF.includes(flag)).map((flag) => [flag, true]));
      return { ...presetConfig('pilot-on'), flags: allFlags(() => false), pageFlags: { [WORLD.pages.one.pageLabel]: row, [WORLD.pages.vip.pageLabel]: row } };
    }
    case 'pilot-on':
      return {
        ...BASE,
        master: true,
        flags: allFlags((flag) => !PILOT_FLAGS_OFF.includes(flag)),
        capabilities: PILOT_CAPABILITIES,
        minVersion: '0.1.0',
        bindingsByHost: { [BINDING_KEY_ONE]: WORLD.pages.one.pageId, [BINDING_KEY_VIP]: WORLD.pages.vip.pageId },
        limits: { ...SCENARIO_DATA.limits, previewSendReceiptProfiles: [] },
        configRevision: WORLD.configRevision,
      };
    case 'all-off':
      return {
        ...BASE,
        master: false,
        flags: allFlags(() => false),
        capabilities: [],
        minVersion: '0.0.0',
        bindingsByHost: {},
        limits: { ...SCENARIO_DATA.limits, deepMax: 1500, previewSendReceiptProfiles: [] },
        configRevision: 0,
      };
    case 'master-off':
      return { ...presetConfig('pilot-on'), master: false };
  }
}

/**
 * An owner change of the pilot pages' own rows (`chatExtensionFeatures["<pageLabel>"]`): the way a flag is
 * switched where the pilot runs page by page — a page's own value wins over `"*"`, so a `flags` patch (the
 * `"*"` row) changes nothing on a page that names the flag itself.
 */
export function pilotPageFlags(flags: Readonly<Partial<Record<ClientFeatureFlag, boolean>>>): Pick<FakeHubConfigPatch, 'pageFlags'> {
  return { pageFlags: { [WORLD.pages.one.pageLabel]: flags, [WORLD.pages.vip.pageLabel]: flags } };
}

/** Applies an owner change; any change of what bootstrap shows bumps configRevision. */
export function patchConfig(config: FakeHubConfig, patch: FakeHubConfigPatch): FakeHubConfig {
  const next: FakeHubConfig = {
    ...config,
    ...(patch.master === undefined ? {} : { master: patch.master }),
    ...(patch.flags === undefined ? {} : { flags: { ...config.flags, ...(patch.flags as Record<string, boolean>) } }),
    ...(patch.pageFlags === undefined
      ? {}
      : {
          pageFlags: {
            ...config.pageFlags,
            ...Object.fromEntries(Object.entries(patch.pageFlags).map(([page, flags]) => [page, { ...config.pageFlags[page], ...(flags as Record<string, boolean>) }])),
          },
        }),
    ...(patch.capabilities === undefined ? {} : { capabilities: [...patch.capabilities] }),
    ...(patch.minVersion === undefined ? {} : { minVersion: patch.minVersion }),
    ...(patch.bindingsByHost === undefined ? {} : { bindingsByHost: { ...patch.bindingsByHost } }),
    ...(patch.limits === undefined ? {} : { limits: { ...config.limits, ...(patch.limits as Partial<BootstrapLimits>) } }),
    ...(patch.narrowTokens === undefined ? {} : { narrowTokens: patch.narrowTokens }),
    ...(patch.clientBootstrap === undefined ? {} : { clientBootstrap: patch.clientBootstrap }),
    ...(patch.quotaRequestsToday === undefined ? {} : { quotaRequestsToday: patch.quotaRequestsToday }),
    ...(patch.generationVisibleAfterMs === undefined ? {} : { generationVisibleAfterMs: patch.generationVisibleAfterMs }),
    ...(patch.spendersTotal === undefined ? {} : { spendersTotal: patch.spendersTotal }),
    ...(patch.aiChunkDelayMs === undefined ? {} : { aiChunkDelayMs: patch.aiChunkDelayMs }),
    ...(patch.aiNameFan === undefined ? {} : { aiNameFan: patch.aiNameFan }),
    ...(patch.aiTexts === undefined ? {} : { aiTexts: { ...patch.aiTexts } }),
  };
  const owner = ['master', 'flags', 'pageFlags', 'capabilities', 'minVersion', 'bindingsByHost', 'limits'].some((key) => key in patch);
  return owner ? { ...next, configRevision: config.configRevision + 1 } : next;
}

/** The flag on this page: the page's own entry wins over `*`; master off → off. */
export function flagOn(config: FakeHubConfig, pageLabel: string, flag: string): boolean {
  if (!config.master) return false;
  return config.pageFlags[pageLabel]?.[flag] ?? config.flags[flag] === true;
}

/** The extension can bind a host account to the page: by its platform account id, or by an explicit owner binding. */
function bindable(config: FakeHubConfig, page: FakePage): boolean {
  return page.platformAccountId !== null || Object.values(config.bindingsByHost).includes(page.pageId);
}

/** `evaluateClientFeature`: whether a page's feature is available and why not, in the hub's order. */
export function featureVerdict(config: FakeHubConfig, page: FakePage, flag: string): FeatureAvailability {
  if (page.platform !== 'onlyfans') return { available: false, reason: 'platform_unsupported' };
  if (!config.master) return { available: false, reason: 'disabled' };
  if (!flagOn(config, page.pageLabel, flag)) return { available: false, reason: 'flag_off' };
  if (!bindable(config, page)) return { available: false, reason: 'binding_missing' };
  const known = narrowToken(CLIENT_FEATURE_FLAG_NAMES, flag);
  if (known !== null && !HUB_FEATURE_CAPABILITIES[known].every((capability) => hasCapability(config.capabilities, capability))) {
    return { available: false, reason: 'hub_not_ready' };
  }
  return { available: true };
}

export interface BootstrapIdentity {
  readonly userId: number;
  readonly username: string;
  readonly role: string;
  readonly tokenClient: string | null;
}

/** Bootstrap for one caller at `now` (H-2a form). */
export function bootstrapOf(config: FakeHubConfig, pages: readonly FakePage[], identity: BootstrapIdentity, now: number): Bootstrap {
  const flagNames = [...new Set([...CLIENT_FEATURE_FLAG_NAMES, ...Object.keys(config.flags)])];
  return {
    protocol: 1,
    issuedAt: iso(now),
    ttlSec: 300,
    configRevision: config.configRevision,
    minVersion: config.minVersion,
    identity: { userId: identity.userId, username: identity.username, role: identity.role, tokenClient: identity.tokenClient },
    pages: pages.map((page) => ({
      pageId: page.pageId,
      pageLabel: page.pageLabel,
      title: page.title,
      platform: page.platform,
      platformAccountId: page.platformAccountId,
      bindingRevision: page.bindingRevision,
      features: Object.fromEntries(flagNames.map((flag) => [flag, featureVerdict(config, page, flag)])),
    })),
    bindingsByHost: Object.fromEntries(Object.entries(config.bindingsByHost).filter(([, pageId]) => pages.some((page) => page.pageId === pageId))),
    // `clientBootstrapFlags`: the `*` row alone — a page's own row never shows here.
    flags: Object.fromEntries(flagNames.map((flag) => [flag, config.master && config.flags[flag] === true])),
    limits: config.limits,
    capabilities: [...config.capabilities],
  };
}
