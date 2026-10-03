// The query cache store `_pc_query`, shaped like Pinia Colada's (metadata.ts
// «query-cache»): entries keyed by array keys with observers (`deps`), an
// `active` getter (observed by someone), `stale`, async status; the public
// actions the extension reads or watches — getQueryData, setQueryData,
// invalidateQueries (refetches ACTIVE entries only), getEntries. Like Colada,
// the store is built with Pinia's `action` helper, so `$onAction` also sees the
// store's INTERNAL calls: every finished fetch reports `setEntryState`, an
// invalidation reports `invalidate` and `cancel`, a new entry `create` and
// `ensure`, and so on — a history load is visible as `setEntryState` on its key.

import { defineStore } from 'pinia';
import { shallowRef, triggerRef, type ShallowRef } from 'vue';

import { storeId } from '../env';
import { record } from '../journal';

export type QueryKey = readonly string[];
export type QueryStatus = 'pending' | 'success' | 'error';
export type RefetchTrigger = boolean | 'always';

export interface QueryOptions<T> {
  readonly key: QueryKey;
  readonly query: (context: { readonly signal: AbortSignal }) => Promise<T>;
  /** ms; ChatSpace's chat history uses 60 s. */
  readonly staleTime?: number;
  /** ms an unobserved entry stays cached; ChatSpace's history uses 10 min. */
  readonly gcTime?: number;
  readonly enabled?: () => boolean;
  /** Colada's default is true (refresh a stale active query when the tab becomes visible); the history turns it off. */
  readonly refetchOnWindowFocus?: RefetchTrigger;
  /** Colada's default is true (refresh a stale active query on the window `online` event). */
  readonly refetchOnReconnect?: RefetchTrigger;
}

export interface QueryEntry<T = unknown> {
  readonly key: QueryKey;
  readonly keyHash: string;
  readonly state: ShallowRef<{ readonly data: T | undefined; readonly error: unknown; readonly status: QueryStatus }>;
  readonly asyncStatus: ShallowRef<'idle' | 'loading'>;
  when: number;
  readonly deps: Set<object>;
  options: QueryOptions<T> | null;
  pending: { readonly abortController: AbortController; readonly refreshCall: Promise<unknown> } | null;
  gcTimeout: ReturnType<typeof setTimeout> | undefined;
  readonly stale: boolean;
  readonly active: boolean;
}

export interface EntryFilters {
  readonly key?: QueryKey;
  readonly exact?: boolean;
  readonly active?: boolean;
  readonly stale?: boolean;
  readonly status?: QueryStatus;
  readonly predicate?: (entry: QueryEntry) => boolean;
}

type EntryState = QueryEntry['state']['value'];

const DEFAULT_STALE_MS = 5_000;
const DEFAULT_GC_MS = 300_000;

export const keyHash = (key: QueryKey): string => JSON.stringify(key);
const isPrefix = (prefix: QueryKey, key: QueryKey): boolean => prefix.length <= key.length && prefix.every((part, index) => key[index] === part);

export const useQueryCache = defineStore(storeId('_pc_query'), ({ action }) => {
  const caches = shallowRef(new Map<string, QueryEntry>());
  const changed = (): void => triggerRef(caches);

  const create = action(<T>(key: QueryKey, options: QueryOptions<T> | null = null, data: T | undefined = undefined): QueryEntry<T> => ({
    key: [...key],
    keyHash: keyHash(key),
    state: shallowRef({ data, error: null, status: data === undefined ? 'pending' : 'success' }),
    asyncStatus: shallowRef('idle'),
    when: data === undefined ? 0 : Date.now(),
    deps: new Set(),
    options,
    pending: null,
    gcTimeout: undefined,
    get stale() {
      return this.options === null || this.when === 0 || Date.now() >= this.when + (this.options.staleTime ?? DEFAULT_STALE_MS);
    },
    get active() {
      return this.deps.size > 0;
    },
  }));

  const remove = action((entry: QueryEntry): void => {
    clearTimeout(entry.gcTimeout);
    caches.value.delete(entry.keyHash);
    changed();
  });

  /** Nobody observes it: an unfinished first load is dropped, the entry is collected after gcTime. */
  function scheduleGc(entry: QueryEntry): void {
    if (entry.deps.size > 0 || entry.options === null) return;
    clearTimeout(entry.gcTimeout);
    if (entry.state.value.status === 'pending') entry.pending?.abortController.abort();
    entry.gcTimeout = setTimeout(() => remove(entry), entry.options.gcTime ?? DEFAULT_GC_MS);
  }

  const setEntryState = action((entry: QueryEntry, state: EntryState): void => {
    entry.state.value = state;
    entry.when = Date.now();
    scheduleGc(entry);
  });

  const getEntries = action((filters: EntryFilters = {}): QueryEntry[] => {
    const all = [...caches.value.values()];
    const byKey =
      filters.exact === true
        ? filters.key === undefined
          ? []
          : all.filter((entry) => entry.keyHash === keyHash(filters.key ?? []))
        : all.filter((entry) => filters.key === undefined || isPrefix(filters.key, entry.key));
    return byKey.filter(
      (entry) =>
        (filters.stale === undefined || entry.stale === filters.stale) &&
        (filters.active === undefined || entry.active === filters.active) &&
        (filters.status === undefined || entry.state.value.status === filters.status) &&
        (filters.predicate === undefined || filters.predicate(entry)),
    );
  });

  function get(key: QueryKey): QueryEntry | undefined {
    return caches.value.get(keyHash(key));
  }

  const ensure = action(<T>(options: QueryOptions<T>): QueryEntry<T> => {
    let entry = caches.value.get(keyHash(options.key)) as QueryEntry<T> | undefined;
    if (entry === undefined) {
      entry = create<T>(options.key, options);
      caches.value.set(entry.keyHash, entry);
      changed();
    }
    entry.options = options;
    return entry;
  });

  const cancel = action((entry: QueryEntry): void => {
    entry.pending?.abortController.abort();
    entry.pending = null;
    entry.asyncStatus.value = 'idle';
  });

  const cancelQueries = action((filters: EntryFilters = {}): void => {
    for (const entry of getEntries(filters)) cancel(entry);
  });

  const fetch = action(async (entry: QueryEntry): Promise<unknown> => {
    const options = entry.options;
    if (options === null) return entry.state.value.data;
    entry.pending?.abortController.abort();
    const abortController = new AbortController();
    entry.asyncStatus.value = 'loading';
    record('query-fetch', { key: [...entry.key], observers: entry.deps.size });
    const pending = {
      abortController,
      refreshCall: options
        .query({ signal: abortController.signal })
        .then((data) => {
          if (entry.pending === pending) setEntryState(entry, { data, error: null, status: 'success' });
          return data;
        })
        .catch((error: unknown) => {
          if (entry.pending === pending && !abortController.signal.aborted) {
            setEntryState(entry, { data: entry.state.value.data, error, status: 'error' });
          }
          return entry.state.value.data;
        })
        .finally(() => {
          if (entry.pending === pending) {
            entry.pending = null;
            entry.asyncStatus.value = 'idle';
          }
        }),
    };
    entry.pending = pending;
    return pending.refreshCall;
  });

  const refresh = action((entry: QueryEntry): Promise<unknown> => {
    if (entry.state.value.error !== null || entry.stale) return entry.pending?.refreshCall ?? fetch(entry);
    return Promise.resolve(entry.state.value.data);
  });

  /** Stale now: the pending call is cancelled; nothing is fetched here. */
  const invalidate = action((entry: QueryEntry): void => {
    entry.when = 0;
    cancel(entry);
  });

  /** Marks matching entries stale; refetches the ACTIVE ones (all with 'all'); inactive ones only go stale. */
  const invalidateQueries = action((filters: EntryFilters = {}, refetchActive: boolean | 'all' = true): Promise<unknown[]> => {
    const work = getEntries(filters).map((entry) => {
      invalidate(entry);
      const enabled = entry.options?.enabled?.() ?? true;
      const refetch = (refetchActive === 'all' || (entry.active && refetchActive)) && enabled && entry.options !== null;
      record('query-invalidate', { key: [...entry.key], active: entry.active, refetch });
      return refetch ? fetch(entry) : Promise.resolve(entry.state.value.data);
    });
    return Promise.all(work);
  });

  const setQueryData = action(<T>(key: QueryKey, value: T | ((previous: T | undefined) => T)): void => {
    let entry = caches.value.get(keyHash(key)) as QueryEntry<T> | undefined;
    if (entry === undefined) {
      entry = create<T>(key);
      caches.value.set(entry.keyHash, entry);
    }
    const next = typeof value === 'function' ? (value as (previous: T | undefined) => T)(entry.state.value.data) : value;
    setEntryState(entry, { data: next, error: null, status: 'success' });
    changed();
  });

  function setQueriesData<T>(filters: EntryFilters, updater: (previous: T | undefined) => T): void {
    for (const entry of getEntries(filters)) setEntryState(entry, { data: updater(entry.state.value.data as T | undefined), error: null, status: 'success' });
    changed();
  }

  function getQueryData<T = unknown>(key: QueryKey): T | undefined {
    return caches.value.get(keyHash(key))?.state.value.data as T | undefined;
  }

  function track(entry: QueryEntry, observer: object): void {
    entry.deps.add(observer);
    clearTimeout(entry.gcTimeout);
    entry.gcTimeout = undefined;
    changed();
  }

  function untrack(entry: QueryEntry, observer: object): void {
    if (!entry.deps.delete(observer)) return;
    changed();
    scheduleGc(entry);
  }

  return {
    caches,
    create,
    getEntries,
    get,
    ensure,
    fetch,
    refresh,
    invalidate,
    cancel,
    cancelQueries,
    invalidateQueries,
    setQueryData,
    setQueriesData,
    getQueryData,
    setEntryState,
    track,
    untrack,
    remove,
  };
});

export type QueryCache = ReturnType<typeof useQueryCache>;
