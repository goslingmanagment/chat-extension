// Attributes that several of our surfaces may hold on one element at once
// (architecture.md §6.3, §10.2 п. 5): the overlay host carries the palette,
// Spenders, «Новые» and the toasts in one shadow root, so `data-scheme`
// and `data-dismissible-open` stay while any surface there still needs them
// and go with the last one. Each hold is released once; a second release of
// the same hold does nothing.

const holders = new WeakMap<Element, Map<string, number>>();

/** Sets `name` on `element` and returns its release; the attribute goes when the last holder lets go. */
export function holdAttribute(element: Element, name: string, value = ''): () => void {
  let counts = holders.get(element);
  if (counts === undefined) {
    counts = new Map();
    holders.set(element, counts);
  }
  const byName = counts;
  byName.set(name, (byName.get(name) ?? 0) + 1);
  element.setAttribute(name, value);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (byName.get(name) ?? 1) - 1;
    if (left > 0) {
      byName.set(name, left);
      return;
    }
    byName.delete(name);
    element.removeAttribute(name);
  };
}

/** How many holds `element` has on `name` (tests). */
export function attributeHolds(element: Element, name: string): number {
  return holders.get(element)?.get(name) ?? 0;
}
