// The sheet of the dialog, the side panel and the overlay layer, apart from
// the components: the kit's base sheet carries every component's CSS, while
// these components are used only by lazy chunks (the overlays). A module is
// one unit for the bundler, so CSS in the components' module would pull them
// into the first dock chunk (architecture.md §11).

import { LAYERS } from '../layers';

export const DIALOG_CSS = `
.cg-layer { position: fixed; inset: 0; z-index: ${LAYERS.panel}; pointer-events: none; font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink); }
.cg-layer > * { pointer-events: auto; }
.cg-scrim { position: fixed; inset: 0; z-index: ${LAYERS.scrim}; background: var(--cg-scrim); }
.cg-dialog {
  position: fixed; z-index: ${LAYERS.window}; display: flex; flex-direction: column; overflow: hidden;
  background: var(--cg-surface); border: 1px solid var(--cg-rule-float); border-radius: var(--cg-r-xl);
  box-shadow: var(--cg-shadow-float); font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink);
  animation: cg-open 120ms var(--cg-ease);
}
.cg-dialog:focus { outline: none; }
.cg-dialog--center, .cg-dialog--wide { left: 50%; top: 96px; translate: -50% 0; max-height: calc(100vh - 140px); width: min(620px, calc(100vw - 32px)); }
.cg-dialog--wide { width: min(720px, calc(100vw - 32px)); }
.cg-dialog--window { border-color: var(--cg-rule); border-radius: var(--cg-r-md); box-shadow: var(--cg-shadow); animation-duration: 140ms; }
.cg-dialog--column { translate: -50% 0; width: min(420px, calc(100vw - 32px)); max-width: calc(100vw - 32px); }
.cg-side {
  position: fixed; z-index: ${LAYERS.panel}; top: 44px; right: 0; bottom: 0; width: 320px; max-width: 100vw;
  display: flex; flex-direction: column; background: var(--cg-surface); border-left: 1px solid var(--cg-rule);
  /* A panel that ends above the dock (the composer stays free) closes with the same hairline. */
  border-bottom: 1px solid var(--cg-rule);
  /* A panel shorter than its fixed rows (a big zoom above an open result) scrolls as a whole: nothing of it is cut
     off out of reach, and the panel keeps the wheel from the page under it. */
  overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin;
}
.cg-confirm-dlg { padding: 16px 18px 14px; }
.cg-confirm-dlg__title { margin: 0 0 4px; font-size: var(--cg-text-xl); line-height: 22px; font-weight: 600; color: var(--cg-ink-strong); }
.cg-confirm-dlg__body { margin: 0; color: var(--cg-ink-2); }
.cg-confirm-dlg__acts { display: flex; justify-content: flex-end; gap: 6px; margin-top: 14px; }
.cg-confirm-dlg__go.is-destructive { color: var(--cg-ink-strong); font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .cg-dialog { animation: none; } }
`;
