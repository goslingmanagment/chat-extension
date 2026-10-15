// The relay frame in a Fansly tab (R20 P9c; architecture.md §8.5; FS-NET-4, FS-PLC-6): mounted only when asked,
// in a closed root of an overlay host in <html>, for the account the tab is on; another account takes it down at once.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRelayFrame, RELAY_LOAD_TIMEOUT_MS } from './relay-frame';

const URL_OF_PAGE = 'moz-extension://0f1e2d3c-test/fansly-relay.html';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const node of document.querySelectorAll('div[data-host]')) node.remove();
});

/**
 * The frames made, as the page cannot see them (a closed root). happy-dom would try to load a `moz-extension:` page
 * into a real iframe, so each one is a stand-in element that loads nothing; its `load` is the test's to say.
 */
function watchFrames(): HTMLElement[] {
  const made: HTMLElement[] = [];
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    if (tag !== 'iframe') return create(tag, options);
    const stand = create('cg-test-frame', options);
    made.push(stand);
    return stand;
  }));
  return made;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('[host:fansly] the relay frame of a Fansly tab (R20 P9c)', () => {
  it('[FX-001] [FS-NET-4] nothing until asked; asked, one hidden frame in a closed root in <html>, its address naming the tab’s account; asked again, the same frame', async () => {
    const frames = watchFrames();
    let account: string | null = '700000000000000001';
    const asked: string[] = [];
    const relay = createRelayFrame({
      doc: document,
      url: () => {
        asked.push('url');
        return Promise.resolve(URL_OF_PAGE);
      },
      account: () => account,
    });
    expect([relay.mounted(), document.querySelectorAll('div[data-host]').length, asked]).toEqual([false, 0, []]);
    const opened = relay.open();
    await settle();
    const hosts = [...document.documentElement.children].filter((node) => node.getAttribute('data-host') === 'overlay');
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.shadowRoot).toBeNull();
    expect(hosts[0]?.getAttribute('style')).toContain('position: fixed');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.getAttribute('src')).toBe(`${URL_OF_PAGE}#a=700000000000000001`);
    // The page sees nothing of ours in it: the frame is in the closed root.
    expect(document.querySelectorAll('iframe, cg-test-frame')).toHaveLength(0);
    frames[0]?.dispatchEvent(new Event('load'));
    expect(await opened).toBe('open');
    expect(await relay.open()).toBe('open');
    expect([frames.length, asked.length]).toEqual([1, 1]);
    relay.close();
    expect([relay.mounted(), document.querySelectorAll('div[data-host]').length]).toEqual([false, 0]);
    account = null;
    expect(await relay.open()).toBe('failed');
  });

  it('[FS-NET-4] the tab’s account changed: the frame of the old one goes at once; the next ask mounts one for the new account', async () => {
    const frames = watchFrames();
    let account = '700000000000000001';
    const relay = createRelayFrame({ doc: document, url: () => Promise.resolve(URL_OF_PAGE), account: () => account });
    const first = relay.open();
    await settle();
    account = '700000000000000002';
    relay.accountChanged();
    expect(relay.mounted()).toBe(false);
    expect(await first).toBe('failed');
    expect(frames[0]?.isConnected).toBe(false);
    void relay.open();
    await settle();
    expect(frames[1]?.getAttribute('src')).toBe(`${URL_OF_PAGE}#a=700000000000000002`);
    // The same account: nothing to change.
    relay.accountChanged();
    expect(relay.mounted()).toBe(true);
  });

  it('[FS-NET-4] no relay page in this build, a frame that never loads, a page address that cannot be had: no frame', async () => {
    watchFrames();
    expect(await createRelayFrame({ doc: document, url: undefined, account: () => '700000000000000001' }).open()).toBe('failed');
    vi.useFakeTimers();
    const slow = createRelayFrame({ doc: document, url: () => Promise.resolve(URL_OF_PAGE), account: () => '700000000000000001' });
    const opened = slow.open();
    await vi.advanceTimersByTimeAsync(RELAY_LOAD_TIMEOUT_MS + 1);
    expect([await opened, slow.mounted(), document.querySelectorAll('div[data-host]').length]).toEqual(['failed', false, 0]);
    const broken = createRelayFrame({ doc: document, url: () => Promise.reject(new Error('Extension context invalidated.')), account: () => '700000000000000001' });
    const refused = broken.open();
    await vi.advanceTimersByTimeAsync(0);
    expect([await refused, broken.mounted()]).toEqual(['failed', false]);
  });
});
