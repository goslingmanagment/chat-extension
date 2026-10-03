// Pure readings of a bootstrap (architecture.md §8.3, hub-pr-plan §4.12):
// whether a flag is usable on a page, the binding of a host account to a
// page (by platformAccountId only, AU-023), the minVersion gate, and the
// DEV-ONLY bootstrap synthesized for a hub without `client/bootstrap`.

import {
  BOOTSTRAP_PROTOCOL,
  BootstrapSchema,
  CLIENT_FEATURE_FLAG_NAMES,
  CLIENT_FLAG_REQUIREMENTS,
  NATIVE_ID_PATTERN,
  hasCapability,
  hostBindingKey,
  isFlagOn,
  narrowPlatform,
  type Bootstrap,
  type BootstrapLimits,
  type BootstrapPage,
  type ClientFeatureFlag,
  type HostAccount,
  type HubAuthState,
  type HubBinding,
  type SessionIdentity,
} from '@cg/contracts';

export interface FlagState {
  readonly usable: boolean;
  /** Why not: `flag_off`, `not_granted`, a page feature's reason (open token), or `hub_not_ready` for a capability the hub has not declared. */
  readonly reason: string | null;
}

/** §4.12: a flag is usable when it is on, the page's feature is available, and every capability it needs is declared. */
export function flagState(bootstrap: Bootstrap, flag: ClientFeatureFlag, pageLabel: string | null): FlagState {
  if (!isFlagOn(bootstrap.flags, flag)) return { usable: false, reason: 'flag_off' };
  if (pageLabel !== null) {
    const page = bootstrap.pages.find((candidate) => candidate.pageLabel === pageLabel);
    if (page === undefined) return { usable: false, reason: 'not_granted' };
    const feature = Object.prototype.hasOwnProperty.call(page.features, flag) ? page.features[flag] : undefined;
    if (feature?.available !== true) return { usable: false, reason: feature?.reason ?? 'disabled' };
  }
  const missing = CLIENT_FLAG_REQUIREMENTS[flag].capabilities.filter((capability) => !hasCapability(bootstrap.capabilities, capability));
  return missing.length > 0 ? { usable: false, reason: 'hub_not_ready' } : { usable: true, reason: null };
}

export function pageOf(bootstrap: Bootstrap, pageLabel: string): BootstrapPage | null {
  return bootstrap.pages.find((page) => page.pageLabel === pageLabel) ?? null;
}

// ── versions ───────────────────────────────────────────────────────────────

function versionParts(version: string): number[] | null {
  if (!/^\d+(?:\.\d+){0,3}$/.test(version.trim())) return null;
  return version
    .trim()
    .split('.')
    .map((part) => Number(part));
}

/** -1 / 0 / 1 for dotted numeric versions (Firefox allows up to four parts); null when either is not one. */
export function compareVersions(a: string, b: string): number | null {
  const left = versionParts(a);
  const right = versionParts(b);
  if (left === null || right === null) return null;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/** Below `minVersion` AI is off and the client shows CG-HUB-OUTDATED (§8.3). An unreadable minVersion does not lock anyone out. */
export function belowMinVersion(bootstrap: Bootstrap, extensionVersion: string): boolean {
  return compareVersions(extensionVersion, bootstrap.minVersion) === -1;
}

export function protocolSupported(bootstrap: Bootstrap): boolean {
  return bootstrap.protocol === BOOTSTRAP_PROTOCOL;
}

// ── binding (AU-022…AU-025) ────────────────────────────────────────────────

export type BindingResolution =
  | { readonly state: 'bound'; readonly binding: HubBinding }
  /** The host has not loaded the account's platformAccountId yet: «страницы грузятся» (AU-025). */
  | { readonly state: 'loading' }
  | { readonly state: 'refused'; readonly check: 'bindingMissing' | 'bindingAmbiguous' };

const missing: BindingResolution = { state: 'refused', check: 'bindingMissing' };
const ambiguous: BindingResolution = { state: 'refused', check: 'bindingAmbiguous' };

/**
 * A host account → exactly one page (§8.3): the owner's explicit
 * `bindingsByHost` entry wins; otherwise the one page of the same platform
 * with the same `platformAccountId`. Never by a name (AU-023). No page —
 * CG-BINDING-MISSING; two, or a page whose account differs from what the
 * host knows (explicit entry included) — CG-BINDING-AMBIGUOUS. The binding's
 * `platformAccountId` is the PAGE's, so X8 can check it against the host.
 */
export function resolveBinding(bootstrap: Bootstrap, session: SessionIdentity, account: HostAccount): BindingResolution {
  const explicit = bootstrap.bindingsByHost[hostBindingKey(account.host, account.hostAccountId)];
  let page: BootstrapPage;
  if (explicit !== undefined) {
    const found = bootstrap.pages.find((candidate) => candidate.pageId === explicit);
    if (found === undefined) return missing;
    if (narrowPlatform(found.platform) !== account.platform) return ambiguous;
    page = found;
  } else {
    if (account.platformAccountId === null) return { state: 'loading' };
    const candidates = bootstrap.pages.filter(
      (candidate) => narrowPlatform(candidate.platform) === account.platform && candidate.platformAccountId === account.platformAccountId,
    );
    if (candidates.length > 1) return ambiguous;
    const [only] = candidates;
    if (only === undefined) return missing;
    page = only;
  }
  const pageAccount = page.platformAccountId;
  if (pageAccount === null || !NATIVE_ID_PATTERN.test(pageAccount)) return missing;
  if (account.platformAccountId !== null && account.platformAccountId !== pageAccount) return ambiguous;
  return {
    state: 'bound',
    binding: {
      hubOrigin: session.hubOrigin,
      principalId: session.userId,
      loginEpoch: session.epoch,
      host: account.host,
      hostAccountId: account.hostAccountId,
      platform: account.platform,
      platformAccountId: pageAccount,
      pageId: page.pageId,
      pageLabel: page.pageLabel,
      bindingRevision: page.bindingRevision,
    },
  };
}

/** AU-024: a binding stays valid for a whole generation only while the sign-in, the page and its binding revision are the same. */
export function bindingStillHolds(binding: HubBinding, session: SessionIdentity | null, bootstrap: Bootstrap | null): boolean {
  if (session === null || bootstrap === null) return false;
  if (binding.hubOrigin !== session.hubOrigin || binding.principalId !== session.userId || binding.loginEpoch !== session.epoch) return false;
  const page = bootstrap.pages.find((candidate) => candidate.pageId === binding.pageId);
  return page !== undefined && page.pageLabel === binding.pageLabel && page.bindingRevision === binding.bindingRevision && page.platformAccountId === binding.platformAccountId;
}

// ── the DEV-ONLY bootstrap of a hub without `client/bootstrap` ─────────────

/** Limits the compat bootstrap assumes (hub-pr-plan §4.2 defaults; deepMax as the prod hub before H-6). No X8. */
export const COMPAT_LIMITS: BootstrapLimits = {
  freshTextMaxItems: 60,
  freshTextMaxChars: 5000,
  feedMax: 100,
  deepMax: 1500,
  audienceWindowHours: 720,
  claimLeaseSec: 120,
  claimRenewSec: 40,
  claimActivityWindowSec: 120,
  previewSendPerMinute: 0,
  navInsertTimeoutSec: 20,
  dispatchTicketSec: 10,
  previewSendReceiptProfiles: [],
};

/** A flag works without new hub routes: it needs no capability (and is not part of X8). */
export function compatFlagAvailable(flag: ClientFeatureFlag): boolean {
  if (flag === 'previewSend' || flag === 'previewSendMarkAiGenerated') return false;
  return CLIENT_FLAG_REQUIREMENTS[flag].capabilities.length === 0;
}

/** A page of `GET /pages` (the SDK's `assignedPageSchema`), the fields the compat bootstrap reads. */
export interface CompatPage {
  readonly id: number;
  readonly label: string;
  readonly platform: string;
  readonly modelName: string;
  readonly displayName: string | null;
}

/**
 * DEV-ONLY (debug mode or a test build, never a release by default): the
 * prod hub answers 404 for `client/bootstrap` until H-2 ships. This builds a
 * bootstrap from `me` + `pages`: every feature that needs a new route is
 * unavailable with `hub_not_ready`, no capability is declared, X8 is off.
 * The hub's pages carry no platformAccountId there; `pageAccounts`
 * (pageLabel → OF creator id, injected by the dev composition) is the only
 * way to bind one — never a name.
 */
export function synthesizeCompatBootstrap(input: {
  readonly me: HubAuthState;
  readonly pages: readonly CompatPage[];
  readonly issuedAt: string;
  readonly pageAccounts: Readonly<Record<string, string>>;
}): Bootstrap {
  const features = (platform: string): BootstrapPage['features'] =>
    Object.fromEntries(
      CLIENT_FEATURE_FLAG_NAMES.map((flag) => [
        flag,
        platform !== 'onlyfans' ? { available: false, reason: 'platform_unsupported' } : compatFlagAvailable(flag) ? { available: true } : { available: false, reason: 'hub_not_ready' },
      ]),
    );
  const bootstrap: Bootstrap = {
    protocol: BOOTSTRAP_PROTOCOL,
    issuedAt: input.issuedAt,
    ttlSec: 300,
    configRevision: 0,
    minVersion: '0.0.0',
    identity: { userId: input.me.user.id, username: input.me.user.username, role: input.me.user.role, tokenClient: null },
    pages: input.pages.map((page) => ({
      pageId: page.id,
      pageLabel: page.label,
      title: page.displayName ?? page.modelName,
      platform: page.platform,
      platformAccountId: Object.prototype.hasOwnProperty.call(input.pageAccounts, page.label) ? (input.pageAccounts[page.label] ?? null) : null,
      bindingRevision: 0,
      features: features(page.platform),
    })),
    bindingsByHost: {},
    flags: Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, compatFlagAvailable(flag)])),
    limits: COMPAT_LIMITS,
    capabilities: [],
  };
  return BootstrapSchema.parse(bootstrap);
}
