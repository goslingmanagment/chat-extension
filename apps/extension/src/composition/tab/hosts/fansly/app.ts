// The application's half of the Fansly adapter (docs/project-unite/
// architecture.md §1.3, §7.13; tab/adapter.ts): what only Fansly's
// application does with Fansly's host port. It comes in Fansly's `tab-app`
// chunk (lazy/fansly/tab-app.ts) with the first surface of ours on a Fansly
// page — the dock, once the open chat's anchors give it a place (R20 P7d) —
// never in the early bundle.
//
// - No live configuration: nothing of Fansly's host port is switched by the
//   bootstrap (its WS tap is on by itself, FS-WS-4; X8 does not exist here).
// - Fansly's slice of the feature manifest (§1.4) and what its contract report
//   must name (§7.12).
// - Its profile for our interface (§1.5): the dock's variant `fansly` on our
//   hosts and the phrases that name the site — «на Fansly». The palette of the
//   page's variables and the variant's sheet are P8d's: until then the kit's
//   own palette follows the page's scheme (host-fansly isolated/theme.ts).
// - Its AI policy (§1.6, F10): until Fansly's own (`ai-fansly`, P8b1 — the
//   snapshot's proof, the window check, the verdict) the start gathers no
//   proof and adds no field of its own; the hub decides its gates by itself,
//   and no fresh page text leaves the tab.

import type { FanslyHostPort } from '@cg/contracts/fansly-host';
import { FANSLY_CONTRACT } from '@cg/contracts/fansly-host';
import type { AiHostPolicy } from '@cg/contracts/ops';
import type { HostUiProfile } from '@cg/contracts/vm';
import { FANSLY_PHRASES } from '@cg/core/domain/hosts/fansly/i18n';

import { FANSLY_FEATURE_SLICE } from '../../../features/fansly';
import type { HostAppAdapter } from '../../adapter';

/** Fansly's profile for our interface (§1.5): its variant and its phrases; the palette and the sheet come with P8d. */
export const FANSLY_UI: HostUiProfile = {
  dock: { variant: 'fansly' },
  phrases: FANSLY_PHRASES,
};

/** Until P8b1: a start on Fansly gathers no proof of its own and adds nothing to the shared request. */
export const FANSLY_AI: AiHostPolicy<null, null> = {
  preflight: () => null,
  proof: () => null,
  fields: () => ({}),
  fingerprint: () => null,
  verdict: () => null,
};

export const FANSLY_APP: HostAppAdapter<FanslyHostPort, null> = {
  liveConfigOf: () => null,
  configure: () => Promise.resolve(),
  features: FANSLY_FEATURE_SLICE,
  contract: FANSLY_CONTRACT,
  ui: () => FANSLY_UI,
  ai: () => FANSLY_AI,
};
