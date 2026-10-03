// Stacking and motion constants (ui-design §2.9, §3.4; architecture.md §6.3).
// Our overlays live in their own host outside #app; ChatSpace's PrimeVue
// dialogs (from 1000) stay above us. One 950 window is active at a time.

export const LAYERS = {
  /** The tone and «Ещё» menus above the dock strip, inside the dock. */
  dockMenu: 5,
  /** Side panels: the fan panel, Coach. */
  panel: 900,
  /** The scrim under the palette and the cheatsheet. */
  scrim: 940,
  /** Windows: Spenders, «Новые», the palette, the cheatsheet, the expanded result. */
  window: 950,
  toast: 960,
  tooltip: 970,
} as const;

export type LayerName = keyof typeof LAYERS;

/** Transitions answer an action and never run longer (§1 п. 14). */
export const MOTION = {
  /** Sheet, window and toast appearance. */
  openMs: 140,
  /** Menus, palette, cheatsheet, popup. */
  popMs: 120,
  /** Hover and press colour changes. */
  hoverMs: 120,
  maxTransitionMs: 150,
} as const;

/** `prefers-reduced-motion: reduce` in this window; false when unknown. */
export function prefersReducedMotion(view: Pick<Window, 'matchMedia'> | null | undefined): boolean {
  try {
    return view?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Set on our overlay host while one of our windows is open: ChatSpace's Esc
 * then leaves its chat tab alone (architecture.md §6.3, MainLayout:331-333).
 */
export const DISMISSIBLE_OPEN_ATTRIBUTE = 'data-dismissible-open';
