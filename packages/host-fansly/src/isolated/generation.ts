// The generation of a Fansly tab's port (docs/project-unite/architecture.md
// §7.2, §7.13; FS-RTE-2, FS-RTE-4): ONE token for the page's life, its route
// and its creator. It grows with every change of the address, with a return
// from the back-forward cache (a new route epoch even on the same address) and
// with a change of creator — so it is also the port's route epoch: what
// `RouteState.epoch`, `HostIdentity.routeEpoch` and `fx.focus` carry.
//
// Every asynchronous answer of the port is asked under the generation of the
// moment it leaves and taken only if the generation is still that one when it
// lands (`under`): MAIN's state, the generation snapshot. MAIN's chat answers a
// focus that named the generation itself (`fx.chat.routeEpoch`), and a read or
// a write names it in its identity. An answer of another generation is dropped
// whole — never a part of it.

/**
 * An answer and whether it is still of the generation it was asked in. A stale one is never taken; only the transport
 * may still read it (the stream frees the credits a state names).
 */
export interface Taken<T> {
  readonly fresh: boolean;
  readonly value: T;
}

/** Runs an ask under the generation of now; its answer counts only if the generation has not moved since. */
export type Under = <T>(ask: () => Promise<T>) => Promise<Taken<T>>;

export interface Generation {
  current(): number;
  /** The page's life, route or creator changed: what was asked before is of another generation. */
  advance(): number;
  readonly under: Under;
}

export function createGeneration(start = 1): Generation {
  let generation = start;
  return {
    current: () => generation,
    advance: () => (generation += 1),
    under: (ask) => {
      const asked = generation;
      return ask().then((value) => ({ fresh: generation === asked, value }));
    },
  };
}
