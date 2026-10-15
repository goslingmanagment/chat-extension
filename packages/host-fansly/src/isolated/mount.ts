// Our hosts on a Fansly page at the start (docs/project-unite/architecture.md
// §7.1, §7.3): the dock host with its closed root exists from document_start —
// the early key dispatcher marks a waiting key on it — but stands nowhere until
// the anchors of the open chat place it by Fansly's composer (P7c finds them,
// P7d mounts the dock, its overlays and the theme). The overlay hosts are the
// shared ones of host-kit, made in <html> on first use, on their z-layers.
//
// Nothing here touches an element's `style` in the synchronous start: its first
// touch in a page's content-script global costs ~0.3 ms (§3.1, ≤ 3 ms).

import type { MountPoints } from '@cg/contracts/host';
import { HOST_ATTRIBUTE, LAYER_ATTRIBUTE, mountClosedHost, OVERLAY_Z, type ClosedHost, type OverlayLayer } from '@cg/host-kit/isolated/hosts';
import { createShadowRootRegistry, type ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';

export interface FanslyMounts {
  /** The one dock host; until P7d it stands in no document. */
  readonly dock: ClosedHost;
  /** The overlay host of a layer, created in <html> on first use. */
  overlay(layer: OverlayLayer): ClosedHost;
  points(): MountPoints;
  onChange(listener: (points: MountPoints) => void): () => void;
  /** Which owners keep one of our windows open on a host (§6.3); what Fansly's own Esc needs of it is P7d's. */
  setDismissibleOpen(target: 'dock' | OverlayLayer, owner: string, open: boolean): void;
  /** Our hosts and their closed roots, for the hotkey dispatcher (§9.1). */
  readonly registry: ShadowRootRegistry;
  dispose(): void;
}

export function createFanslyMounts(doc: Document): FanslyMounts {
  const registry = createShadowRootRegistry();
  const dockHost = doc.createElement('div');
  dockHost.setAttribute(HOST_ATTRIBUTE, 'dock');
  const dockRoot = dockHost.attachShadow({ mode: 'closed' });
  const unregister = registry.register(dockHost, dockRoot);
  const dock: ClosedHost = {
    host: dockHost,
    root: dockRoot,
    remove: () => {
      unregister();
      dockHost.remove();
    },
  };
  const overlays = new Map<OverlayLayer, ClosedHost>();

  const overlay = (layer: OverlayLayer): ClosedHost => {
    let found = overlays.get(layer);
    if (found === undefined) {
      if ((doc.documentElement as HTMLElement | null) === null) throw new Error('overlay before <html> exists');
      found = mountClosedHost(doc.documentElement, 'overlay', 'last', registry);
      found.host.setAttribute(LAYER_ATTRIBUTE, layer);
      const style = found.host.style;
      style.setProperty('position', 'fixed');
      style.setProperty('inset', '0');
      style.setProperty('pointer-events', 'none');
      style.setProperty('z-index', String(OVERLAY_Z[layer]));
      overlays.set(layer, found);
    }
    return found;
  };

  return {
    dock,
    overlay,
    points: () => ({
      dock: { kind: 'none', composerInstanceId: null, width: null },
      overlay: { ready: (doc.documentElement as HTMLElement | null) !== null, container: null },
    }),
    // P7d supplies anchor changes and dismissal handling; the starter has neither yet.
    onChange: () => () => undefined,
    setDismissibleOpen: () => undefined,
    registry,
    dispose() {
      dock.remove();
      for (const host of overlays.values()) host.remove();
      overlays.clear();
    },
  };
}
