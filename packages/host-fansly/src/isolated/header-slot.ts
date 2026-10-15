// P11a, FS-REG-1/4: called by the port's route/anchor sync. No observer or
// keep-alive of our own; no walk of the feed or the neighbour's widgets.
import type { ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';

export function createHeaderSlots(doc: Document, registry: ShadowRootRegistry) {
  let row: Element | null = null;
  const listeners = new Set<() => void>();
  const slots = new Map<number, { host: HTMLElement; root: ShadowRoot; unregister: () => void }>();
  const place = (): void => {
    const ordered = [...slots.entries()].sort(([a], [b]) => a - b);
    for (let index = ordered.length - 1; index >= 0; index--) {
      const entry = ordered[index];
      if (!entry) continue;
      const host = entry[1].host;
      if (row === null || !row.isConnected) { host.remove(); continue; }
      const next = ordered[index + 1]?.[1].host ?? null;
      // Only our relative order matters. A neighbour's nodes stay where it put them.
      if (host.parentElement !== row || (next !== null && !(host.compareDocumentPosition(next) & 4))) row.insertBefore(host, next);
    }
  };
  return {
    sync(target: Element | null) {
      const changed = target !== row;
      row = target;
      place();
      if (changed) for (const listener of [...listeners]) listener();
    },
    onChange(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    available: () => row?.isConnected === true,
    mount(order: number) {
      if (slots.has(order)) throw new Error('header slot already occupied');
      const host = doc.createElement('div');
      host.setAttribute('data-host', 'header-slot');
      host.setAttribute('data-header-order', String(order));
      host.style.cssText = 'display:inline-flex;flex:0 0 auto;align-items:center;min-width:0;contain:layout style';
      const root = host.attachShadow({ mode: 'closed' });
      const unregister = registry.register(host, root);
      slots.set(order, { host, root, unregister });
      place();
      return { host, root, remove() { unregister(); slots.delete(order); host.remove(); } };
    },
    dispose() {
      row = null;
      for (const slot of slots.values()) { slot.unregister(); slot.host.remove(); }
      slots.clear();
      listeners.clear();
    },
  };
}

export type HeaderSlots = ReturnType<typeof createHeaderSlots>;
