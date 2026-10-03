import { describe, expect, it } from 'vitest';

import type { BrowserApi } from './browser-api';
import { createExtensionPages } from './pages';
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
      },
    };
    expect(await createExtensionPages(older).open('options')).toEqual({ ok: true, reused: false });
    expect(fake.tabCalls).toEqual([`create ${fake.base}options.html`]);
  });
});
