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
// - Its AI policy (§1.6, F10; R20 P8b1): Fansly's own chunk `ai-fansly`,
//   loaded with the dock — every start's proof is MAIN's generation snapshot
//   (the window check, the fan's known ids, the deletions, a draft's texts),
//   its window cut by the person's message windows, which the application
//   half follows from its start (`followWindows`).
// - Its own surfaces (R20 P13b): the vault's chunk on `/creator/vault`.

import { FANSLY_CONTRACT } from '@cg/contracts/fansly-host';
import type { HostUiProfile, MountSurfaceKind } from '@cg/contracts/vm';
import { followWindows, type MessageWindows } from '@cg/core/application/hosts/fansly/ai';
import { FANSLY_PHRASES } from '@cg/core/domain/hosts/fansly/i18n';
import type { FanslyPort } from '@cg/host-fansly/isolated';
import { fanslyPaletteSignal } from '@cg/host-fansly/isolated/palette';
import { FANSLY_DOCK_SHEET } from '@cg/ui/hosts/fansly';

import type * as AiChunk from '../../../../../lazy/fansly/ai-fansly';
import type * as VaultChunk from '../../../../../lazy/fansly/vault';
import { FANSLY_FEATURE_SLICE } from '../../../features/fansly';
import type { HostAppAdapter, HostThemeSource, SiteAppEnv } from '../../adapter';

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

/** The vault's page (host-fansly isolated/vault `isVaultPath`: its module is the vault's chunk, not this one). */
const onVault = (path: string): boolean => path === '/creator/vault' || path === '/creator/vault/';

/**
 * Fansly's own surfaces (R20 P13b): the vault's chunk the first time the tab is on `/creator/vault` (FS-PERF-3), kept
 * from then on — it says itself where its entry stands. A chunk that did not load is asked again on the next visit.
 */
export function startFanslySurfaces(env: SiteAppEnv<FanslyPort>): () => void {
  let vault: Promise<(() => void) | null> | null = null;
  const sync = (): void => {
    if (vault !== null || env.life.aborted || !onVault(env.win.location.pathname)) return;
    vault = env.lazy<typeof VaultChunk>('vault').then(
      (chunk) => (env.life.aborted ? null : chunk.startFanslyVault(env)),
      (error: unknown) => {
        vault = null;
        env.report({ kind: 'render', surface: 'vault' as MountSurfaceKind, code: 'CG-UI-FAILED', name: error instanceof Error ? error.name : typeof error });
        return null;
      },
    );
  };
  const off = env.host.subscribe((event) => {
    if (event.type === 'route') sync();
  });
  sync();
  return () => {
    off();
    void vault?.then((stop) => stop?.());
  };
}

/**
 * The application's half of Fansly's adapter. Its AI policy and its start share what the tab heard of the person's
 * message windows: the policy cuts a start's check window by them (FS-TAIL-1), the start follows them for as long as
 * the application lives. Until the first read the policy gathers no proof («свежесть не проверена», FS-TAIL-7).
 */
export function fanslyApp(): HostAppAdapter<FanslyPort, null> {
  let windows: MessageWindows | null = null;
  return {
    liveConfigOf: () => null,
    configure: () => Promise.resolve(),
    features: FANSLY_FEATURE_SLICE,
    contract: FANSLY_CONTRACT,
    ui: (theme) => fanslyUi(theme),
    ai: (lazy) => lazy<typeof AiChunk>('ai-fansly').then((chunk) => chunk.createFanslyAi({ windows: () => windows, now: () => Date.now() })),
    start: (env) => {
      const offWindows = followWindows(env.rpc, env.life, (next) => {
        windows = next;
      });
      const offSurfaces = startFanslySurfaces(env);
      return () => {
        offWindows();
        offSurfaces();
      };
    },
  };
}

export const FANSLY_APP: HostAppAdapter<FanslyPort, null> = fanslyApp();
