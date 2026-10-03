import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HOUR, MINUTE, SECOND, countdownDelay, countdownParts, elapsedDelay, minuteListenerCount, onMinute } from './clock';

describe('[EX-011] time in the UI without idle timers (architecture.md §11 «простой»)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 3, 6, 20, 30));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('one shared minute ticker exists only while someone listens', () => {
    expect(minuteListenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const a = vi.fn();
    const b = vi.fn();
    const offA = onMinute(a);
    const offB = onMinute(b);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(30 * SECOND + 10);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(MINUTE);
    expect(a).toHaveBeenCalledTimes(2);
    offA();
    offB();
    expect(minuteListenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a countdown wakes once per change of its text: seconds under an hour, minutes above', () => {
    const now = 1_000_000;
    expect(countdownDelay(now + 24 * SECOND + 300, now)).toBe(300);
    expect(countdownDelay(now + 24 * SECOND, now)).toBe(SECOND);
    expect(countdownDelay(now + 2 * HOUR + 90 * SECOND, now)).toBe(30 * SECOND);
    expect(countdownDelay(now, now)).toBeNull();
    expect(countdownDelay(now - 1, now)).toBeNull();
  });

  it('an elapsed timer wakes at the next whole second, never faster than 1 Hz', () => {
    expect(elapsedDelay(0, 2_400)).toBe(600);
    expect(elapsedDelay(0, 3_000)).toBe(SECOND);
    expect(elapsedDelay(5_000, 1_000)).toBe(SECOND);
  });

  it('splits a countdown into hours, minutes and seconds, rounding up', () => {
    expect(countdownParts(17 * HOUR + 39 * MINUTE + 1)).toEqual({ hours: 17, minutes: 39, seconds: 1 });
    expect(countdownParts(39 * MINUTE + 12 * SECOND)).toEqual({ hours: 0, minutes: 39, seconds: 12 });
    expect(countdownParts(-5)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });
});
