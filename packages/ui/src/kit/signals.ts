// AppClient → @preact/signals (architecture.md §10.1 «Поток текста», §10.2
// п. 2). Signals live only inside ui/: AppClient and the ports stay plain
// callbacks; here each subscription becomes a signal a component reads with
// `.value`, so a streamed chunk re-renders only what reads it.

import { signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';

import { type AppClient, type ValueSignal, type ViewOf, type ViewSelector } from '@cg/contracts/vm';

/**
 * The same string per selector as the contract's `selectorKey` (pinned by a
 * test over every selector). Kept here because the contract's module builds
 * zod schemas at load, and zod has no place in the first dock chunk (§11).
 */
export function viewKey(selector: ViewSelector): string {
  if (selector.of === 'preview') return `preview:${selector.from}`;
  if (selector.of === 'options') return `options:${selector.section}`;
  if (selector.of === 'debug-prompt') return `debug-prompt:${selector.token}`;
  if (selector.of === 'journal') return `journal:${selector.journal}`;
  return selector.of;
}

export interface OwnedReadonlySignal<T> {
  readonly signal: ReadonlySignal<T>;
  dispose(): void;
}

/** A signal of one view: the snapshot now, every update after; dispose unsubscribes. */
export function viewSignal<S extends ViewSelector>(client: AppClient, selector: S): OwnedReadonlySignal<Readonly<ViewOf<S>>> {
  const view: Signal<Readonly<ViewOf<S>>> = signal(client.getSnapshot(selector));
  const off = client.subscribe(selector, (next) => {
    view.value = next;
  });
  return { signal: view, dispose: off };
}

/** A port's ValueSignal (scheme, geometry) as a Preact signal. */
export function fromValueSignal<T>(source: ValueSignal<T>): OwnedReadonlySignal<T> {
  const value: Signal<T> = signal(source.value);
  const off = source.subscribe((next) => {
    value.value = next;
  });
  return { signal: value, dispose: off };
}

/**
 * The hook of §10.2: `useView(selector)` → a signal of that view model. The
 * signal starts from the snapshot during render; the subscription is taken
 * only once the component has committed (a render that throws, caught by a
 * Boundary, leaves none behind) and ends with it. It follows the selector's
 * key, not the identity of the selector object.
 */
export function useViewFrom<S extends ViewSelector>(client: AppClient, selector: S): ReadonlySignal<Readonly<ViewOf<S>>> {
  const key = viewKey(selector);
  const latest = useRef(selector);
  latest.current = selector;
  const view = useMemo((): Signal<Readonly<ViewOf<S>>> => signal(client.getSnapshot(selector)), [client, key]);
  useLayoutEffect(() => {
    // Whatever changed between the render and this commit.
    const now = client.getSnapshot(latest.current);
    if (!Object.is(now, view.peek())) view.value = now;
    return client.subscribe(latest.current, (next) => {
      view.value = next;
    });
  }, [client, view]);
  return view;
}

/** A ValueSignal as a Preact signal for the component's lifetime; subscribed on commit, as useViewFrom. */
export function useValueSignal<T>(source: ValueSignal<T>): ReadonlySignal<T> {
  const value = useMemo((): Signal<T> => signal(source.value), [source]);
  useLayoutEffect(() => {
    if (!Object.is(source.value, value.peek())) value.value = source.value;
    return source.subscribe((next) => {
      value.value = next;
    });
  }, [source, value]);
  return value;
}
