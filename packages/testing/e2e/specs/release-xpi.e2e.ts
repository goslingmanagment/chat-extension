// R00 acceptance «XPI ставится временным дополнением в текущий Firefox» on the
// RELEASE XPI itself (the spike spec installs only the test build, which has
// another gecko id, no update_url, extra hosts and the spike chunk). No
// ChatSpace page is opened: the release build matches only the real origin.

import { TAB_PORT_NAME } from '@cg/contracts';
import { browser, expect } from '@wdio/globals';

import { E2E_RELEASE_ADDON_UUID, RELEASE_GECKO_ID } from '../support/constants';
import { installBuild } from '../support/extension';

interface PortLike {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}
type ExtensionApi = { runtime: { connect(options: { name: string }): PortLike } };

describe('release XPI', () => {
  it('installs as a temporary add-on under the release gecko id', async () => {
    expect(await installBuild('release')).toBe(RELEASE_GECKO_ID);
  });

  it('its popup page renders and its background answers the tab port as a release build', async () => {
    await browser.url(`moz-extension://${E2E_RELEASE_ADDON_UUID}/popup.html`);
    await expect($('#app')).toHaveText(expect.stringContaining('ChatGoose'));
    // From our own extension page (sender id = ours, top frame): the same
    // hello a content script sends; the event page wakes up and answers.
    const status = await browser.execute(async (portName) => {
      const api = (globalThis as unknown as { browser?: ExtensionApi }).browser;
      if (api?.runtime === undefined) return 'no extension API on this page';
      return new Promise<unknown>((resolve) => {
        setTimeout(() => resolve('no answer from the background in 5 s'), 5000);
        const port = api.runtime.connect({ name: portName });
        port.onMessage.addListener((message) => {
          resolve(message);
          port.disconnect();
        });
        port.onDisconnect.addListener(() => resolve('disconnected'));
        port.postMessage({ t: 'hello', v: 1 });
      });
    }, TAB_PORT_NAME);
    expect(status).toEqual({ t: 'status', v: 1, wsTapRegistered: false, testBuild: false });
  });
});
