// Our slots in ChatSpace's conversation header: right before its search button, in our order; back in place when
// ChatSpace renders the header again; gone with the header, and back with it.

import { createShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHeaderSlots, type HeaderSlots } from './header-slot';

/** Visible while connected and no ancestor is `display: none` (happy-dom lays nothing out). */
function stubLayout(element: Element): void {
  const shown = (): boolean => {
    for (let node: Element | null = element; node; node = node.parentElement) if ((node as HTMLElement).style.display === 'none') return false;
    return element.isConnected;
  };
  Object.defineProperty(element, 'checkVisibility', { configurable: true, value: shown });
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => (shown() ? { left: 0, top: 0, right: 28, bottom: 28, width: 28, height: 28, x: 0, y: 0 } : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) });
}

/** ChatSpace's header as 0.233.0 renders it: the actions row, each button in its tooltip's wrapper. */
function renderHeader(buttons: readonly string[] = ['gallery', 'pinned-messages', 'search']): HTMLElement {
  const header = document.createElement('div');
  header.className = 'conversation-header';
  const bar = header.appendChild(document.createElement('div'));
  bar.appendChild(document.createElement('div')).textContent = 'Fan Alder';
  const row = bar.appendChild(document.createElement('div'));
  row.className = 'actions';
  for (const name of [...buttons, 'refresh']) {
    const tip = row.appendChild(document.createElement('div'));
    tip.className = 'tip';
    const button = tip.appendChild(document.createElement('button'));
    if (name !== 'refresh') button.setAttribute('data-testid', `conversation-header-${name}-button`);
    stubLayout(button);
  }
  return header;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
/** The row's children as names: a tooltip's button by its test id, ours by our order. */
const rowOf = (header: Element): string[] =>
  [...(header.querySelector('.actions')?.children ?? [])].map((child) => child.getAttribute('data-header-order') ?? child.querySelector('button')?.getAttribute('data-testid')?.replace(/^conversation-header-|-button$/g, '') ?? 'refresh');

let panel: HTMLElement;
let slots: HeaderSlots;
let changes: number;

beforeEach(() => {
  panel = document.body.appendChild(document.createElement('section'));
  panel.appendChild(renderHeader());
  slots = createHeaderSlots(document, createShadowRootRegistry());
  changes = 0;
  slots.onChange(() => (changes += 1));
});
afterEach(() => {
  slots.dispose();
  panel.remove();
});

describe('our slots in the conversation header', () => {
  it('right before the search button, in our own order; the row found is said once', () => {
    slots.sync(true);
    slots.mount(20);
    slots.mount(10);
    expect(rowOf(panel)).toEqual(['gallery', 'pinned-messages', '10', '20', 'search', 'refresh']);
    expect([slots.available(), slots.state(), changes]).toEqual([true, 'ok', 1]);
    // Asked again with nothing changed: nothing moves, nothing is said.
    slots.sync(true);
    expect([rowOf(panel), changes]).toEqual([['gallery', 'pinned-messages', '10', '20', 'search', 'refresh'], 1]);
    expect(() => slots.mount(10)).toThrow();
  });

  it('ChatSpace renders the header again: our slots come back in the new row, by themselves', async () => {
    slots.sync(true);
    const slot = slots.mount(10);
    const renewed = renderHeader();
    panel.replaceChildren(renewed);
    await settle();
    expect(rowOf(renewed)).toEqual(['gallery', 'pinned-messages', '10', 'search', 'refresh']);
    expect(slots.available()).toBe(true);
    // A button that came later (the role's permissions landed): our slot keeps its place before the search.
    const row = renewed.querySelector('.actions') as HTMLElement;
    const folders = row.appendChild(document.createElement('div'));
    folders.appendChild(document.createElement('button')).setAttribute('data-testid', 'conversation-header-folders-button');
    await settle();
    expect(rowOf(renewed)).toEqual(['gallery', 'pinned-messages', '10', 'search', 'refresh', 'folders']);
    slot.remove();
    expect(rowOf(renewed)).toEqual(['gallery', 'pinned-messages', 'search', 'refresh', 'folders']);
  });

  it('a role without message search: right after the pinned messages, or the gallery', () => {
    panel.replaceChildren(renderHeader(['gallery', 'pinned-messages']));
    slots.sync(true);
    slots.mount(10);
    expect(rowOf(panel)).toEqual(['gallery', 'pinned-messages', '10', 'refresh']);
    panel.replaceChildren(renderHeader(['gallery']));
    slots.sync(true);
    expect(rowOf(panel)).toEqual(['gallery', '10', 'refresh']);
  });

  it('the header gone: our slots go with it, `missing` while a chat is shown; back with the header', async () => {
    slots.sync(true);
    slots.mount(10);
    panel.replaceChildren();
    await settle();
    expect([slots.available(), slots.state()]).toEqual([false, 'missing']);
    expect(document.querySelector('[data-host="header-slot"]')).toBeNull();
    // No chat open: not judged.
    slots.sync(false);
    expect(slots.state()).toBe('unknown');
    panel.appendChild(renderHeader());
    slots.sync(true);
    expect([rowOf(panel), slots.state()]).toEqual([['gallery', 'pinned-messages', '10', 'search', 'refresh'], 'ok']);
  });

  it('a header hidden or shown twice is no place for us', async () => {
    slots.sync(true);
    slots.mount(10);
    const second = panel.appendChild(renderHeader());
    await settle();
    expect([slots.available(), rowOf(second)]).toEqual([false, ['gallery', 'pinned-messages', 'search', 'refresh']]);
    expect(rowOf(panel.firstElementChild as Element)).toEqual(['gallery', 'pinned-messages', 'search', 'refresh']);
    second.style.display = 'none';
    slots.sync(true);
    expect(rowOf(panel.firstElementChild as Element)).toEqual(['gallery', 'pinned-messages', '10', 'search', 'refresh']);
  });
});
