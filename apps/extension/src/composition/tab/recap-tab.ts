// The fan panel's Recap tab and the recap family (architecture.md §10.2
// «контроллеры по семействам»; ui-design §4.18). The panel and its tabs are
// R12's; the recap of the open chat — its saved copies, its build, its view
// model — is R11's. The tab shows that view without any of the Recap
// sheet's own actions, so nothing would ever read what the hub holds for
// the chat: the tab stayed on «Проверяю сохранённые Recap…» until the
// person opened Recap in the dock. Two families meet here, so the
// composition root says it: while the panel is open on its Recap tab, the
// recap controller is told that its view is on screen (`watch`), and reads
// the saved recaps of each chat opened under it — once, never a build.
//
// The fan panel's view is followed only while the panel is open: a closed
// panel costs nothing here.

import type { FanPanelVM } from '@cg/contracts/vm';

export interface RecapTabDeps {
  readonly overlays: { isOpen(overlay: 'fan-panel'): boolean; subscribe(listener: () => void): () => void };
  readonly router: {
    serves(view: 'fan-panel'): boolean;
    getSnapshot(selector: { readonly of: 'fan-panel' }): Pick<FanPanelVM, 'tab'>;
    subscribe(selector: { readonly of: 'fan-panel' }, listener: (view: Pick<FanPanelVM, 'tab'>) => void): () => void;
  };
  /** The recap controller, once its chunk is in; null before that (the tab then waits for the next change). */
  readonly recap: () => { watch(): () => void } | null;
}

/** Follows the panel and its tab; returns what stops it. */
export function followRecapTab(deps: RecapTabDeps): () => void {
  const { overlays, router } = deps;
  let offView: (() => void) | null = null;
  let offWatch: (() => void) | null = null;

  const sync = (): void => {
    const open = overlays.isOpen('fan-panel');
    if (open && offView === null) offView = router.subscribe({ of: 'fan-panel' }, sync);
    if (!open && offView !== null) {
      offView();
      offView = null;
    }
    const shown = open && router.serves('fan-panel') && router.getSnapshot({ of: 'fan-panel' }).tab === 'recap';
    if (shown && offWatch === null) offWatch = deps.recap()?.watch() ?? null;
    else if (!shown && offWatch !== null) {
      offWatch();
      offWatch = null;
    }
  };
  const offOverlays = overlays.subscribe(sync);
  sync();
  return () => {
    offOverlays();
    offView?.();
    offWatch?.();
    offView = null;
    offWatch = null;
  };
}
