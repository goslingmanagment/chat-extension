import { createRef, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_DOM_ROWS, VirtualList, rowAt, rowOffsets, visibleRange, type VirtualListHandle } from './VirtualList';

interface Row {
  readonly id: number;
  readonly shelf: boolean;
}

const ROWS: Row[] = Array.from({ length: 1000 }, (_, id) => ({ id, shelf: id % 50 === 0 }));
const height = (row: Row): number => (row.shelf ? 34 : 36);

let container: HTMLElement | null = null;
afterEach(() => {
  if (container === null) return;
  render(null, container);
  container.remove();
  container = null;
});

function mount(props: Partial<Parameters<typeof VirtualList<Row>>[0]> = {}): { scroller: HTMLElement; handle: { current: VirtualListHandle | null } } {
  const host = document.createElement('div');
  container = host;
  document.body.append(host);
  const handle = createRef<VirtualListHandle>();
  render(
    <VirtualList<Row>
      items={ROWS}
      rowHeight={height}
      height={400}
      getKey={(row) => row.id}
      renderRow={(row) => <span data-id={row.id}>{row.shelf ? `shelf ${row.id}` : `fan ${row.id}`}</span>}
      listRef={handle}
      role="table"
      rowRole="row"
      label="Spenders"
      {...props}
    />,
    host,
  );
  return { scroller: host.querySelector('.cg-vlist') as HTMLElement, handle };
}

describe('virtual list math', () => {
  it('offsets, the row at a position and the rendered range', () => {
    const offsets = rowOffsets(ROWS, height);
    expect(offsets[1]).toBe(34);
    expect(offsets[2]).toBe(70);
    expect(rowAt(offsets, 0)).toBe(0);
    expect(rowAt(offsets, 34)).toBe(1);
    expect(rowAt(offsets, 69.9)).toBe(1);
    expect(rowAt(rowOffsets([], 36), 10)).toBe(0);
    expect(visibleRange(rowOffsets([], 36), 0, 400, 6)).toEqual([0, 0]);
    expect(visibleRange(rowOffsets(ROWS, 36), 3600, 360, 6)).toEqual([94, 116]);
  });

  it(`never renders more than ${MAX_DOM_ROWS} rows, whatever the viewport`, () => {
    const [start, end] = visibleRange(rowOffsets(ROWS, 2), 0, 10_000, 6);
    expect(end - start).toBe(MAX_DOM_ROWS);
    const [s2, e2] = visibleRange(rowOffsets(ROWS, 2), 0, 10_000, 6, 149);
    expect(e2 - s2).toBe(149);
  });
});

describe('the board list: 1000 rows, at most 150 in the DOM (architecture.md §10.1, §11)', () => {
  it('renders the rows in view with their roles and positions', () => {
    const { scroller } = mount();
    const rows = scroller.querySelectorAll('[data-cg-row]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(MAX_DOM_ROWS);
    expect(scroller.getAttribute('role')).toBe('table');
    expect(scroller.getAttribute('aria-rowcount')).toBe('1000');
    expect(rows[0]?.getAttribute('role')).toBe('row');
    expect(rows[0]?.getAttribute('aria-rowindex')).toBe('1');
    expect((scroller.querySelector('.cg-vlist__inner') as HTMLElement).style.height).toBe(`${rowOffsets(ROWS, height)[1000]}px`);
  });

  it('follows scrolling, keeps the cap, and scrolls the keyboard row into view', async () => {
    const onRange = vi.fn();
    const { scroller, handle } = mount({ onRangeChange: onRange, isGroupHeader: (row) => row.shelf });
    await act(() => {
      scroller.scrollTop = 20_000;
      scroller.dispatchEvent(new Event('scroll'));
    });
    const rows = [...scroller.querySelectorAll('[data-cg-row]')].map((row) => Number(row.getAttribute('data-cg-row')));
    expect(Math.min(...rows)).toBeGreaterThan(500);
    expect(rows.length + scroller.querySelectorAll('.cg-vlist__sticky').length).toBeLessThanOrEqual(MAX_DOM_ROWS);
    // The shelf of the first visible row sticks under the header.
    expect(scroller.querySelector('.cg-vlist__sticky')?.textContent).toMatch(/^shelf \d+$/);
    expect(onRange).toHaveBeenLastCalledWith(handle.current?.range()[0], handle.current?.range()[1]);

    await act(() => handle.current?.scrollToIndex(3, 'start'));
    expect(scroller.scrollTop).toBe(rowOffsets(ROWS, height)[3]);
    await act(() => handle.current?.scrollToIndex(999));
    expect(scroller.scrollTop).toBeGreaterThan(30_000);
    await act(() => handle.current?.scrollToIndex(500, 'center'));
    expect(Math.abs(scroller.scrollTop + 200 - (rowOffsets(ROWS, height)[500] ?? 0) - 18)).toBeLessThan(2);
    await act(() => handle.current?.scrollToIndex(-1));
  });

  it('a sticky header row on top; list and option roles carry their position', () => {
    const { scroller } = mount({ header: <div>head</div>, headerHeight: 28, role: 'listbox', rowRole: 'option' });
    expect(scroller.querySelector('.cg-vlist__head')?.textContent).toBe('head');
    const first = scroller.querySelector('[data-cg-row="0"]');
    expect(first?.getAttribute('aria-posinset')).toBe('1');
    expect(first?.getAttribute('aria-setsize')).toBe('1000');
  });

  it('without a height it fills its parent and follows the parent’s size', async () => {
    const observed: Element[] = [];
    let resize: () => void = () => undefined;
    class FakeObserver {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(element: Element): void {
        observed.push(element);
      }
      disconnect(): void {
        observed.length = 0;
      }
    }
    const original = window.ResizeObserver;
    Object.assign(window, { ResizeObserver: FakeObserver });
    try {
      const host = document.createElement('div');
      container = host;
      document.body.append(host);
      await act(() => render(<VirtualList<Row> items={ROWS} rowHeight={36} getKey={(row) => row.id} renderRow={(row) => row.id} />, host));
      const scroller = host.querySelector('.cg-vlist') as HTMLElement;
      expect(observed).toEqual([scroller]);
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 360 });
      await act(() => resize());
      expect(scroller.querySelectorAll('[data-cg-row]').length).toBe(10 + 6);
      await act(() => render(null, host));
      expect(observed).toEqual([]);
    } finally {
      Object.assign(window, { ResizeObserver: original });
    }
  });

  it('the sticky group row is the group of the row at the header’s lower edge, and it is inert', async () => {
    const flat = Array.from({ length: 400 }, (_, id) => ({ id, shelf: id % 50 === 0 }));
    const { scroller } = mount({ items: flat, rowHeight: 36, header: <div>head</div>, headerHeight: 28, isGroupHeader: (row) => row.shelf });
    const scrollTo = (top: number) =>
      act(() => {
        scroller.scrollTop = top;
        scroller.dispatchEvent(new Event('scroll'));
      });
    const sticky = (): Element | null => scroller.querySelector('.cg-vlist__sticky');
    // Shelf 50 starts at 1800: 10 px above the header's edge it slides under the header, and its copy takes its place.
    await scrollTo(1810);
    expect(sticky()?.textContent).toBe('shelf 50');
    expect(sticky()?.hasAttribute('inert')).toBe(true);
    expect(sticky()?.getAttribute('aria-hidden')).toBe('true');
    // Exactly at the edge the real shelf row shows itself: no copy.
    await scrollTo(1800);
    expect(sticky()).toBeNull();
    // Just below the edge the last row of shelf 0 is at the edge: shelf 0 sticks.
    await scrollTo(1790);
    expect(sticky()?.textContent).toBe('shelf 0');
    await scrollTo(0);
    expect(sticky()).toBeNull();
  });

  it(`a sticky copy counts against the cap: rows and the copy are at most ${MAX_DOM_ROWS}`, async () => {
    const flat = Array.from({ length: 1000 }, (_, id) => ({ id, shelf: id % 50 === 0 }));
    const { scroller } = mount({ items: flat, rowHeight: 36, height: MAX_DOM_ROWS * 36, isGroupHeader: (row) => row.shelf });
    await act(() => {
      scroller.scrollTop = 300 * 36 + 10;
      scroller.dispatchEvent(new Event('scroll'));
    });
    expect(scroller.querySelector('.cg-vlist__sticky')?.textContent).toBe('shelf 300');
    const rows = scroller.querySelectorAll('[data-cg-row]').length;
    expect(rows).toBe(MAX_DOM_ROWS - 1);
    expect(rows + scroller.querySelectorAll('.cg-vlist__sticky').length).toBe(MAX_DOM_ROWS);
  });

  it('active index scrolls into view on keyboard movement', async () => {
    const host = document.createElement('div');
    container = host;
    document.body.append(host);
    const draw = (active: number) =>
      render(<VirtualList<Row> items={ROWS} rowHeight={36} height={360} getKey={(row) => row.id} renderRow={(row) => row.id} activeIndex={active} />, host);
    await act(() => draw(0));
    await act(() => draw(40));
    const scroller = host.querySelector('.cg-vlist') as HTMLElement;
    expect(scroller.scrollTop).toBe(41 * 36 - 360);
  });
});
