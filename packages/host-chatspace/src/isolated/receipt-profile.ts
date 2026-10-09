// The receipt profile of X8 (architecture.md §6.2 «Исключение — X8»): the
// preview send is on only while the modules ChatSpace's send path lives in
// are exactly the ones of a profile the owner approved
// (bootstrap `limits.previewSendReceiptProfiles`).
//
// A module's fingerprint is its hashed address: ChatSpace's build names every
// module `/assets/<role>-<hash>.js`, the hash changing with the content. They
// are read from what the page ALREADY loaded — `<script src>` and
// `<link rel="modulepreload">` in the DOM, and the document's resource
// timing entries — never downloaded, never requested. A role's fingerprint
// is the sorted set of its hashes joined with `+` (0.172.0 has two modules
// named `composables`); a role loaded in two versions therefore matches no
// profile. A missing role, an unknown hash, another adapter version — no
// match, X8 stays off (CG-SEND-RECEIPT); the open-and-insert path still works.
//
// The profile comes from the hub as data only: no code, no selectors. The
// roles that must be there are the adapter's own (host-contract.ts).
//
// The «any build» sentinel (decision X25, contracts 1.11.0): a profile whose
// `modules` is exactly `{"*":"*"}` matches any build for the adapter version it
// names — still only when the page has loaded a module of every role (the
// main layout is up). Exact profiles are tried first: a reviewed build is named
// as one. The fuse (main/receipt.ts) watches what X8 does after that.

import type { ReceiptProfile } from '@cg/contracts/hub';
import { isAnyBuildReceiptProfile, type ReceiptMatchKind } from '@cg/contracts/send-rules';

import { MODULE_PATTERN, RECEIPT_MODULE_ROLES } from './host-contract';

/** A fingerprint the contract's wire can carry (ContractWire.receiptModules, ReceiptProfile.modules). */
const MAX_FINGERPRINT = 128;

/** URLs of the scripts this document already loaded: DOM first, then resource timing. No request is made. */
export function loadedScriptUrls(win: Window): string[] {
  const urls: string[] = [];
  try {
    for (const element of win.document.querySelectorAll('script[src], link[rel="modulepreload"][href]')) {
      // The resolved address (`.src` / `.href`), not the attribute as written.
      const url = (element as HTMLScriptElement).src || (element as HTMLLinkElement).href;
      if (typeof url === 'string' && url !== '') urls.push(url);
    }
    for (const entry of win.performance.getEntriesByType('resource')) urls.push(entry.name);
  } catch {
    // An unreadable page: whatever was collected counts; a missing role matches no profile.
  }
  return urls;
}

/** Role → fingerprint of the essential modules among `urls`; only this page's own origin counts. */
export function receiptModules(urls: readonly string[], origin: string, roles: readonly string[] = RECEIPT_MODULE_ROLES): Record<string, string> {
  const hashes = new Map<string, Set<string>>();
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw, origin);
    } catch {
      continue;
    }
    const match = url.origin === origin ? MODULE_PATTERN.exec(url.pathname) : null;
    const role = match?.[1];
    const hash = match?.[2];
    if (role === undefined || hash === undefined || !roles.includes(role)) continue;
    const set = hashes.get(role) ?? new Set<string>();
    set.add(hash);
    hashes.set(role, set);
  }
  const modules: Record<string, string> = {};
  for (const role of roles) {
    const fingerprint = [...(hashes.get(role) ?? [])].sort().join('+');
    if (fingerprint !== '' && fingerprint.length <= MAX_FINGERPRINT) modules[role] = fingerprint;
  }
  return modules;
}

/** Which profile let X8 in, and how (contracts HostContractReport `receiptMatch`). */
export interface ReceiptMatch {
  readonly profile: string;
  readonly kind: ReceiptMatchKind;
}

/**
 * The profile the loaded modules match, for this adapter version; null — none.
 * - `exact`: the first profile that names, for every essential role, exactly
 *   the loaded fingerprint (and nothing the page did not load);
 * - `anyBuild`: else the first «any build» sentinel, when a module of every
 *   essential role is loaded — whatever its fingerprint. A page whose role
 *   modules have not loaded (no main layout yet, no sign-in) matches nothing.
 */
export function matchReceiptProfile(modules: Readonly<Record<string, string>>, profiles: readonly ReceiptProfile[], adapterVersion: string, roles: readonly string[] = RECEIPT_MODULE_ROLES): ReceiptMatch | null {
  const ours = profiles.filter((profile) => profile.adapterVersion === adapterVersion);
  for (const profile of ours) {
    if (isAnyBuildReceiptProfile(profile)) continue;
    const named = Object.keys(profile.modules);
    if (roles.every((role) => named.includes(role)) && named.every((role) => roles.includes(role) && modules[role] === profile.modules[role])) return { profile: profile.id, kind: 'exact' };
  }
  const loaded = roles.length > 0 && roles.every((role) => typeof modules[role] === 'string' && modules[role] !== '');
  const sentinel = loaded ? ours.find((profile) => isAnyBuildReceiptProfile(profile)) : undefined;
  return sentinel === undefined ? null : { profile: sentinel.id, kind: 'anyBuild' };
}
