// The virtual list (architecture.md §10.1 «Списки длиннее 50 строк», §11;
// the Spenders board up to 1000 rows, «Новые», the palette): only the rows in
// view plus a margin are in the DOM, never more than 150. Rows have a known
// height (fixed, or per row: a 34 px shelf among 36 px fans). Optional sticky
// column header and sticky group rows (the shelf under the header, §3.5): the
// next group's row pushes the stuck one up, and a lead row may stick under it
// while the rows it leads pass (the picked fan over their unfolded preview).
// Scrolling a row into view keeps it out from under what sticks over it.

import { type ComponentChildren, type JSX, type Ref, type TargetedKeyboardEvent } from 'preact';
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

/** Hard cap of rendered rows (§10.1). */
export const MAX_DOM_ROWS = 150;
/** Rows rendered above and below the viewport. */
const DEFAULT_OVERSCAN = 6;
/** Before the first measure (or where layout is unknown) the list assumes this viewport. */
const FALLBACK_VIEWPORT_PX = 600;

export interface VirtualListHandle {
  scrollToIndex(index: number, align?: 'nearest' | 'start' | 'center'): void;
  /** The whole row is in view, none of it under what sticks over it. */
  isInView(index: number): boolean;
  /** [first, last) of the rows in the DOM. */
  range(): readonly [number, number];
}

export interface VirtualListProps<T> {
  readonly items: readonly T[];
  /** Fixed height, or the height of each row. */
  readonly rowHeight: number | ((item: T, index: number) => number);
  /** `copy` — the row's sticky copy at the top: drawn for the eye, it carries no ids the real row is found by. */
  readonly renderRow: (item: T, index: number, copy?: boolean) => ComponentChildren;
  readonly getKey: (item: T, index: number) => string | number;
  readonly label?: string;
  readonly role?: 'list' | 'listbox' | 'table' | 'grid' | 'rowgroup' | 'feed';
  readonly rowRole?: 'listitem' | 'option' | 'row' | 'article' | 'presentation';
  /** The viewport height; without it the list fills its parent (give the parent a height). */
  readonly height?: number;
  readonly overscan?: number;
  /** Scrolled into view (nearest) when it changes: the keyboard's current row. */
  readonly activeIndex?: number | null;
  /** The rendered range changed: load the next page near the end (SP-053, LoadMore). */
  readonly onRangeChange?: (start: number, end: number) => void;
  /** A sticky column header above the rows, `headerHeight` px tall. */
  readonly header?: ComponentChildren;
  readonly headerHeight?: number;
  /** Group rows that stick under the header while their group is in view. */
  readonly isGroupHeader?: (item: T, index: number) => boolean;
  /** A row that sticks under its group row while the rows after it, up to `until` (exclusive), pass the top. */
  readonly stickyLead?: { readonly index: number; readonly until: number } | null;
  /** A press on the lead row's sticky copy (the real row is above the view): e.g. scroll back to it. */
  readonly onStickyPress?: (index: number) => void;
  readonly listRef?: Ref<VirtualListHandle>;
  readonly class?: string;
  readonly onKeyDown?: (event: TargetedKeyboardEvent<HTMLDivElement>) => void;
}

/** Row offsets: `offsets[i]` is the top of row i, `offsets[n]` the total height. */
export function rowOffsets<T>(items: readonly T[], rowHeight: number | ((item: T, index: number) => number)): Float64Array {
  const offsets = new Float64Array(items.length + 1);
  for (let index = 0; index < items.length; index += 1) {
    const height = typeof rowHeight === 'number' ? rowHeight : rowHeight(items[index] as T, index);
    offsets[index + 1] = (offsets[index] ?? 0) + Math.max(0, height);
  }
  return offsets;
}

/** The row at `y` (binary search over the offsets). */
export function rowAt(offsets: Float64Array, y: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((offsets[middle] ?? 0) <= y) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The rendered range for a scroll position: rows in view ± overscan, never more than `cap` rows. */
export function visibleRange(offsets: Float64Array, scrollTop: number, viewport: number, overscan: number, cap: number = MAX_DOM_ROWS): readonly [number, number] {
  const count = offsets.length - 1;
  if (count <= 0) return [0, 0];
  const first = rowAt(offsets, Math.max(0, scrollTop));
  const last = rowAt(offsets, Math.max(0, scrollTop + viewport - 1));
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, last + 1 + overscan, start + Math.max(1, cap));
  return [start, end];
}

export function VirtualList<T>(props: VirtualListProps<T>): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(props.height ?? FALLBACK_VIEWPORT_PX);
  const offsets = useMemo(() => rowOffsets(props.items, props.rowHeight), [props.items, props.rowHeight]);
  const headerHeight = props.header === undefined ? 0 : (props.headerHeight ?? 0);
  const overscan = props.overscan ?? DEFAULT_OVERSCAN;
  // The sticky copies of a group row and a lead row count against the DOM cap too.
  const cap = MAX_DOM_ROWS - (props.isGroupHeader === undefined ? 0 : 1) - (props.stickyLead === undefined || props.stickyLead === null ? 0 : 1);
  const [start, end] = visibleRange(offsets, Math.max(0, scrollTop - headerHeight), viewport, overscan, cap);
  const count = props.items.length;
  const total = offsets[count] ?? 0;
  const heightOf = (index: number): number => (offsets[index + 1] ?? 0) - (offsets[index] ?? 0);
  /** The group row a row belongs to: the nearest one at or above it. */
  const groupOf = (index: number): number | null => {
    if (props.isGroupHeader === undefined) return null;
    for (let at = Math.min(index, count - 1); at >= 0; at -= 1) if (props.isGroupHeader(props.items[at] as T, at)) return at;
    return null;
  };
  /** What sticks over row `index` once it is at the top: its group row, and the lead row over the rows it leads. */
  const stickyOver = (index: number): number => {
    const group = groupOf(index);
    const lead = props.stickyLead;
    return (group === null || group === index ? 0 : heightOf(group)) + (lead !== undefined && lead !== null && index > lead.index && index < lead.until ? heightOf(lead.index) : 0);
  };

  useLayoutEffect(() => {
    const node = scroller.current;
    if (node === null) return undefined;
    if (props.height !== undefined) {
      setViewport(props.height);
      return undefined;
    }
    const measure = (): void => {
      const height = node.clientHeight;
      setViewport(height > 0 ? height : FALLBACK_VIEWPORT_PX);
    };
    measure();
    const view = node.ownerDocument.defaultView;
    if (view === null || typeof view.ResizeObserver !== 'function') return undefined;
    const observer = new view.ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [props.height]);

  const scrollToIndex = (index: number, align: 'nearest' | 'start' | 'center' = 'nearest'): void => {
    const node = scroller.current;
    if (node === null || index < 0 || index >= count) return;
    const top = (offsets[index] ?? 0) + headerHeight;
    const bottom = (offsets[index + 1] ?? top) + headerHeight;
    const height = node.clientHeight > 0 ? node.clientHeight : viewport;
    // The row comes to rest under the header and under what sticks over it, never behind them.
    const over = headerHeight + stickyOver(index);
    let next = node.scrollTop;
    if (align === 'start') next = top - over;
    else if (align === 'center') next = top - (height - (bottom - top)) / 2;
    else if (top - over < node.scrollTop) next = top - over;
    else if (bottom > node.scrollTop + height) next = bottom - height;
    if (next !== node.scrollTop) {
      node.scrollTop = Math.max(0, next);
      setScrollTop(node.scrollTop);
    }
  };

  const isInView = (index: number): boolean => {
    const node = scroller.current;
    if (node === null || index < 0 || index >= count) return false;
    const height = node.clientHeight > 0 ? node.clientHeight : viewport;
    const top = (offsets[index] ?? 0) + headerHeight;
    const bottom = (offsets[index + 1] ?? 0) + headerHeight;
    return top - headerHeight - stickyOver(index) >= node.scrollTop && bottom <= node.scrollTop + height;
  };

  useImperativeHandle(props.listRef ?? null, () => ({ scrollToIndex, isInView, range: () => [start, end] as const }), [offsets, start, end, viewport, props.stickyLead]);

  useEffect(() => {
    if (props.activeIndex !== null && props.activeIndex !== undefined) scrollToIndex(props.activeIndex);
  }, [props.activeIndex]); // keyboard movement only

  const onRange = props.onRangeChange;
  useEffect(() => {
    onRange?.(start, end);
  }, [start, end, onRange]);

  // What sticks at the top, top to bottom, and where (≤ 0 while the row that ends its stay pushes it up).
  const stuck: { readonly index: number; readonly top: number; readonly lead: boolean }[] = [];
  if (props.isGroupHeader !== undefined) {
    // The rows start under the in-flow column header, so the row at the header's lower edge is the one at scrollTop.
    const group = groupOf(rowAt(offsets, Math.max(0, scrollTop)));
    // The real group row still starts at or below the header's edge: no copy over it.
    if (group !== null && (offsets[group] ?? 0) < scrollTop) {
      let next = group + 1;
      while (next < count && !props.isGroupHeader(props.items[next] as T, next)) next += 1;
      stuck.push({ index: group, top: Math.min(0, (offsets[next] ?? total) - scrollTop - heightOf(group)), lead: false });
    }
  }
  const lead = props.stickyLead;
  if (lead !== undefined && lead !== null && lead.index < count) {
    const under = stuck.reduce((edge, row) => Math.max(edge, row.top + heightOf(row.index)), 0);
    const end = (offsets[Math.min(lead.until, count)] ?? total) - scrollTop;
    if ((offsets[lead.index] ?? 0) - scrollTop < under && end > under) stuck.push({ index: lead.index, top: Math.min(under, end - heightOf(lead.index)), lead: true });
  }

  const rows: JSX.Element[] = [];
  for (let index = start; index < end; index += 1) {
    const item = props.items[index] as T;
    const top = offsets[index] ?? 0;
    const height = (offsets[index + 1] ?? top) - top;
    rows.push(
      <div
        key={props.getKey(item, index)}
        class="cg-vlist__row"
        style={{ transform: `translateY(${top}px)`, height: `${height}px` }}
        data-cg-row={index}
        {...(props.rowRole === undefined ? {} : { role: props.rowRole })}
        {...(props.rowRole === 'listitem' || props.rowRole === 'option' || props.rowRole === 'article'
          ? { 'aria-posinset': index + 1, 'aria-setsize': count }
          : props.rowRole === 'row'
            ? { 'aria-rowindex': index + 1 + (props.header === undefined ? 0 : 1) }
            : {})}
      >
        {props.renderRow(item, index)}
      </div>,
    );
  }

  return (
    <div
      ref={scroller}
      class={`cg-vlist${props.class === undefined ? '' : ` ${props.class}`}`}
      style={props.height === undefined ? {} : { height: `${props.height}px` }}
      {...(props.role === undefined ? {} : { role: props.role })}
      {...(props.label === undefined ? {} : { 'aria-label': props.label })}
      {...(props.role === 'table' || props.role === 'grid' ? { 'aria-rowcount': count + (props.header === undefined ? 0 : 1) } : {})}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      {...(props.onKeyDown === undefined ? {} : { onKeyDown: props.onKeyDown })}
    >
      {props.header === undefined ? null : (
        <div class="cg-vlist__head" style={{ height: `${headerHeight}px` }}>
          {props.header}
        </div>
      )}
      {stuck.length === 0 ? null : (
        // Copies for the eye only: hidden from screen readers and out of the Tab order (their buttons live on the real
        // rows). The upper copy lies over the lower: a lead pushed up at its end slides under its group row.
        <div class="cg-vlist__sticky" style={{ top: `${headerHeight}px` }} aria-hidden="true">
          {stuck.map(({ index, top, lead }, at) => {
            const key = props.getKey(props.items[index] as T, index);
            const style = { transform: `translateY(${top}px)`, height: `${heightOf(index)}px`, zIndex: stuck.length - at };
            const copy = props.renderRow(props.items[index] as T, index, true);
            // A group row's copy lets a press through to the row under it. The lead's copy takes the press itself:
            // under it lie the rows it leads (a preview's buttons), which are never pressed unseen.
            return lead ? (
              <div key={key} class={`cg-vlist__copy${props.onStickyPress === undefined ? '' : ' is-pressable'}`} style={style} onClick={() => props.onStickyPress?.(index)}>
                <div inert>{copy}</div>
              </div>
            ) : (
              <div key={key} class="cg-vlist__copy" style={style} inert>
                {copy}
              </div>
            );
          })}
        </div>
      )}
      <div class="cg-vlist__inner" style={{ height: `${total}px` }}>
        {rows}
      </div>
    </div>
  );
}

export const VIRTUAL_LIST_CSS = `
.cg-vlist { position: relative; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-width: thin; min-height: 0; height: 100%; }
.cg-vlist__head { position: sticky; top: 0; z-index: 3; background: var(--cg-surface); }
.cg-vlist__sticky { position: sticky; z-index: 2; height: 0; overflow: visible; }
.cg-vlist__copy { position: absolute; top: 0; left: 0; right: 0; background: var(--cg-surface); }
.cg-vlist__copy > div { height: 100%; }
.cg-vlist__copy.is-pressable { cursor: pointer; }
.cg-vlist__inner { position: relative; width: 100%; }
.cg-vlist__row { position: absolute; top: 0; left: 0; right: 0; contain: layout style; }
`;
