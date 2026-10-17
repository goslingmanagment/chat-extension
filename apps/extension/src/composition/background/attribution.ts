// Who sent each message (decision X48; hub `clientSendAttributions`): the
// page and the client a send is recorded for, as the background takes it —
// from a tab, a human send of the composer whose own response named the
// message (`attribution.report`), or from a site's module, a send of a
// preview the person clicked (`kit.attributions`). The reporter of the core
// (services/send-attribution.ts) owes it to the hub under the person signed
// in; this rule only says whether there is anything to owe:
// - somebody is signed in (a bootstrap of their sign-in is known);
// - the site names itself as an observer of sends
//   (HOST_SEND_ATTRIBUTION_SOURCE; Fansly does not yet);
// - the send's account is bound to a page this bootstrap grants;
// - that page admits the feature `send-attribution` of the site's slice: the
//   hub serves `send-attribution-v1` and — on ChatSpace, where the receipt
//   pairs with the tap's echo — the page's own `wsTap` is usable.

import type { FeatureSlice } from '@cg/contracts/features/types';
import { HOST_SEND_ATTRIBUTION_SOURCE } from '@cg/contracts/hosts';
import type { Bootstrap } from '@cg/contracts/hub';
import type { HostKind } from '@cg/contracts/ids';
import { admission, onPage } from '@cg/core/domain/features';

export type AttributionTarget =
  | { readonly ok: true; readonly pageLabel: string; readonly source: string }
  | { readonly ok: false; readonly reason: 'signed_out' | 'site' | 'unbound' | 'not_admitted' };

/** `pageId` — the page the send's account is bound to; null — none can be told (not reported, two pages, no creator id yet). */
export function attributionTarget(host: HostKind, pageId: number | null, bootstrap: Bootstrap | null, features: (host: HostKind) => FeatureSlice | null): AttributionTarget {
  if (bootstrap === null) return { ok: false, reason: 'signed_out' };
  const source = HOST_SEND_ATTRIBUTION_SOURCE[host];
  if (source === null) return { ok: false, reason: 'site' };
  const page = pageId === null ? undefined : bootstrap.pages.find((candidate) => candidate.pageId === pageId);
  if (page === undefined) return { ok: false, reason: 'unbound' };
  if (admission(features(host), 'send-attribution', null, onPage(bootstrap, page)).state !== 'on') return { ok: false, reason: 'not_admitted' };
  return { ok: true, pageLabel: page.pageLabel, source };
}
