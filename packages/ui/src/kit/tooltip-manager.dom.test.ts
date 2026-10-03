import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TOOLTIP_TIMING, TooltipManager } from './tooltip-manager';

let clock = 0;
const anchor = (): HTMLElement => {
  const element = document.createElement('button');
  document.body.append(element);
  return element;
};

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function advance(ms: number): void {
  clock += ms;
  vi.advanceTimersByTime(ms);
}

describe('[UI-004] our own tooltip, not `title` (ui-design §4.1 «Подсказка»)', () => {
  it('appears after 1 s of hover and closes when the pointer leaves', () => {
    const tips = new TooltipManager(() => clock);
    const a = anchor();
    tips.hover(a, 'Reply  ⌘E');
    advance(TOOLTIP_TIMING.hoverDelayMs - 1);
    expect(tips.state.value).toBeNull();
    advance(1);
    expect(tips.state.value).toEqual({ anchor: a, text: 'Reply  ⌘E' });
    tips.leave(a);
    expect(tips.state.value).toBeNull();
  });

  it('moving to a neighbour within 300 ms shows its tooltip after 250 ms', () => {
    const tips = new TooltipManager(() => clock);
    const a = anchor();
    const b = anchor();
    tips.hover(a, 'A');
    advance(TOOLTIP_TIMING.hoverDelayMs);
    tips.leave(a);
    advance(100);
    tips.hover(b, 'B');
    advance(TOOLTIP_TIMING.neighbourDelayMs);
    expect(tips.state.value?.text).toBe('B');
    // Straight from an open tooltip to another trigger: the quick delay too.
    tips.hover(a, 'A');
    expect(tips.state.value).toBeNull();
    advance(TOOLTIP_TIMING.neighbourDelayMs);
    expect(tips.state.value?.text).toBe('A');
    tips.leave(a);
    advance(TOOLTIP_TIMING.neighbourWindowMs + 1);
    tips.hover(b, 'B');
    advance(TOOLTIP_TIMING.neighbourDelayMs);
    expect(tips.state.value).toBeNull();
    advance(TOOLTIP_TIMING.hoverDelayMs);
    expect(tips.state.value?.text).toBe('B');
  });

  it('keyboard focus shows it at once; pointer focus does not', () => {
    const tips = new TooltipManager(() => clock);
    const a = anchor();
    tips.focus(a, 'Fix недоступен: нужен черновик', false);
    expect(tips.state.value).toBeNull();
    tips.focus(a, 'Fix недоступен: нужен черновик', true);
    expect(tips.state.value?.text).toBe('Fix недоступен: нужен черновик');
  });

  it('Esc, scrolling and resizing close it; listeners live only while it is shown', () => {
    const tips = new TooltipManager(() => clock);
    const a = anchor();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const ours = (spy: typeof add | typeof remove): unknown[] => spy.mock.calls.filter(([type]) => type === 'scroll' || type === 'resize').map((call) => call[1]);
    expect(ours(add)).toHaveLength(0);
    tips.focus(a, 'x', true);
    const attached = ours(add);
    expect(attached).toHaveLength(2);
    window.dispatchEvent(new Event('scroll'));
    expect(tips.state.value).toBeNull();
    for (const listener of attached) expect(ours(remove)).toContain(listener);
    tips.focus(a, 'x', true);
    window.dispatchEvent(new Event('resize'));
    expect(tips.state.value).toBeNull();
    tips.focus(a, 'x', true);
    tips.close();
    expect(tips.state.value).toBeNull();
    add.mockRestore();
    remove.mockRestore();
  });

  it('follows a changed text, drops an emptied one, and never opens on a detached trigger', () => {
    const tips = new TooltipManager(() => clock);
    const a = anchor();
    tips.focus(a, 'one', true);
    tips.update(a, 'two');
    expect(tips.state.value?.text).toBe('two');
    tips.update(a, '');
    expect(tips.state.value).toBeNull();
    tips.hover(a, 'three');
    a.remove();
    advance(TOOLTIP_TIMING.hoverDelayMs);
    expect(tips.state.value).toBeNull();
    tips.hover(anchor(), '');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaving cancels a pending tooltip; dispose leaves no timer behind', () => {
    const tips = new TooltipManager(() => clock);
    const a = anchor();
    tips.hover(a, 'x');
    tips.leave(a);
    expect(vi.getTimerCount()).toBe(0);
    tips.hover(a, 'x');
    tips.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
