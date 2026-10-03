// A read-only value that changes over time, as the composition root hands it
// to the UI (scheme, geometry). Not @preact/signals: those stay inside ui/
// (§10.1); ui/kit adapts this shape to them.

export interface ValueSignal<T> {
  readonly value: T;
  /** Called with every new value; returns the unsubscribe. */
  subscribe(listener: (value: T) => void): () => void;
}
