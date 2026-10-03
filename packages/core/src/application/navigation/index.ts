// core/application/navigation — chat navigation, the palette, the quick jump
// and the cheatsheet as parts of the tab's AppClient (architecture.md §6.9,
// §10.2). Each factory returns a SurfaceController with injected ports; the
// integrator plugs them into `core/application/router.ts`.
//
//   overlays = createOverlayState(); cause = createCauseHint();
//   navigation = createNavigationController({ host, rpc, i18n, ids, clock, overlays, toasts, cause, ownerSwitch });
//   palette = createPaletteController({ host, rpc, i18n, catalog, clock, overlays,
//     dock: { get: () => client.getSnapshot({ of: 'dock' }), subscribe: (cb) => client.subscribe({ of: 'dock' }, cb) },
//     preview: { open: (chat) => previewController.openFor(chat, 'palette') } });
//   quickJump = createQuickJumpController({ host, i18n, overlays, clock });
//   cheatsheet = createCheatsheetController({ catalog });
//
// HostPort.navigate redeems its token through the composition root's
// `redeem`; R17 issues every navigation token for NAVIGATION_SURFACE.

export { createCheatsheetController } from './cheatsheet-controller';
export {
  LIST_SETTLE_MS,
  NAVIGATION_LIST_LIMIT,
  NAVIGATION_SURFACE,
  accountHandle,
  chatHandle,
  createCauseHint,
  createNavigationController,
  parseAccountHandle,
  parseChatHandle,
  type CauseHint,
  type NavigationController,
  type NavigationControllerDeps,
} from './navigation-controller';
export { createOverlayState, mirrorDismissible, overlayLayerOf, type OverlayState } from './overlays';
export {
  PALETTE_LIMITS,
  createPaletteController,
  createPaletteHub,
  type PaletteControllerDeps,
  type PaletteFanRow,
  type PaletteHubPort,
  type PaletteSource,
  type PaletteWaitingRow,
} from './palette-controller';
export { codeView, failedReceipt, type IdPort, type NavRequestType, type RpcAnswer, type SurfaceController, type TabClock, type TabRpc } from './ports';
export { createQuickJumpController, type QuickJumpControllerDeps } from './quick-jump-controller';
