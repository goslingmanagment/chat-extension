// Parts of the dock that stay out of its first chunk (architecture.md §10.1,
// §11: ≤ 45 KiB with Preact): Recap and Review with the Markdown renderer,
// and the debug footer nobody sees outside debug mode. Each is a component
// with its own stylesheet behind a loader (the defaults are in lazy.ts); this
// module is what both sides share — the part's shape and the hook that shows
// it once its chunk arrived.

import { type FunctionComponent } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { type ResultDebugVM } from '@cg/contracts/vm';

import { retainKitStyles, useKit, type StyleSource } from '../kit';

export interface LazyPart<P> {
  readonly view: FunctionComponent<P>;
  /** Adopted into the root while the part is on screen. */
  readonly styles?: readonly StyleSource[];
}

export type PartLoader<P> = () => Promise<LazyPart<P>>;

export interface AnalysisProps {
  readonly which: 'recap' | 'review';
  /** `dialog`: the «Развернуть ↗» window — no height limit, «Свернуть» instead of «Скрыть». */
  readonly place: 'sheet' | 'dialog';
}

export interface DebugProps {
  readonly debug: ResultDebugVM;
  /** Epoch ms of the click, for the live timer. */
  readonly startedAt: number;
  readonly running: boolean;
}

export interface DockParts {
  readonly analysis: PartLoader<AnalysisProps>;
  readonly debug: PartLoader<DebugProps>;
}

/** Loaded parts by their loader: a second mount shows the part at once. */
const loaded = new WeakMap<object, LazyPart<never>>();

/** Loads a part ahead of its first use (a warm chunk shows without the one-frame placeholder). */
export async function preloadPart<P>(loader: PartLoader<P>): Promise<LazyPart<P>> {
  const part = await loader();
  loaded.set(loader, part);
  return part;
}

/**
 * The part behind `loader`, or null while its chunk loads. A failed load is
 * thrown into the nearest Boundary («Сбой интерфейса», ER-020): a missing
 * chunk never takes the strip down with it.
 */
export function useLazyPart<P>(loader: PartLoader<P>): LazyPart<P> | null {
  const env = useKit();
  const [, repaint] = useState(0);
  const failure = useRef<Error | null>(null);
  const part = (loaded.get(loader) as LazyPart<P> | undefined) ?? null;
  useEffect(() => {
    if (part !== null) return undefined;
    let alive = true;
    preloadPart(loader).then(
      () => {
        if (alive) repaint((count) => count + 1);
      },
      (error: unknown) => {
        failure.current = error instanceof Error ? error : new Error('LazyPartFailed');
        if (alive) repaint((count) => count + 1);
      },
    );
    return () => {
      alive = false;
    };
  }, [loader, part]);
  useLayoutEffect(() => (part === null || part.styles === undefined ? undefined : retainKitStyles(env.root, part.styles).release), [part, env]);
  if (failure.current !== null) throw failure.current;
  return part;
}
