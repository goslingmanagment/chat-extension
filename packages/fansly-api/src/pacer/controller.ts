import type { PacePolicy } from './policy';

/** One pace key's spacing. Pure data and pure transitions: no timers, no IO,
 * so every rule below is testable on its own (E130). A key never runs faster
 * than its policy: the learned upward probing of 2.4.3 earned a few seconds a
 * scan on evidence too thin to trust and was removed (E133). */
export interface RouteState {
  spacingMs: number;
  lastStartAt: number;
  /** The spacing Fansly last limited this key at, and when. */
  badMs: number;
  badAt: number;
}

/** A limited spacing is remembered this long, and the key stays this far above it. */
export const BAD_MEMORY_MS = 24 * 3600_000;
const BAD_MARGIN = 1.25;

export const fresh = (policy: PacePolicy): RouteState => ({ spacingMs: policy.startMs, lastStartAt: 0, badMs: 0, badAt: 0 });

/** Lowest spacing allowed now: the policy's own, or a margin above a remembered limit. */
export function floorOf(state: RouteState, policy: PacePolicy, now: number): number {
  const remembered = state.badMs > 0 && now - state.badAt < BAD_MEMORY_MS;
  return remembered ? Math.min(policy.ceilMs, Math.max(policy.startMs, Math.ceil(state.badMs * BAD_MARGIN))) : policy.startMs;
}

export function limited(state: RouteState, policy: PacePolicy, now: number): RouteState {
  return { ...state, badMs: state.spacingMs, badAt: now, spacingMs: Math.min(policy.ceilMs, state.spacingMs * 2) };
}

/** The lane forgave one level (five quiet minutes, then twenty answered
 * reads, E128): the key takes one step back toward its floor with it. */
export function healed(state: RouteState, policy: PacePolicy, now: number): RouteState {
  return { ...state, spacingMs: Math.max(floorOf(state, policy, now), Math.round(state.spacingMs / 2)) };
}

/** After a truly idle lane the key starts over, but never below a remembered
 * limit: a limit is not forgotten by waiting. */
export function rested(state: RouteState, policy: PacePolicy, now: number): RouteState {
  return { ...state, lastStartAt: 0, spacingMs: floorOf(state, policy, now) };
}
