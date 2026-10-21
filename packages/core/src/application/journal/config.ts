// The configuration a tab works with, as one snapshot of the chatter's log (2026-10-21, «Скачать лог»): the
// version, the site and its build, the verdict over the site's contract, the sign-in, the account on screen, the hub
// page it is bound to and that page's switches, the owner's flags, the settings and the personas by name. The tab
// writes it when it starts and again whenever any of it changes (watch.ts): «why does Hi not work here» is often
// «because the page has it switched off», and the file has to say so.
//
// Machine values only, except the names of the configuration (`pageName`, `personaName`, `personaNames`): the
// owner's words, never a person's. The settings are flattened into `path=value` words; the account labels the
// chatter typed are only counted.

import { type Bootstrap, type BootstrapPage } from '@cg/contracts/hub';
import { type HostKind } from '@cg/contracts/ids';
import { type SettingsV1 } from '@cg/contracts/settings';

export interface ConfigInput {
  readonly version: string;
  readonly contractsVersion: string;
  readonly site: HostKind;
  /** The site's build as the host read it; null — not known. */
  readonly siteBuild: string | null;
  /** The contract in one word (ok / degraded / broken) and the anchors that are missing or degraded. */
  readonly contract: string;
  readonly missing: readonly string[];
  readonly degraded: readonly string[];
  /** undefined — the sign-in is still being read. */
  readonly signIn: { readonly userId: number; readonly role: string; readonly epoch: number; readonly hubOrigin: string } | null | undefined;
  /** The site's account on screen; null — none is known (the account is not detected yet). */
  readonly accountId: string | null;
  readonly accounts: number;
  /** The hub page the account is bound to; null — none (yet). */
  readonly page: { readonly pageId: number; readonly pageName: string | null; readonly bindingRevision: number | null } | null;
  /** Why there is no page: the binding's code. */
  readonly bindingCode: string | null;
  readonly bootstrap: Bootstrap | null;
  readonly settings: SettingsV1 | null;
  readonly persona: { readonly status: string; readonly key: string | null; readonly label: string | null } | null;
  readonly personaNames: readonly string[];
  readonly debug: boolean;
}

const WORD = /^[A-Za-z0-9._:/@+=,#?&%~-]{1,120}$/;

/** `path=value` for every leaf; a text that is not a machine word is its length, a list is its count. */
export function flattenMachine(value: unknown, path = '', out: string[] = []): string[] {
  if (out.length >= 90) return out;
  if (value === null || value === undefined) {
    if (path !== '') out.push(`${path}=null`);
    return out;
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    out.push(`${path}=${String(value)}`);
    return out;
  }
  if (typeof value === 'string') {
    out.push(WORD.test(value) ? `${path}=${value}` : `${path}=[text:${value.length}]`);
    return out;
  }
  if (Array.isArray(value)) {
    out.push(`${path}=[${value.length}]`);
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) flattenMachine(item, path === '' ? key : `${path}.${key}`, out);
  }
  return out;
}

/** The settings as words: the account labels and the muted accounts are counted, the rest is said as it is. */
export function settingsWords(settings: SettingsV1 | null): readonly string[] {
  if (settings === null) return [];
  const { accounts, sound, ...rest } = settings;
  return [
    ...flattenMachine(rest),
    ...flattenMachine({ messages: sound.messages, subscribers: sound.subscribers, volume: sound.volume }, 'sound'),
    `sound.mutedAccounts=[${sound.mutedAccounts.length}]`,
    `accounts.labels=[${Object.keys(accounts.labels).length}]`,
  ];
}

/** A page's switches: `features` — on, `disabled` — off with the hub's reason. */
function pageSwitches(page: BootstrapPage | undefined): { readonly features: readonly string[]; readonly disabled: readonly string[] } {
  if (page === undefined) return { features: [], disabled: [] };
  const features: string[] = [];
  const disabled: string[] = [];
  for (const [flag, state] of Object.entries(page.features)) {
    if (state.available) features.push(flag);
    else disabled.push(state.reason === undefined ? flag : `${flag}:${state.reason}`);
  }
  return { features: features.sort(), disabled: disabled.sort() };
}

/** The snapshot's fields (machine values and the configuration's names). */
export function configFacts(input: ConfigInput): Record<string, unknown> {
  const bootstrap = input.bootstrap;
  const page = input.page === null ? undefined : bootstrap?.pages.find((item) => item.pageId === input.page?.pageId);
  const switches = pageSwitches(page);
  return {
    version: input.version,
    contractsVersion: input.contractsVersion,
    site: input.site,
    siteBuild: input.siteBuild,
    contract: input.contract,
    missing: [...input.missing],
    degraded: [...input.degraded],
    signedIn: input.signIn === undefined ? null : input.signIn !== null,
    ...(input.signIn === undefined || input.signIn === null ? {} : { userId: input.signIn.userId, role: input.signIn.role, signInEpoch: input.signIn.epoch, hubOrigin: input.signIn.hubOrigin }),
    accountId: input.accountId,
    accountCount: input.accounts,
    pageId: input.page?.pageId ?? null,
    pageName: input.page?.pageName ?? page?.title ?? null,
    ...(input.page?.bindingRevision === null || input.page?.bindingRevision === undefined ? {} : { bindingRevision: input.page.bindingRevision }),
    ...(input.bindingCode === null ? {} : { bindingCode: input.bindingCode }),
    configRevision: bootstrap?.configRevision ?? null,
    minVersion: bootstrap?.minVersion ?? null,
    flags: bootstrap === null ? [] : Object.entries(bootstrap.flags).map(([flag, on]) => `${flag}:${on ? 'on' : 'off'}`).sort(),
    features: switches.features,
    disabled: switches.disabled,
    capabilities: bootstrap === null ? [] : [...bootstrap.capabilities].sort(),
    personaStatus: input.persona?.status ?? null,
    personaKey: input.persona?.key ?? null,
    personaName: input.persona?.label ?? null,
    personaNames: input.personaNames.slice(0, 40),
    settings: settingsWords(input.settings),
    debug: input.debug,
  };
}

/** The top-level fields that differ between two snapshots (the TXT says what changed). */
export function changedFields(before: Readonly<Record<string, unknown>> | null, after: Readonly<Record<string, unknown>>): readonly string[] {
  if (before === null) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}
