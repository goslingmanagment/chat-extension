// Observing a query from a component (or a test-held observer): the entry is
// ACTIVE while at least one observer tracks it; a stale entry refetches when an
// observer arrives. This is what makes "a history load would happen" visible.
// Like Colada, every observer also listens to the window: when the tab becomes
// visible (refetchOnWindowFocus) or the network comes back (`online`,
// refetchOnReconnect), an active, enabled, stale query refreshes — the waves
// the extension must never cause (architecture.md §6.10).

import { computed, onScopeDispose, shallowRef, watch, type ComputedRef, type ShallowRef } from 'vue';

import { record } from '../journal';
import { keyHash, useQueryCache, type QueryEntry, type QueryKey, type QueryOptions, type RefetchTrigger } from './cache';

export interface QueryHandle<T> {
  readonly entry: ShallowRef<QueryEntry<T> | null>;
  readonly data: ComputedRef<T | undefined>;
  readonly loading: ComputedRef<boolean>;
  readonly settled: ComputedRef<boolean>;
}

export function useQuery<T>(options: () => QueryOptions<T> | null): QueryHandle<T> {
  const cache = useQueryCache();
  const observer = {};
  const entry = shallowRef<QueryEntry<T> | null>(null);
  watch(
    () => {
      const current = options();
      return current === null ? null : keyHash(current.key);
    },
    () => {
      if (entry.value !== null) cache.untrack(entry.value, observer);
      const current = options();
      if (current === null) {
        entry.value = null;
        return;
      }
      const next = cache.ensure(current);
      cache.track(next, observer);
      entry.value = next;
      if (current.enabled?.() ?? true) void cache.refresh(next);
    },
    { immediate: true },
  );
  const onWindowSignal = (cause: 'focus' | 'online', trigger: (options: QueryOptions<T>) => RefetchTrigger | undefined): void => {
    const current = entry.value;
    const options = current?.options ?? null;
    if (current === null || options === null || !current.active || !(options.enabled?.() ?? true)) return;
    const mode = trigger(options) ?? true;
    if (mode === false) return;
    record('query-window-refetch', { key: [...current.key], cause, mode });
    void (mode === 'always' ? cache.fetch(current) : cache.refresh(current));
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') onWindowSignal('focus', (options) => options.refetchOnWindowFocus);
  };
  const onOnline = (): void => onWindowSignal('online', (options) => options.refetchOnReconnect);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  onScopeDispose(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    if (entry.value !== null) cache.untrack(entry.value, observer);
  });
  return {
    entry,
    data: computed(() => entry.value?.state.value.data),
    loading: computed(() => entry.value?.asyncStatus.value === 'loading'),
    settled: computed(() => entry.value !== null && entry.value.state.value.status !== 'pending'),
  };
}

const held = new Map<number, { readonly key: QueryKey; readonly observer: object }>();
let heldSeq = 0;

/**
 * A test-held observer: makes the entry active until released. A missing entry
 * is created with the app's own query options for that key (so an
 * invalidation would really refetch it).
 */
export function holdObserver(key: QueryKey, options: QueryOptions<unknown> | null): number {
  const cache = useQueryCache();
  const entry = cache.get(key) ?? cache.ensure(options ?? { key, query: () => Promise.resolve(undefined) });
  heldSeq += 1;
  const observer = {};
  cache.track(entry, observer);
  held.set(heldSeq, { key, observer });
  return heldSeq;
}

export function releaseObserver(token: number): void {
  const hold = held.get(token);
  if (hold === undefined) return;
  held.delete(token);
  const cache = useQueryCache();
  const entry = cache.get(hold.key);
  if (entry !== undefined) cache.untrack(entry, hold.observer);
}
