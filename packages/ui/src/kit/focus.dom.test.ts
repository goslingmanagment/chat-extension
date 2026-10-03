import { afterEach, describe, expect, it } from 'vitest';

import { activeIn, containsFocus, focusQuietly, isComposing, rovingIndex, tabbables, trapTab } from './focus';

function rootWith(html: string): { root: ShadowRoot; box: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const box = document.createElement('div');
  box.tabIndex = -1;
  box.innerHTML = html;
  root.append(box);
  return { root, box };
}

const tab = (shiftKey = false): KeyboardEvent => new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });

afterEach(() => {
  document.body.replaceChildren();
});

describe('focus utilities (ui-design §6.3)', () => {
  it('lists tabbable elements in order; aria-disabled ones stay, disabled, hidden and tabindex=-1 do not', () => {
    const { box } = rootWith(
      '<button id="a">a</button><button id="b" aria-disabled="true">b</button><button id="c" disabled>c</button>' +
        '<span id="d" tabindex="0">d</span><span id="e" tabindex="-1">e</span><div hidden><button id="f">f</button></div>' +
        '<input id="g"><input type="hidden" id="h"><a id="i" href="#x">i</a><a id="j">j</a>',
    );
    expect(tabbables(box).map((element) => element.id)).toEqual(['a', 'b', 'd', 'g', 'i']);
  });

  it('[CS-005] a window keeps Tab inside and goes round both ways', () => {
    const { root, box } = rootWith('<button id="first">1</button><button id="mid">2</button><button id="last">3</button>');
    const first = root.getElementById('first') as HTMLElement;
    const last = root.getElementById('last') as HTMLElement;
    last.focus();
    const forward = tab();
    expect(trapTab(forward, box, root)).toBe(true);
    expect(forward.defaultPrevented).toBe(true);
    expect(activeIn(root)?.id).toBe('first');
    const backward = tab(true);
    expect(trapTab(backward, box, root)).toBe(true);
    expect(activeIn(root)?.id).toBe('last');
    (root.getElementById('mid') as HTMLElement).focus();
    expect(trapTab(tab(), box, root)).toBe(false);
    first.focus();
    expect(containsFocus(root, box)).toBe(true);
    expect(trapTab(new KeyboardEvent('keydown', { key: 'Enter' }), box, root)).toBe(false);
    expect(trapTab(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true }), box, root)).toBe(false);
  });

  it('an empty window keeps focus on itself', () => {
    const { root, box } = rootWith('<span>text</span>');
    const event = tab();
    expect(trapTab(event, box, root)).toBe(true);
    expect(activeIn(root)).toBe(box);
  });

  it('focus from outside the window enters at the edge', () => {
    const { root, box } = rootWith('<button id="first">1</button><button id="last">2</button>');
    expect(trapTab(tab(), box, root)).toBe(true);
    expect(activeIn(root)?.id).toBe('first');
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    expect(trapTab(tab(true), box, root)).toBe(true);
    expect(activeIn(root)?.id).toBe('last');
  });

  it('focuses quietly only what is still in the document', () => {
    const { root } = rootWith('<button id="x">x</button>');
    const button = root.getElementById('x') as HTMLElement;
    expect(focusQuietly(button)).toBe(true);
    button.remove();
    expect(focusQuietly(button)).toBe(false);
    expect(focusQuietly(null)).toBe(false);
    expect(focusQuietly(undefined)).toBe(false);
  });

  it('roving: arrows move by orientation, Home and End jump, wrap or stop at the ends', () => {
    expect(rovingIndex('ArrowRight', 0, 3, 'horizontal')).toBe(1);
    expect(rovingIndex('ArrowRight', 2, 3, 'horizontal')).toBe(0);
    expect(rovingIndex('ArrowRight', 2, 3, 'horizontal', false)).toBe(2);
    expect(rovingIndex('ArrowLeft', 0, 3, 'horizontal')).toBe(2);
    expect(rovingIndex('ArrowLeft', 0, 3, 'horizontal', false)).toBe(0);
    expect(rovingIndex('ArrowDown', 0, 3, 'horizontal')).toBeNull();
    expect(rovingIndex('ArrowDown', 0, 3, 'vertical')).toBe(1);
    expect(rovingIndex('ArrowUp', 0, 3, 'both')).toBe(2);
    expect(rovingIndex('ArrowRight', 0, 3, 'vertical')).toBeNull();
    expect(rovingIndex('Home', 2, 3, 'vertical')).toBe(0);
    expect(rovingIndex('End', 0, 3, 'vertical')).toBe(2);
    expect(rovingIndex('a', 0, 3, 'both')).toBeNull();
    expect(rovingIndex('ArrowDown', 0, 0, 'vertical')).toBeNull();
  });

  it('recognises IME composition keys', () => {
    expect(isComposing(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))).toBe(true);
    expect(isComposing(new KeyboardEvent('keydown', { key: 'Process', keyCode: 229 }))).toBe(true);
    expect(isComposing(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false);
  });
});
