// A text the person types that the view model echoes back (the palette's
// query, the preview's draft): every change is dispatched, and the model
// answers each one a little later. While the person types on, an answer to an
// EARLIER change must not be written back into the field — it would undo the
// characters typed since. This keeps the list of changes the field has sent
// and tells an echo of one of them from a change that came from outside (a
// reset, a restored draft, another fan), which the field does take.

import { useRef } from 'preact/hooks';

/** More changes than this without an answer: the oldest are forgotten. */
const MAX_PENDING = 64;

export interface OwnEchoes {
  /** What the field shows as of this render: the model's value, or the person's newer text while its echo is on the way. */
  readonly shown: string;
  /** The same, read at the moment of the call: what the field sent last, or took from the model since. */
  readonly latest: () => string;
  /** Call with every value the field dispatches. */
  readonly sent: (value: string) => void;
}

interface EchoState {
  scope: string | null;
  model: string;
  shown: string;
  /** Values sent and not yet echoed, oldest first. */
  pending: string[];
}

/** `model` after `state` saw it: an echo of something sent drops it and all sent before it; anything else is taken. */
function takeModelValue(state: EchoState, model: string): void {
  state.model = model;
  const at = state.pending.indexOf(model);
  if (at < 0) {
    state.pending = [];
    state.shown = model;
    return;
  }
  state.pending = state.pending.slice(at + 1);
  if (state.pending.length === 0) state.shown = model;
}

/**
 * `scope` names whose text it is (a fan's handle): another scope starts
 * afresh, so one fan's unanswered typing never shows in the next fan's field.
 */
export function useOwnEchoes(model: string, scope: string | null = null): OwnEchoes {
  const ref = useRef<EchoState | null>(null);
  const state = (ref.current ??= { scope, model, shown: model, pending: [] });
  if (state.scope !== scope) {
    state.scope = scope;
    state.model = model;
    state.shown = model;
    state.pending = [];
  } else if (state.model !== model) {
    takeModelValue(state, model);
  }
  return {
    shown: state.shown,
    latest: () => state.shown,
    sent: (value) => {
      state.pending.push(value);
      if (state.pending.length > MAX_PENDING) state.pending.shift();
      state.shown = value;
    },
  };
}
