// The fan panel's Recap tab → the recap controller's watch (tab/recap-tab.ts).

import { describe, expect, it } from 'vitest';

import { followRecapTab } from './recap-tab';

function world(options: { readonly recap?: boolean } = {}) {
  const state = { open: false, tab: 'fan' as 'fan' | 'recap', served: true, recap: options.recap ?? true };
  const overlayListeners = new Set<() => void>();
  const viewListeners = new Set<(view: { tab: 'fan' | 'recap' }) => void>();
  const watches = { started: 0, stopped: 0 };
  const off = followRecapTab({
    overlays: {
      isOpen: () => state.open,
      subscribe(listener) {
        overlayListeners.add(listener);
        return () => overlayListeners.delete(listener);
      },
    },
    router: {
      serves: () => state.served,
      getSnapshot: () => ({ tab: state.tab }),
      subscribe(_selector, listener) {
        viewListeners.add(listener);
        return () => viewListeners.delete(listener);
      },
    },
    recap: () =>
      state.recap
        ? {
            watch() {
              watches.started += 1;
              return () => {
                watches.stopped += 1;
              };
            },
          }
        : null,
  });
  return {
    state,
    watches,
    off,
    panel(open: boolean) {
      state.open = open;
      for (const listener of [...overlayListeners]) listener();
    },
    tab(tab: 'fan' | 'recap') {
      state.tab = tab;
      for (const listener of [...viewListeners]) listener({ tab });
    },
    following: () => viewListeners.size,
    listening: () => overlayListeners.size,
  };
}

describe('the fan panel’s Recap tab tells the recap controller that its view is on screen', () => {
  it('[AI-069] [CS-031] the watch lasts exactly while the panel is open on the Recap tab; a closed panel is not followed at all', () => {
    const w = world();
    expect(w.following()).toBe(0);
    w.panel(true);
    // The panel opens on «Фан»: followed, not watched.
    expect(w.following()).toBe(1);
    expect(w.watches).toEqual({ started: 0, stopped: 0 });
    w.tab('recap');
    expect(w.watches).toEqual({ started: 1, stopped: 0 });
    // The same tab said again (a chat switch rebuilds the view): one watch, not two.
    w.tab('recap');
    expect(w.watches.started).toBe(1);
    w.tab('fan');
    expect(w.watches).toEqual({ started: 1, stopped: 1 });
    w.tab('recap');
    w.panel(false);
    expect(w.watches).toEqual({ started: 2, stopped: 2 });
    expect(w.following()).toBe(0);
    // Reopened: the panel remembers its tab, and the recap is read for whoever is open now.
    w.panel(true);
    expect(w.watches).toEqual({ started: 3, stopped: 2 });
    w.off();
    expect(w.watches).toEqual({ started: 3, stopped: 3 });
    expect([w.following(), w.listening()]).toEqual([0, 0]);
  });

  it('a panel whose controller or whose recap family is not in yet starts no watch, and starts one once they are', () => {
    const w = world({ recap: false });
    w.state.served = false;
    w.state.tab = 'recap';
    w.panel(true);
    expect(w.watches.started).toBe(0);
    // The boards' controllers arrive: the router announces the view to its subscribers.
    w.state.served = true;
    w.tab('recap');
    expect(w.watches.started).toBe(0);
    w.state.recap = true;
    w.tab('recap');
    expect(w.watches.started).toBe(1);
  });
});
