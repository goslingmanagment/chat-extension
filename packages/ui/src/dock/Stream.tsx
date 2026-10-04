// Streamed text (architecture.md §10.1 «Поток текста», §11; AI-137): the
// controller batches chunks every 50 ms into the view model's `streamText`.
// Here a batch changes ONE text node, inside requestAnimationFrame, and
// nothing else: the tree reads a view model that stays the same object while
// only the streamed text differs (`useSteadyView`), and the text itself goes
// through a signal straight into the node. The stream is never announced
// piece by piece (ui-design §6.2).

import { computed, effect, type ReadonlySignal } from '@preact/signals';
import { type JSX } from 'preact';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';

import { useKit, windowOf } from '../kit';
import { STREAM_KEY, deepEqual } from './model';

/**
 * The view model without the noise of streaming: while two models differ only
 * in `streamText` (at any depth) the signal keeps the earlier object, so
 * nothing that reads it re-renders. Whoever shows the text reads the raw
 * signal through `StreamText`.
 */
export function useSteadyView<T>(view: ReadonlySignal<T>): ReadonlySignal<T> {
  return useMemo(() => {
    let last: { readonly value: T } | null = null;
    return computed(() => {
      const next = view.value;
      if (last !== null && deepEqual(last.value, next, STREAM_KEY)) return last.value;
      last = { value: next };
      return next;
    });
  }, [view]);
}

export interface StreamTextProps {
  /** The streamed text of the raw view model; '' before the first chunk. */
  readonly text: ReadonlySignal<string>;
  /** Called once, after the frame that painted the first non-empty text. */
  readonly onFirstPaint?: () => void;
}

/** The preliminary text of a running generation: one text node, repainted once per frame at most. */
export function StreamText({ text, onFirstPaint }: StreamTextProps): JSX.Element {
  const env = useKit();
  const host = useRef<HTMLSpanElement>(null);
  const firstPaint = useRef(onFirstPaint);
  firstPaint.current = onFirstPaint;
  useLayoutEffect(() => {
    const element = host.current;
    if (element === null) return undefined;
    const view = windowOf(env.root);
    const node = element.ownerDocument.createTextNode(text.peek());
    element.append(node);
    let frame: number | null = null;
    let marked = false;
    const paint = (): void => {
      frame = null;
      const next = text.peek();
      if (node.data !== next) node.data = next;
      if (!marked && next !== '') {
        marked = true;
        firstPaint.current?.();
      }
    };
    const stop = effect(() => {
      // Read to subscribe; the node is written in the frame, with whatever the text is by then.
      if (text.value === node.data && (marked || text.value === '')) return;
      if (frame !== null) return;
      frame = view === null ? null : view.requestAnimationFrame(paint);
      if (frame === null) paint();
    });
    return () => {
      stop();
      if (frame !== null) view?.cancelAnimationFrame(frame);
      node.remove();
    };
  }, [text, env]);
  return <span ref={host} class="cg-stream__t" data-cg-stream="" />;
}

/** The streamed text of a view as a signal of its own. */
export function useStreamText<T>(view: ReadonlySignal<T>, pick: (value: T) => string | null): ReadonlySignal<string> {
  const picker = useRef(pick);
  picker.current = pick;
  return useMemo(() => computed(() => picker.current(view.value) ?? ''), [view]);
}
