// The fixture's query cache without a browser (happy-dom): what an adapter
// watching `_pc_query.$onAction` sees, and the window-driven refetches.

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectScope, type EffectScope } from 'vue';

import { useQueryCache, type QueryOptions } from '../../fixture-chatspace/src/query/cache';
import { useQuery } from '../../fixture-chatspace/src/query/use-query';

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let calls: Record<string, number> = {};
const options = (key: readonly string[], extra: Partial<QueryOptions<string>> = {}): QueryOptions<string> => ({
  key,
  staleTime: 0,
  query: () => {
    const name = key.join('/');
    calls[name] = (calls[name] ?? 0) + 1;
    return Promise.resolve(`data of ${name}`);
  },
  ...extra,
});

let scope: EffectScope;

beforeEach(() => {
  setActivePinia(createPinia());
  calls = {};
  scope = effectScope();
});

afterEach(() => {
  scope.stop();
});

describe('fixture query cache and $onAction', () => {
  it('a history load is visible as setEntryState on its key, with the internal calls around it', async () => {
    const cache = useQueryCache();
    const seen: Array<{ name: string; key?: readonly string[] }> = [];
    cache.$onAction(({ name, args }) => {
      const first = args[0] as { key?: readonly string[] } | undefined;
      seen.push({ name, ...(first?.key !== undefined ? { key: first.key } : {}) });
    });
    const history = ['chatMessages', '910101', '74001001'];
    const entry = cache.ensure(options(history));
    await cache.refresh(entry);
    expect(seen.map((item) => item.name)).toEqual(['ensure', 'create', 'refresh', 'fetch', 'setEntryState']);
    expect(seen.at(-1)).toEqual({ name: 'setEntryState', key: history });
  });

  it('invalidateQueries reports invalidate and cancel per entry; setQueryData reports setEntryState', async () => {
    const cache = useQueryCache();
    cache.setQueryData(['chatList', '910101', 'all'], { pages: [] });
    const names: string[] = [];
    cache.$onAction(({ name }) => {
      names.push(name);
    });
    await cache.invalidateQueries({ key: ['chatList'] });
    cache.setQueryData(['fansMap', '910101'], {});
    expect(names).toEqual(['invalidateQueries', 'getEntries', 'invalidate', 'cancel', 'setQueryData', 'create', 'setEntryState']);
  });
});

describe('fixture queries and the window', () => {
  it('becoming visible refreshes an active stale list, not a query that opted out (the history); `online` refreshes both', async () => {
    scope.run(() => {
      useQuery(() => options(['chatList', '910101', 'all']));
      useQuery(() => options(['chatMessages', '910101', '74001001'], { refetchOnWindowFocus: false }));
    });
    await tick();
    expect(calls).toEqual({ 'chatList/910101/all': 1, 'chatMessages/910101/74001001': 1 });
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(calls).toEqual({ 'chatList/910101/all': 2, 'chatMessages/910101/74001001': 1 });
    window.dispatchEvent(new Event('online'));
    await tick();
    expect(calls).toEqual({ 'chatList/910101/all': 3, 'chatMessages/910101/74001001': 2 });
  });

  it('an observer that went away no longer listens', async () => {
    scope.run(() => useQuery(() => options(['chatList', '910101', 'all'])));
    await tick();
    scope.stop();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    await tick();
    expect(calls).toEqual({ 'chatList/910101/all': 1 });
  });
});
