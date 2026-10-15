import { afterEach, describe, expect, it } from 'vitest';

import { NEAR_BOTTOM_PX, SETTLE_MS, createBottomKeeper, findListAbove, type BottomKeeper } from './keep-bottom';

interface Box {
  top: number;
  height: number;
}

/** An element whose geometry the test owns: happy-dom lays nothing out. */
function sized(element: HTMLElement, box: Box, scroll?: { height: number; top: number }): { box: Box; scroll: { height: number; top: number } } {
  const state = { box, scroll: scroll ?? { height: box.height, top: 0 } };
  element.getBoundingClientRect = () => ({ top: state.box.top, bottom: state.box.top + state.box.height, left: 0, right: 800, width: 800, height: state.box.height, x: 0, y: state.box.top, toJSON: () => ({}) });
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => state.box.height });
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => state.scroll.height });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => state.scroll.top,
    set: (value: number) => {
      state.scroll.top = Math.max(0, Math.min(value, state.scroll.height - state.box.height));
    },
  });
  return state;
}

const CHATSPACE_LAYOUT = `
    <div id="view">
      <div class="tabs" style="overflow-x: auto; overflow-y: auto"><span>chips</span></div>
      <div class="list-root"><div class="viewport"><div class="scroller" style="overflow-y: auto"><div class="content"></div></div></div></div>
      <div class="composer-block"><div class="frame-root"><div data-host="dock"></div><div class="composer-frame"></div></div></div>
    </div>`;
/** Fansly's container: the list, the typing line (no height), our dock, the composer — siblings in one flex column. */
const FANSLY_LAYOUT = `
    <div class="tabs" style="overflow-x: auto; overflow-y: auto"><span>chips</span></div>
    <app-group-message-container>
      <div class="scroller" style="overflow-y: auto"><div class="content"></div></div>
      <div class="partner-is-typing"></div>
      <div data-host="dock"></div>
      <app-group-message-input></app-group-message-input>
    </app-group-message-container>`;

/**
 * A chat as a site lays it out: ChatSpace's list over the composer's box, our dock first in the composer's frame root;
 * Fansly's list right before our dock in its container. `nearBottomPx` — the site's measure (the default otherwise).
 */
function chat(listHeight: number, contentHeight: number, scrollTop: number, site: { readonly layout?: string; readonly nearBottomPx?: number } = {}) {
  document.body.innerHTML = site.layout ?? CHATSPACE_LAYOUT;
  const pick = (selector: string): HTMLElement => {
    const found = document.querySelector<HTMLElement>(selector);
    if (found === null) throw new Error(`no ${selector} on the page`);
    return found;
  };
  const tabs = pick('.tabs');
  const scroller = pick('.scroller');
  const dock = pick('[data-host="dock"]');
  sized(tabs, { top: 0, height: 40 });
  const list = sized(scroller, { top: 40, height: listHeight }, { height: contentHeight, top: scrollTop });
  const dockBox = sized(dock, { top: 40 + listHeight, height: 34 });
  let changed: () => void = () => undefined;
  let clock = 1_000;
  const frames: (() => void)[] = [];
  window.requestAnimationFrame = (callback: FrameRequestCallback) => frames.push(() => callback(clock));
  const keeper = createBottomKeeper(window, dock, {
    observe: (_target, callback) => {
      changed = callback;
      return () => {
        changed = () => undefined;
      };
    },
    now: () => clock,
    ...(site.nearBottomPx === undefined ? {} : { nearBottomPx: site.nearBottomPx }),
  });
  return {
    keeper,
    scroller,
    dock,
    list,
    distance: () => list.scroll.height - list.scroll.top - list.box.height,
    /** The dock grows by `px`: the list's box above it shrinks by as much, as in the page's flex column. */
    grow(px: number): void {
      dockBox.box = { top: dockBox.box.top - px, height: dockBox.box.height + px };
      list.box = { top: list.box.top, height: list.box.height - px };
      changed();
    },
    /** The person (or ChatSpace) scrolls the list. */
    scrollTo(top: number): void {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event('scroll'));
    },
    frame(): void {
      for (const run of frames.splice(0)) run();
    },
    wait(ms: number): void {
      clock += ms;
    },
  };
}

let keeper: BottomKeeper | null = null;
afterEach(() => {
  keeper?.dispose();
  keeper = null;
  document.body.innerHTML = '';
});

describe('the message list keeps its bottom when our dock grows (UI-016)', () => {
  it('[UI-016] finds ChatSpace’s list from the dock: the tall scroll box above it — not a strip of chips, not a tray of attachments next to the composer, not a box below', () => {
    const page = chat(500, 2_000, 1_500);
    keeper = page.keeper;
    expect(findListAbove(window, page.dock)).toBe(page.scroller);
    // A tray that scrolls sideways stands between the list and the dock, nearer than the list: the list is the tall one.
    const tray = document.createElement('div');
    tray.setAttribute('style', 'overflow-x: auto; overflow-y: auto');
    (page.dock.parentElement as HTMLElement).before(tray);
    sized(tray, { top: 440, height: 96 });
    expect(findListAbove(window, page.dock)).toBe(page.scroller);
    tray.remove();
    // A scroll box that does not end above the dock (a side panel next to the composer) is not the list.
    sized(page.scroller, { top: 600, height: 500 });
    expect(findListAbove(window, page.dock)).toBeNull();
  });

  it('[UI-016] at its bottom, and within ChatSpace’s own «near the latest», the list is put at its bottom as a result opens — in the same step', () => {
    for (const away of [0, 40, NEAR_BOTTOM_PX]) {
      const page = chat(500, 2_000, 1_500 - away);
      keeper = page.keeper;
      page.keeper.placed(true);
      expect(page.distance()).toBe(away);
      page.grow(240);
      // No frame has passed: the last message never went under the result.
      expect(page.distance(), `${away} px away`).toBe(0);
      page.keeper.dispose();
    }
  });

  it('[UI-016] farther up nothing is touched: a person reading the history keeps the message under their eyes', () => {
    const page = chat(500, 2_000, 700);
    keeper = page.keeper;
    page.keeper.placed(true);
    page.grow(240);
    page.frame();
    expect(page.list.scroll.top).toBe(700);
  });

  it('[UI-016] a chat shorter than its list has no scroll to track; the result that opens over it still leaves its last message in view', () => {
    const page = chat(500, 400, 0);
    keeper = page.keeper;
    page.keeper.placed(true);
    page.grow(240);
    // 400 px of messages in 260 px of list: the end of them is what shows.
    expect(page.list.scroll.top).toBe(140);
    expect(page.distance()).toBe(0);
  });

  it('[UI-016] the person scrolled away from the bottom: the next result leaves them where they are; back near the bottom it is kept again', () => {
    const page = chat(500, 2_000, 1_500);
    keeper = page.keeper;
    page.keeper.placed(true);
    page.scrollTo(900);
    page.grow(100);
    page.frame();
    expect(page.list.scroll.top).toBe(900);
    page.scrollTo(2_000);
    page.grow(100);
    expect(page.distance()).toBe(0);
  });

  it('[UI-016] ChatSpace answers the resize after us and puts the list back at its top anchor: a frame later the bottom is ours again, and its scroll is not taken for the person leaving', () => {
    const page = chat(500, 2_000, 1_460);
    keeper = page.keeper;
    page.keeper.placed(true);
    page.grow(200);
    expect(page.distance()).toBe(0);
    // ChatSpace was not «at the bottom» by its 1 px rule: it restores the message at the top.
    page.scrollTo(1_460);
    page.frame();
    expect(page.distance()).toBe(0);
    // The result grows on (a stream), and ChatSpace answers each step the same way — in either order: the list is still held.
    page.grow(60);
    page.scrollTo(1_460);
    page.frame();
    expect(page.distance()).toBe(0);
    page.scrollTo(1_460);
    page.grow(30);
    expect(page.distance()).toBe(0);
    page.frame();
    // Long after the growth the same place is a place like any other: the person scrolled there themselves.
    page.wait(SETTLE_MS + 1);
    page.scrollTo(1_460);
    page.grow(40);
    page.frame();
    expect(page.list.scroll.top).toBe(1_460);
  });

  it('[UI-016] a person who scrolls up while a result streams is left where they went: only ChatSpace’s own answer to the resize is not taken for their scroll', () => {
    const page = chat(500, 2_000, 1_500);
    keeper = page.keeper;
    page.keeper.placed(true);
    // The stream begins: the result opens and grows step by step, the list follows its bottom.
    page.grow(80);
    page.frame();
    page.grow(40);
    page.frame();
    expect(page.distance()).toBe(0);
    // Mid-stream, the person scrolls up to read — no waiting for the growth to settle.
    page.scrollTo(700);
    page.grow(40);
    page.frame();
    page.grow(40);
    page.frame();
    expect(page.list.scroll.top).toBe(700);
    // A check «a frame later» that comes late (the tab was in the background) decides nothing.
    page.scrollTo(2_000);
    page.grow(20);
    page.scrollTo(700);
    page.wait(SETTLE_MS);
    page.frame();
    expect(page.list.scroll.top).toBe(700);
  });

  it('[UI-016] a list ChatSpace rendered after the dock was placed is judged by where it stood before the dock grew', () => {
    const page = chat(500, 2_000, 1_480);
    keeper = page.keeper;
    // Placed while the chat was loading: no scroll box above the dock yet.
    const parent = page.scroller.parentElement as HTMLElement;
    page.scroller.remove();
    page.keeper.placed(true);
    parent.append(page.scroller);
    page.grow(300);
    // 20 px from the bottom before the result took 300 px: near.
    expect(page.distance()).toBe(0);
  });

  it('a site with its own measure: Fansly’s list stands right before the dock, and «near» is 350 px of it — not 351 (FS-PLC-5)', () => {
    const fansly = { layout: FANSLY_LAYOUT, nearBottomPx: 350 };
    const found = chat(500, 2_000, 1_500, fansly);
    keeper = found.keeper;
    expect(findListAbove(window, found.dock)).toBe(found.scroller);
    found.keeper.dispose();
    for (const [away, kept] of [
      [0, true],
      [NEAR_BOTTOM_PX + 1, true],
      [350, true],
      [351, false],
    ] as const) {
      const page = chat(500, 2_000, 1_500 - away, fansly);
      keeper = page.keeper;
      page.keeper.placed(true);
      page.grow(240);
      page.frame();
      expect(page.distance() === 0, `${away} px away`).toBe(kept);
      if (!kept) expect(page.list.scroll.top).toBe(1_500 - away);
      page.keeper.dispose();
    }
  });

  it('[UI-016] the dock in the copy-only row or over a missing frame pushes no list: nothing is watched; a shrinking dock moves nothing', () => {
    const page = chat(500, 2_000, 1_500);
    keeper = page.keeper;
    page.keeper.placed(false);
    page.grow(240);
    expect(page.list.scroll.top).toBe(1_500);
    page.keeper.placed(true);
    page.scrollTo(1_300);
    const before = page.list.scroll.top;
    page.grow(-100);
    page.frame();
    expect(page.list.scroll.top).toBe(before);
  });
});
