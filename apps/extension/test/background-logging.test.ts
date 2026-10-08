// The background's keeper of the day's counters (composition/background/
// logging.ts, LG-010) on in-memory storage areas: what a failing storage.local
// does to «Ошибки за сегодня». The whole path — a page's record, the export, a
// restart of the browser — is in wiring-lifecycle.test.ts.

import 'fake-indexeddb/auto';

import type { KeyValueStore } from '@cg/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOG_COUNTERS_KEY, createBackgroundLogging, type BackgroundLogging } from '../src/composition/background/logging.ts';
import { memoryStore, type MemoryStore } from './support/memory-store.ts';

const dayKey = (ms: number): string => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

let local: MemoryStore;
beforeEach(() => {
  local = memoryStore('local');
  for (const level of ['debug', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

/** The counters are written this long after a change (two seconds in the extension). */
const SAVE_MS = 10;
/** An instance of the event page's log over the browser's storage.local; storage.session is this instance's own. */
const instance = (store: KeyValueStore = local): BackgroundLogging =>
  createBackgroundLogging({ session: memoryStore('session'), local: store, debugEnabled: () => false, ctx: () => undefined, countersSaveDelayMs: SAVE_MS });
/** The save that follows a change has run (or was refused). */
const saved = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, SAVE_MS * 4));

describe('[LG-010] the day’s counters in storage.local', () => {
  it('written shortly after a change, read by the next instance, added to what it counted itself', async () => {
    const first = instance();
    await first.start();
    first.logger.error('bg.test', 'probe', { code: 'CG-NETWORK' });
    first.logger.error('bg.test', 'probe', { code: 'CG-NETWORK' });
    await saved();
    expect(local.data.get(LOG_COUNTERS_KEY)).toEqual({ v: 1, day: dayKey(Date.now()), today: { 'CG-NETWORK': 2 }, previousDay: null, previous: {} });
    expect(first.countersBytes()).toBe(JSON.stringify(local.data.get(LOG_COUNTERS_KEY)).length);

    const second = instance();
    // An error of the start itself, before the stored day is read.
    second.logger.error('bg.test', 'probe', { code: 'CG-NETWORK' });
    await second.start();
    expect(second.counters.todayCounts(Date.now())).toEqual([{ code: 'CG-NETWORK', count: 3 }]);
    expect(second.counters.sessionCounts()).toEqual([{ code: 'CG-NETWORK', count: 1 }]);
    await saved();
    expect(local.data.get(LOG_COUNTERS_KEY)).toMatchObject({ today: { 'CG-NETWORK': 3 } });
  });

  it('days that could not be read are never written over: this instance counts on its own, and the next one adds the kept day', async () => {
    local.data.set(LOG_COUNTERS_KEY, { v: 1, day: dayKey(Date.now()), today: { 'CG-HUB-TIMEOUT': 5 }, previousDay: null, previous: {} });
    const unreadable: KeyValueStore = { ...local, get: (keys) => (keys.includes(LOG_COUNTERS_KEY) ? Promise.resolve({ ok: false, code: 'CG-STORAGE-READ', detail: 'local.get failed (test)' }) : local.get(keys)) };
    const blind = instance(unreadable);
    await blind.start();
    blind.logger.error('bg.test', 'probe', { code: 'CG-HUB-TIMEOUT' });
    expect(blind.counters.todayCounts(Date.now())).toEqual([{ code: 'CG-HUB-TIMEOUT', count: 1 }]);
    await saved();
    expect(local.sets.flat()).not.toContain(LOG_COUNTERS_KEY);
    expect(local.data.get(LOG_COUNTERS_KEY)).toMatchObject({ today: { 'CG-HUB-TIMEOUT': 5 } });

    const next = instance();
    await next.start();
    expect(next.counters.todayCounts(Date.now())).toEqual([{ code: 'CG-HUB-TIMEOUT', count: 5 }]);
  });

  it('a write that fails loses nothing in memory and is made again with the next change; «Очистить» empties memory and disk', async () => {
    const logging = instance();
    await logging.start();
    logging.logger.error('bg.test', 'probe', { code: 'CG-NETWORK' });
    local.failNextSet();
    await saved();
    expect(local.data.has(LOG_COUNTERS_KEY)).toBe(false);
    logging.logger.error('bg.test', 'probe', { code: 'CG-NETWORK' });
    await saved();
    expect(local.data.get(LOG_COUNTERS_KEY)).toMatchObject({ today: { 'CG-NETWORK': 2 } });

    await logging.clearCounters();
    expect(local.data.get(LOG_COUNTERS_KEY)).toEqual({ v: 1, day: dayKey(Date.now()), today: {}, previousDay: null, previous: {} });
    expect(logging.counters.todayCounts(Date.now())).toEqual([]);
    expect(logging.counters.sessionCounts()).toEqual([{ code: 'CG-NETWORK', count: 2 }]);
  });
});
