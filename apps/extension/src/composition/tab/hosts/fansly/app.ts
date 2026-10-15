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
// - Its profile for our interface (§1.5, R20 P8d): the palette of the page's
//   own variables, live with its theme (host-fansly isolated/palette.ts), the
//   dock's variant `fansly` on our hosts with its sheet (ui hosts/fansly), and
//   the phrases that name the site — «на Fansly».
// - Its AI policy (§1.6, F10): until Fansly's own (`ai-fansly`, P8b1 — the
//   snapshot's proof, the window check, the verdict) the start gathers no
//   proof and adds no field of its own; the hub decides its gates by itself,
//   and no fresh page text leaves the tab.

import type { FanslyHostPort } from '@cg/contracts/fansly-host';
import { FANSLY_CONTRACT } from '@cg/contracts/fansly-host';
import type { AiHostPolicy } from '@cg/contracts/ops';
import type { HostUiProfile } from '@cg/contracts/vm';
import { FANSLY_PHRASES } from '@cg/core/domain/hosts/fansly/i18n';
import { fanslyPaletteSignal } from '@cg/host-fansly/isolated/palette';
import { FANSLY_DOCK_SHEET } from '@cg/ui/hosts/fansly';

import { FANSLY_FEATURE_SLICE } from '../../../features/fansly';
import type { HostAppAdapter, HostThemeSource } from '../../adapter';

/** The page our content script runs in: read only when a surface mounts or the page's theme switches. */
const page = (): Document => document;

/**
 * Fansly's profile for our interface (§1.5, §7.17): the palette of the page's own variables in the theme it shows,
 * live; the variant `fansly` with its sheet; its phrases.
 */
export function fanslyUi(theme: HostThemeSource, doc: () => Document = page): HostUiProfile {
  return {
    palette: fanslyPaletteSignal(theme, doc),
    dock: { variant: 'fansly' },
    sheet: FANSLY_DOCK_SHEET,
    phrases: FANSLY_PHRASES,
  };
}

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
  ui: (theme) => fanslyUi(theme),
  ai: () => FANSLY_AI,
};
