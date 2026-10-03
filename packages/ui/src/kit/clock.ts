// Time in the UI without idle timers (architecture.md §10.1, §11 «простой»):
// a component that shows a live value schedules ONE timer for the moment its
// text changes — the next second of a countdown, the next minute of an age —
// and nothing when nothing is shown or the countdown is over. Nothing here
// ticks faster than once a second; ages share one minute ticker.

import { useEffect, useState } from 'preact/hooks';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
/** Past the boundary, so the re-render reads the new value. */
const NUDGE_MS = 8;

/** Re-renders once after `delay` ms; every render reschedules (null: no timer). */
export function useRenderAfter(delay: number | null): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (delay === null) return undefined;
    const id = setTimeout(() => setTick((tick) => tick + 1), Math.max(SECOND / 4, delay) + NUDGE_MS);
    return () => clearTimeout(id);
  });
}

/**
 * Until the text of a countdown to `until` changes: whole seconds under an
 * hour (counted up: «через 24 с» never shows 0 while time is left), whole
 * minutes above (ui-design §4.8: «17 ч 39 мин» once a minute, «39 мин 12 с»
 * once a second). null when the deadline passed.
 */
export function countdownDelay(until: number, now: number): number | null {
  const remaining = until - now;
  if (remaining <= 0) return null;
  const step = remaining > HOUR ? MINUTE : SECOND;
  return ((remaining - 1) % step) + 1;
}

/** Until the m:ss of a timer started at `since` changes. */
export function elapsedDelay(since: number, now: number): number {
  const elapsed = Math.max(0, now - since);
  return SECOND - (elapsed % SECOND);
}

/** The remaining ms of a countdown, re-rendering when its text changes; 0 once over. */
export function useCountdown(until: number | null, now: () => number): number {
  const current = now();
  useRenderAfter(until === null ? null : countdownDelay(until, current));
  return until === null ? 0 : Math.max(0, until - current);
}

/** Elapsed ms since `since`, re-rendering each second while `running`. */
export function useElapsed(since: number, now: () => number, running = true): number {
  const current = now();
  useRenderAfter(running ? elapsedDelay(since, current) : null);
  return Math.max(0, current - since);
}

// ── one shared minute ticker for ages («7 мин», «3 ч») ──

const minuteListeners = new Set<() => void>();
let minuteTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleMinute(): void {
  const delay = MINUTE - (Date.now() % MINUTE) + NUDGE_MS;
  minuteTimer = setTimeout(() => {
    minuteTimer = null;
    for (const listener of [...minuteListeners]) listener();
    if (minuteListeners.size > 0) scheduleMinute();
  }, delay);
}

/** Subscribes to the wall-clock minute; the timer exists only while someone listens. */
export function onMinute(listener: () => void): () => void {
  minuteListeners.add(listener);
  if (minuteTimer === null) scheduleMinute();
  return () => {
    minuteListeners.delete(listener);
    if (minuteListeners.size === 0 && minuteTimer !== null) {
      clearTimeout(minuteTimer);
      minuteTimer = null;
    }
  };
}

/** Number of live minute listeners (tests: no idle timer survives an unmount). */
export function minuteListenerCount(): number {
  return minuteListeners.size;
}

/** Re-renders on every wall-clock minute while mounted. */
export function useMinuteClock(enabled = true): void {
  const [, setTick] = useState(0);
  useEffect(() => (enabled ? onMinute(() => setTick((tick) => tick + 1)) : undefined), [enabled]);
}

/** «17 ч 39 мин», «39 мин 12 с», «12 с» from parts; the words come from the caller's catalog. */
export function countdownParts(ms: number): { readonly hours: number; readonly minutes: number; readonly seconds: number } {
  const total = Math.max(0, Math.ceil(ms / SECOND));
  return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}
