// The generation of a Fansly tab's port (docs/project-unite/architecture.md
// §7.2, §7.13; FS-RTE-2, FS-RTE-4): ONE token for the page's life, its route
// and its creator. It grows with every change of the address, with a return
// from the back-forward cache (a new route epoch even on the same address) and
// with a change of creator — so it is also the port's route epoch: what
// `RouteState.epoch`, `HostIdentity.routeEpoch` and `fx.focus` carry.
//
// Every asynchronous answer of the port is asked under the generation of the
// moment it leaves and taken only if the generation is still that one when it
// is consumed (`under`, `fresh()`): MAIN's state, the generation snapshot, the
// answer to a focus. MAIN's chat answers a focus that named the generation
// itself (`fx.chat.routeEpoch`), and a read or a write names it in its
// identity. An answer of another generation is dropped whole — never a part
// of it.

/**
 * The outcome of an ask — its answer or its failure — and whether the generation it was asked in is still the
 * current one. `fresh()` is read at the moment of consumption, never when the answer lands: an answer that waits a
 * turn (an `await`, a microtask) may see the page move in between. A stale outcome is never taken; only the transport
 * may still read it (the stream frees the credits a state names).
 */
export type Taken<T> = ({ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }) & { readonly fresh: () => boolean };

/** Runs an ask under the generation of now; never rejects — a failure is an outcome too, of its own generation. */
export type Under = <T>(ask: () => Promise<T>) => Promise<Taken<T>>;

export interface Generation {
  current(): number;
  /** The page's life, route or creator changed: what was asked before is of another generation. */
  advance(): number;
  readonly under: Under;
}

export function createGeneration(start = 1): Generation {
  let generation = start;
  const under: Under = <T>(ask: () => Promise<T>): Promise<Taken<T>> => {
    const asked = generation;
    const fresh = (): boolean => generation === asked;
    return ask().then(
      (value): Taken<T> => ({ ok: true, value, fresh }),
      (error: unknown): Taken<T> => ({ ok: false, error, fresh }),
    );
  };
  return {
    current: () => generation,
    advance: () => (generation += 1),
    under,
  };
}
