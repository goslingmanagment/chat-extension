// The operation state machine (architecture.md §7): admitted → requesting →
// streaming → done | failed | canceled | interrupted, over the frozen
// OP_TRANSITIONS. A state only moves forward; a terminal state never moves
// again («новое состояние побеждает», RB-020: a late event for an older
// state is dropped, never applied).

import { OP_TERMINAL_STATES, OP_TRANSITIONS, type OpState, type Phase } from '@cg/contracts/ops';

export type OpTerminalState = (typeof OP_TERMINAL_STATES)[number];
export type PhaseName = Phase['name'];

export function isTerminalOpState(state: OpState): state is OpTerminalState {
  return (OP_TERMINAL_STATES as readonly OpState[]).includes(state);
}

/** Still holds its chat slot and its tab slot (А3). */
export function isActiveOpState(state: OpState): boolean {
  return !isTerminalOpState(state);
}

export function canMoveOp(from: OpState, to: OpState): boolean {
  return (OP_TRANSITIONS[from] as readonly OpState[]).includes(to);
}

/** Position of a state in the forward order, for «newer wins» comparisons (RB-020). */
const ORDER: Readonly<Record<OpState, number>> = {
  admitted: 0,
  requesting: 1,
  streaming: 2,
  done: 3,
  failed: 3,
  canceled: 3,
  interrupted: 3,
};

/** Whether `next` may replace `current`: a later stage of the same run, never a step back. */
export function isNewerOpState(current: OpState, next: OpState): boolean {
  if (current === next) return false;
  if (isTerminalOpState(current)) return false;
  return ORDER[next] > ORDER[current] || canMoveOp(current, next);
}

/** The phase each state starts in (AI-139). `retry-wait`, `parsing` and `saving-profile` are entered explicitly. */
export const PHASE_OF_STATE: Readonly<Record<OpState, PhaseName>> = {
  admitted: 'admitted',
  requesting: 'connecting',
  streaming: 'awaiting-first-chunk',
  done: 'settled',
  failed: 'settled',
  canceled: 'settled',
  interrupted: 'settled',
};

/** Phases allowed in each state; anything else is a programming error the scheduler refuses. */
export const PHASES_OF_STATE: Readonly<Record<OpState, readonly PhaseName[]>> = {
  admitted: ['admitted'],
  requesting: ['connecting', 'awaiting-meta', 'retry-wait'],
  streaming: ['awaiting-first-chunk', 'streaming', 'parsing', 'saving-profile'],
  done: ['settled'],
  failed: ['settled'],
  canceled: ['settled'],
  interrupted: ['settled'],
};

export function phaseFits(state: OpState, phase: PhaseName): boolean {
  return PHASES_OF_STATE[state].includes(phase);
}
