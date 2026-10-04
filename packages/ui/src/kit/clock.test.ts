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
    // 2 ч 1 мин 30 с shows «2 ч 1 мин» until the rounded-up seconds reach 2:00:59, 31 s later.
    expect(countdownDelay(now + 2 * HOUR + 90 * SECOND, now)).toBe(31 * SECOND);
    expect(countdownDelay(now + 2 * HOUR + 60 * SECOND, now)).toBe(SECOND);
    expect(countdownDelay(now + HOUR + 500, now)).toBe(1_500);
    expect(countdownDelay(now, now)).toBeNull();
    expect(countdownDelay(now - 1, now)).toBeNull();
  });

  it('woken as useRenderAfter wakes it, a countdown is never more than a second behind its text', () => {
    // What the countdown shows: hours and minutes from an hour up, minutes and seconds below, seconds under a minute.
    const text = (remaining: number): string => {
      const { hours, minutes, seconds } = countdownParts(remaining);
      if (hours > 0) return `${hours}h ${minutes}m`;
      return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    };
    for (const start of [2 * HOUR + 90 * SECOND + 300, HOUR + 5 * MINUTE + 30 * SECOND + 300, 17 * HOUR + 39 * MINUTE + 1, 25 * SECOND + 300]) {
      const until = start;
      const wakes: number[] = [];
      for (let now = 0; ; ) {
        const delay = countdownDelay(until, now);
        if (delay === null) break;
        // useRenderAfter: never sooner than 250 ms, 8 ms past the boundary.
        now += Math.max(SECOND / 4, delay) + 8;
        wakes.push(now);
      }
      // Every change of the text happens when the rounded-up seconds drop: at until − k·1000.
      let worst = 0;
      for (let k = Math.ceil(until / SECOND) - 1; k >= 0; k -= 1) {
        const at = until - k * SECOND;
        if (at <= 0 || text(until - at) === text(until - at + 1)) continue;
        const woke = wakes.find((wake) => wake >= at) ?? Number.POSITIVE_INFINITY;
        worst = Math.max(worst, woke - at);
      }
      expect(worst, `countdown of ${start} ms`).toBeLessThan(SECOND);
      // One wake per change of the text, give or take the last one: no idle ticking.
      expect(wakes.length).toBeLessThanOrEqual(Math.ceil(Math.min(until, HOUR) / SECOND) + Math.ceil(Math.max(0, until - HOUR) / MINUTE) + 2);
    }
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
