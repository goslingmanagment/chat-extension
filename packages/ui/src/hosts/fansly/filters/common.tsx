// What both strips of the filters above Fansly's chats share (2026-11-13; contracts fansly-filters.ts): the icons, the
// controller's view as state, the strip's own width and the measure of a text in its own font.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import type { FanslyFiltersClient, FanslyFiltersView, FanslyTextMeasure } from '@cg/contracts/fansly-filters';

type IconName = 'star' | 'trash' | 'pencil' | 'refresh' | 'dots' | 'check' | 'chev' | 'search' | 'users' | 'list';

const PATHS: Readonly<Record<IconName, JSX.Element>> = {
  star: <path fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="m12 3.3 2.64 5.6 6.1.8-4.46 4.24 1.13 6.06L12 17.05 6.59 20l1.13-6.06L3.26 9.7l6.1-.8Z" />,
  trash: <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M3.5 6h17M9 6V4.4c0-.8.6-1.4 1.4-1.4h3.2c.8 0 1.4.6 1.4 1.4V6M5.5 6l.9 13.2c.1 1 .9 1.8 1.9 1.8h7.4c1 0 1.8-.8 1.9-1.8L18.5 6M9.4 10v7.5M12 10v7.5M14.6 10v7.5" />,
  pencil: <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="m3.5 20.5 1.3-5L16.4 3.9a2 2 0 0 1 2.8 0l.9.9a2 2 0 0 1 0 2.8L8.5 19.2l-5 1.3ZM14.4 6l3.6 3.6" />,
  refresh: <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M20.3 4v5.2h-5.2M19.8 9.2A8.3 8.3 0 0 0 4 10.3M3.7 20v-5.2h5.2M4.2 14.8A8.3 8.3 0 0 0 20 13.7" />,
  dots: (
    <g fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </g>
  ),
  check: <path fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.5 4.8 4.8L19.5 7" />,
  chev: <path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m5 9 7 7 7-7" />,
  search: (
    <g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
      <circle cx="10.5" cy="10.5" r="6.8" />
      <path d="M15.6 15.6 21 21" />
    </g>
  ),
  users: <path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M10 3.9a3.9 3.9 0 1 1 0 7.8 3.9 3.9 0 0 1 0-7.8ZM3.2 20c0-3.9 3-6.5 6.8-6.5 1.4 0 2.7.4 3.7 1M14.8 17.6l2.2 2.2 4.3-4.6" />,
  list: (
    <g>
      <path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M9 6.5h11M9 12h11M9 17.5h11" />
      <circle cx="4.6" cy="6.5" r="1.2" fill="currentColor" />
      <circle cx="4.6" cy="12" r="1.2" fill="currentColor" />
      <circle cx="4.6" cy="17.5" r="1.2" fill="currentColor" />
    </g>
  ),
};

export function Icon({ name, size, color }: { readonly name: IconName; readonly size: number; readonly color?: string | null }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" style={color === null || color === undefined ? undefined : `color:${color}`}>
      {PATHS[name]}
    </svg>
  );
}

/** The controller's view as state, from its first value. */
export function useFiltersView(client: FanslyFiltersClient): FanslyFiltersView {
  const [view, setView] = useState(() => client.view());
  useEffect(() => {
    setView(client.view());
    return client.subscribe(setView);
  }, [client]);
  return view;
}

/** The content width of an element of ours, watched; 0 until the first measure. */
export function useWidth<T extends HTMLElement>(): { readonly ref: { current: T | null }; readonly width: number } {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    const View = node?.ownerDocument.defaultView;
    if (node === null || View === null || View === undefined || typeof View.ResizeObserver !== 'function') return undefined;
    setWidth(node.clientWidth);
    const observer = new View.ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry !== undefined) setWidth(Math.round(entry.contentRect.width * 10) / 10);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * The width of a text in the strip's own font, measured on a hidden line inside the strip and kept by its text (shelves
 * spec §3); an emoji at its own 12 px.
 */
export function useMeasure(): { readonly ref: { current: HTMLDivElement | null }; readonly measure: FanslyTextMeasure } {
  const ref = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, number>());
  const measure = useRef<FanslyTextMeasure>((text, kind) => {
    const key = `${kind}|${text}`;
    const known = cache.current.get(key);
    if (known !== undefined) return known;
    const line = ref.current;
    if (line === null) return text.length * 7;
    const span = line.ownerDocument.createElement('span');
    if (kind === 'emoji') span.className = 'cgf-em';
    span.textContent = text;
    line.append(span);
    const width = span.getBoundingClientRect().width;
    span.remove();
    // A width read before the strip had its font (0): measured again next time.
    if (width > 0) cache.current.set(key, width);
    return width > 0 ? width : text.length * 7;
  });
  return { ref, measure: measure.current };
}

/** A press outside our root, or Escape inside it: the open popover closes. */
export function useOutside(open: boolean, root: { current: HTMLElement | null }, close: () => void): void {
  useEffect(() => {
    if (!open) return undefined;
    const doc = root.current?.ownerDocument;
    if (doc === undefined) return undefined;
    const onDown = (event: Event): void => {
      const node = root.current;
      if (node !== null && !event.composedPath().includes(node)) close();
    };
    doc.addEventListener('pointerdown', onDown, true);
    return () => doc.removeEventListener('pointerdown', onDown, true);
  }, [open]);
}
