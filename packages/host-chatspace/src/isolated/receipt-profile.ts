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

import type { ReceiptProfile } from '@cg/contracts/hub';

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

/**
 * The id of the first profile that names this adapter version and, for every
 * essential role, exactly the loaded fingerprint (and nothing the page did
 * not load); null — none.
 */
export function matchReceiptProfile(modules: Readonly<Record<string, string>>, profiles: readonly ReceiptProfile[], adapterVersion: string, roles: readonly string[] = RECEIPT_MODULE_ROLES): string | null {
  for (const profile of profiles) {
    if (profile.adapterVersion !== adapterVersion) continue;
    const named = Object.keys(profile.modules);
    if (roles.every((role) => named.includes(role)) && named.every((role) => roles.includes(role) && modules[role] === profile.modules[role])) return profile.id;
  }
  return null;
}
