// The e2e probe of a TEST build (tab/probe.ts): the report attribute, and the one hook that changes timing —
// a write held between our check of the chat and MAIN's, for as long as the stand page asked.
// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HOLD_WRITE_ATTRIBUTE, createTabProbe, tabProbeFor } from './probe';

const reportOf = (): Record<string, unknown> => JSON.parse(document.documentElement.getAttribute('data-cg-spike') ?? '{}') as Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.removeAttribute(HOLD_WRITE_ATTRIBUTE);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the probe of a TEST build', () => {
  it('exists on the loopback stand only: on ChatSpace a test build writes nothing the page can read', () => {
    const at = (hostname: string): Window => ({ location: { hostname }, document } as unknown as Window);
    expect(tabProbeFor(at('127.0.0.1'))).not.toBeNull();
    expect(tabProbeFor(at('localhost'))).not.toBeNull();
    expect(tabProbeFor(at('chat.example.test'))).toBeNull();
  });

  it('a write is counted and goes on at once when the page asked for nothing', async () => {
    const probe = createTabProbe(window);
    let done = false;
    void probe.holdWrite().then(() => (done = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
    expect(reportOf()['writesReached']).toBe(1);
  });

  it('a write is held for the time the stand page asked — never longer than two seconds, never for a value that is not a time', async () => {
    const probe = createTabProbe(window);
    document.documentElement.setAttribute(HOLD_WRITE_ATTRIBUTE, '150');
    let done = false;
    void probe.holdWrite().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(149);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);

    document.documentElement.setAttribute(HOLD_WRITE_ATTRIBUTE, '600000');
    done = false;
    void probe.holdWrite().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(2000);
    expect(done).toBe(true);

    document.documentElement.setAttribute(HOLD_WRITE_ATTRIBUTE, 'soon');
    done = false;
    void probe.holdWrite().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(reportOf()['writesReached']).toBe(3);
  });
});
