// Our hosts and their closed shadow roots, for the early hotkey dispatcher
// (architecture.md §9.1): «the early dispatcher keeps a registry "our host →
// its closed ShadowRoot"; the mount gives it the root». From outside a closed
// root `composedPath()` stops at the host, so the registry is how the
// dispatcher learns that an event came from our UI and what is focused there.

export interface ShadowRootRegistry {
  /** Registers a host and its root; the returned function unregisters it. */
  register(host: Element, root: ShadowRoot): () => void;
  rootOf(host: Element): ShadowRoot | null;
  /** Our host the event passed through (its composed path), or null. */
  hostOf(event: Event): Element | null;
  /** The element focused inside one of our roots when the document's focus is on our host, or null. */
  focusedInside(doc: Document): Element | null;
  hosts(): readonly Element[];
}

export function createShadowRootRegistry(): ShadowRootRegistry {
  const roots = new Map<Element, ShadowRoot>();
  return {
    register(host, root) {
      roots.set(host, root);
      return () => {
        if (roots.get(host) === root) roots.delete(host);
      };
    },
    rootOf: (host) => roots.get(host) ?? null,
    hostOf(event) {
      for (const target of event.composedPath()) if (target instanceof Element && roots.has(target)) return target;
      return null;
    },
    focusedInside(doc) {
      const active = doc.activeElement;
      const root = active ? roots.get(active) : undefined;
      let inner = root?.activeElement ?? null;
      // A nested shadow root of our own UI (a component with its own root).
      while (inner?.shadowRoot?.activeElement) inner = inner.shadowRoot.activeElement;
      return inner;
    },
    hosts: () => [...roots.keys()],
  };
}
