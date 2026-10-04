// The tab's own storage port (tab/runtime.ts): the drafts key, and nothing
// else of the extension's storage.

import type { BrowserApi } from '@cg/platform';
import { describe, expect, it, vi } from 'vitest';

import { DRAFTS_REREAD_MIN_MS, NEWCOMER_DRAFTS_KEY, draftStoreOf } from './runtime';

function world() {
  const data = new Map<string, unknown>([
    [NEWCOMER_DRAFTS_KEY, { v: 1, drafts: [] }],
    ['auth.token', { v: 1, token: 'synthetic-token' }],
  ]);
  const gets: unknown[] = [];
  const storageListeners: unknown[] = [];
  const api = {
    storage: {
      local: {
        get: (keys: unknown) => {
          gets.push(keys);
          return Promise.resolve(typeof keys === 'string' ? { [keys]: data.get(keys) } : Object.fromEntries(data));
        },
        set: (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) data.set(key, value);
          return Promise.resolve();
        },
      },
      onChanged: { addListener: (listener: unknown) => void storageListeners.push(listener), removeListener: () => undefined },
    },
  } as unknown as BrowserApi;
  const listeners = new Map<string, Set<() => void>>();
  const on = (type: string, listener: () => void): void => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type))?.add(listener);
  const off = (type: string, listener: () => void): void => void listeners.get(type)?.delete(listener);
  const doc = { visibilityState: 'visible', addEventListener: on, removeEventListener: off };
  const win = { document: doc, addEventListener: on, removeEventListener: off } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener' | 'document'>;
  const fire = (type: string): void => {
    for (const listener of [...(listeners.get(type) ?? [])]) listener();
  };
  return { api, win, doc, data, gets, storageListeners, fire, listening: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0) };
}

describe('the drafts of previews in a ChatSpace tab (§14: the tab hears nothing of the extension’s storage)', () => {
  it('reads and writes its one key by name, and registers no storage listener: no change of the area — the sign-in record least of all — is ever delivered into the tab', async () => {
    const w = world();
    const store = draftStoreOf(w.api, w.win);
    expect(await store.load()).toEqual({ v: 1, drafts: [] });
    await store.save({ v: 1, drafts: [{ key: 'k' }] });
    expect(w.data.get(NEWCOMER_DRAFTS_KEY)).toEqual({ v: 1, drafts: [{ key: 'k' }] });
    const off = store.onChanged(() => undefined);
    expect(w.storageListeners).toEqual([]);
    // Every read named the drafts key and nothing else.
    expect(w.gets.every((keys) => keys === NEWCOMER_DRAFTS_KEY)).toBe(true);
    off();
  });

  it('[NF-012] what another tab wrote is read when this tab is looked at again — back on screen or in focus — and not more often than every two seconds; a hidden tab reads nothing', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    try {
      const w = world();
      const heard: unknown[] = [];
      const off = draftStoreOf(w.api, w.win).onChanged((value) => heard.push(value));
      expect(heard).toEqual([]);
      // Another tab writes a draft.
      w.data.set(NEWCOMER_DRAFTS_KEY, { v: 1, drafts: [{ key: 'from-another-tab' }] });
      w.doc.visibilityState = 'hidden';
      w.fire('visibilitychange');
      await vi.advanceTimersByTimeAsync(0);
      expect(heard).toEqual([]);
      w.doc.visibilityState = 'visible';
      w.fire('visibilitychange');
      w.fire('focus');
      await vi.advanceTimersByTimeAsync(0);
      // One read for the two events of one return to the tab.
      expect(heard).toEqual([{ v: 1, drafts: [{ key: 'from-another-tab' }] }]);
      await vi.advanceTimersByTimeAsync(DRAFTS_REREAD_MIN_MS);
      w.fire('focus');
      await vi.advanceTimersByTimeAsync(0);
      expect(heard).toHaveLength(2);
      off();
      expect(w.listening()).toBe(0);
      w.fire('focus');
      await vi.advanceTimersByTimeAsync(DRAFTS_REREAD_MIN_MS);
      expect(heard).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
