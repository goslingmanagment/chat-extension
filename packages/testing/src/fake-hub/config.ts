// The owner's hub configuration as the fake hub models it (hub-pr-plan.md PR 7–8,
// §4.12): the master switch, the `*` and per-page feature flags, the served
// capabilities, limits, minVersion, explicit host bindings, plus the fake
// hub's own knobs. Bootstrap is computed from it the way the hub's
// `evaluateClientFeature` does: platform → binding → master → flag →
// capability. Presets reproduce the scenarios' BOOTSTRAP_PILOT_ON and
// BOOTSTRAP_ALL_OFF exactly (config.test.ts).

import {
  CLIENT_FEATURE_FLAG_NAMES,
  CLIENT_FLAG_REQUIREMENTS,
  CLIENT_HUB_CAPABILITY_NAMES,
  hasCapability,
  narrowToken,
  type Bootstrap,
  type BootstrapLimits,
  type ClientFeatureFlag,
  type FeatureAvailability,
  type HubPageRef,
} from '@cg/contracts';

import { BINDING_KEY_ONE, BINDING_KEY_VIP, PILOT_FLAGS_OFF, SCENARIO_DATA, WORLD } from '../scenarios/hub';
import { iso } from './clock';
import { type BootstrapPresetName, type FakeHubConfigPatch } from './types';

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
} as const;

export function presetConfig(name: BootstrapPresetName): FakeHubConfig {
  switch (name) {
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
  };
  const owner = ['master', 'flags', 'pageFlags', 'capabilities', 'minVersion', 'bindingsByHost', 'limits'].some((key) => key in patch);
  return owner ? { ...next, configRevision: config.configRevision + 1 } : next;
}

/** The flag on this page: the page's own entry wins over `*`; master off → off. */
export function flagOn(config: FakeHubConfig, pageLabel: string, flag: string): boolean {
  if (!config.master) return false;
  return config.pageFlags[pageLabel]?.[flag] ?? config.flags[flag] === true;
}

/** `evaluateClientFeature`: whether a page's feature is available and why not. */
export function featureVerdict(config: FakeHubConfig, page: FakePage, flag: string): FeatureAvailability {
  if (page.platform !== 'onlyfans') return { available: false, reason: 'platform_unsupported' };
  if (page.platformAccountId === null) return { available: false, reason: 'binding_missing' };
  if (!config.master) return { available: false, reason: 'disabled' };
  if (!flagOn(config, page.pageLabel, flag)) return { available: false, reason: 'flag_off' };
  const known = narrowToken(CLIENT_FEATURE_FLAG_NAMES, flag);
  if (known !== null && !CLIENT_FLAG_REQUIREMENTS[known].capabilities.every((capability) => hasCapability(config.capabilities, capability))) {
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
    flags: Object.fromEntries(flagNames.map((flag) => [flag, config.master && config.flags[flag] === true])),
    limits: config.limits,
    capabilities: [...config.capabilities],
  };
}
