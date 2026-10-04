import { describe, expect, it } from 'vitest';

import type { BrowserApi } from './browser-api';
import { createExtensionPages, createLinkOpener, createTabFocus } from './pages';
import { createFakeBrowser, pageSender } from './test-support/fake-browser';

describe('[ST-006] one settings tab: our pages are reused, never opened twice', () => {
  it('focuses the options tab already open (and points it at the section), else opens it', async () => {
    const fake = createFakeBrowser();
    const background = fake.startBackground().api;
    const pages = createExtensionPages(background);
    // Nothing open: the browser's own options opener (it reuses its tab too).
    expect(await pages.open('options')).toEqual({ ok: true, reused: false });
    // With a section: a new tab at that section.
    expect(await pages.open('options', '#accounts')).toEqual({ ok: true, reused: false });
    expect(fake.tabCalls).toEqual(['openOptionsPage', `create ${fake.base}options.html#accounts`]);
    fake.tabCalls.length = 0;
    // The options page is open in tab 41 (showing another section): reused, focused, moved to the section.
    fake.context(pageSender(fake, 'options', { url: `${fake.base}options.html#status`, tab: { id: 41 }, frameId: 0 }));
    expect(await pages.open('options', 'personas')).toEqual({ ok: true, reused: true });
    expect(await pages.open('options')).toEqual({ ok: true, reused: true });
    expect(fake.tabCalls).toEqual([`update 41 ${fake.base}options.html#personas`, 'focus window 1', 'update 41', 'focus window 1']);
    fake.tabCalls.length = 0;
    // Another page is not the options page.
    expect(await pages.open('debug-journal')).toEqual({ ok: true, reused: false });
    expect(fake.tabCalls).toEqual([`create ${fake.base}debug-journal.html`]);
  });

  it('never throws: a browser failure is { ok: false }; without getContexts it opens a tab', async () => {
    const fake = createFakeBrowser();
    const api = fake.startBackground().api;
    const broken: BrowserApi = { ...api, tabs: { ...api.tabs, create: () => Promise.reject(new Error('no')) } };
    expect(await createExtensionPages(broken).open('debug-journal')).toEqual({ ok: false });
    const real = api.runtime;
    // A runtime without getContexts and openOptionsPage.
    const older: BrowserApi = {
      ...api,
      runtime: {
        id: real.id,
        getURL: (path) => real.getURL(path),
        getManifest: () => real.getManifest(),
        getPlatformInfo: () => real.getPlatformInfo(),
        connect: (info) => real.connect(info),
        sendMessage: (message) => real.sendMessage(message),
        onConnect: real.onConnect,
        onMessage: real.onMessage,
        onInstalled: real.onInstalled,
        onStartup: real.onStartup,
        onSuspend: real.onSuspend,
        onSuspendCanceled: real.onSuspendCanceled,
      },
    };
    expect(await createExtensionPages(older).open('options')).toEqual({ ok: true, reused: false });
    expect(fake.tabCalls).toEqual([`create ${fake.base}options.html`]);
  });
});

describe('a ChatSpace tab brought to the front', () => {
  it('[ST-076] the tab becomes the active one and its window comes forward; nothing is created or navigated', async () => {
    const fake = createFakeBrowser();
    const focus = createTabFocus(fake.startBackground().api);
    expect(await focus.focus(7)).toBe(true);
    expect(fake.tabCalls).toEqual(['update 7', 'focus window 1']);
  });

  it('never throws: a tab that is gone is `false`, and a window that will not come forward does not undo the tab', async () => {
    const fake = createFakeBrowser();
    const api = fake.startBackground().api;
    fake.closedTabs.add(9);
    expect(await createTabFocus(api).focus(9)).toBe(false);
    const stubborn: BrowserApi = { ...api, windows: { update: () => Promise.reject(new Error('no')) } };
    expect(await createTabFocus(stubborn).focus(7)).toBe(true);
  });
});

describe('a link of ours to the open web', () => {
  it('[ST-005] [ST-050] opens an https address in a new tab on the click; anything else opens nothing', () => {
    const fake = createFakeBrowser();
    const links = createLinkOpener(fake.context(pageSender(fake, 'options')).api);
    expect(links.open('https://ext.example.test/chat-extension/whats-new.html')).toBe(true);
    expect(fake.tabCalls).toEqual(['create https://ext.example.test/chat-extension/whats-new.html']);
    fake.tabCalls.length = 0;
    for (const refused of ['http://ext.example.test/', 'javascript:alert(1)', 'moz-extension://x/options.html', 'https://user:secret@ext.example.test/', 'not an address', '']) {
      expect(links.open(refused)).toBe(false);
    }
    expect(fake.tabCalls).toEqual([]);
  });

  it('never throws: a browser that refuses the tab still answers', () => {
    const fake = createFakeBrowser();
    const api = fake.context(pageSender(fake, 'popup')).api;
    const rejecting: BrowserApi = { ...api, tabs: { ...api.tabs, create: () => Promise.reject(new Error('no')) } };
    expect(createLinkOpener(rejecting).open('https://ext.example.test/')).toBe(true);
    const throwing: BrowserApi = {
      ...api,
      tabs: {
        ...api.tabs,
        create: () => {
          throw new Error('no');
        },
      },
    };
    expect(createLinkOpener(throwing).open('https://ext.example.test/')).toBe(false);
  });
});
