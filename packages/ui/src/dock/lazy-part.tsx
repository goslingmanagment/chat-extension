// Parts of the dock that stay out of its first chunk (architecture.md §10.1,
// §11: ≤ 45 KiB with Preact): Recap and Review with the Markdown renderer,
// the voice studio (1.47.0) and the debug footer nobody sees outside debug
// mode. Each is a component
// with its own stylesheet behind a loader (the defaults are in lazy.ts); this
// module is what both sides share — the part's shape and the hook that shows
// it once its chunk arrived.

import { type FunctionComponent, type JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { type ResultDebugVM } from '@cg/contracts/vm';

import { Boundary, retainKitStyles, useKit, type StyleSource } from '../kit';

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
  /** The loader of the debug footer; without it a Recap or a Review shows none. */
  readonly debugPart?: PartLoader<DebugProps>;
}

export interface DebugProps {
  readonly debug: ResultDebugVM;
  /** Epoch ms of the click, for the live timer. */
  readonly startedAt: number;
  readonly running: boolean;
}

/** 1.47.0: the voice studio in the sheet. */
export interface VoiceProps {
  /** «Скрыть» and Esc: the sheet's own (it gives the focus back to the composer). */
  readonly onHide: () => void;
}

export interface DockParts {
  readonly analysis: PartLoader<AnalysisProps>;
  readonly debug: PartLoader<DebugProps>;
  readonly voice: PartLoader<VoiceProps>;
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

function LazyDebug({ loader, ...props }: DebugProps & { readonly loader: PartLoader<DebugProps> }): JSX.Element | null {
  const part = useLazyPart(loader);
  if (part === null) return null;
  const View = part.view;
  return <View {...props} />;
}

/**
 * The debug footer in its place under a result, a Recap, a Review or a Coach
 * turn (ui-design §4.12): nothing while its chunk loads. It has a boundary of
 * its own: a chunk that fails to load shows «Сбой интерфейса» where the footer
 * would be and never takes away the text and the buttons above it.
 */
export function DebugSlot(props: DebugProps & { readonly loader: PartLoader<DebugProps> }): JSX.Element {
  return (
    <Boundary surface={null}>
      <LazyDebug {...props} />
    </Boundary>
  );
}
