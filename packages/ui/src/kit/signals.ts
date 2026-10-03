// AppClient → @preact/signals (architecture.md §10.1 «Поток текста», §10.2
// п. 2). Signals live only inside ui/: AppClient and the ports stay plain
// callbacks; here each subscription becomes a signal a component reads with
// `.value`, so a streamed chunk re-renders only what reads it.

import { signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';

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
 * subscription follows the selector's key and ends with the component.
 */
export function useViewFrom<S extends ViewSelector>(client: AppClient, selector: S): ReadonlySignal<Readonly<ViewOf<S>>> {
  const key = viewKey(selector);
  // Keyed by the selector key, not its object identity: a fresh literal each render is the same view.
  const owned = useMemo(() => viewSignal(client, selector), [client, key]);
  useEffect(() => () => owned.dispose(), [owned]);
  return owned.signal;
}

/** A ValueSignal as a Preact signal for the component's lifetime. */
export function useValueSignal<T>(source: ValueSignal<T>): ReadonlySignal<T> {
  const owned = useMemo(() => fromValueSignal(source), [source]);
  useEffect(() => () => owned.dispose(), [owned]);
  return owned.signal;
}
