// Which of the page's own event handlers is running. Fansly's composer sends
// inside the Enter keydown or the Send click itself (main:56025-56035,
// :56169-56199, :29012-29023): the journal records the handler a request was
// made in, so a test can tell a send of the gesture from one of a callback.

import type { HandlerEvent } from './protocol';

let current: Event | null = null;

/** Wraps a listener of the page: while it runs, `inHandler()` names its event. */
export function handler<E extends Event>(listener: (event: E) => void): (event: E) => void {
  return (event: E) => {
    const outer = current;
    current = event;
    try {
      listener(event);
    } finally {
      current = outer;
    }
  };
}

export function inHandler(): HandlerEvent | null {
  return current === null ? null : { type: current.type, isTrusted: current.isTrusted, eventPhase: current.eventPhase };
}
