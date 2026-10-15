// A cold headless audio device can take longer to open than the player's
// 1.5 s notification deadline. Establish the real device through the same
// preview as «Проверить звук» before asserting incoming-message decisions.
import { browser } from '@wdio/globals';

import { pageRpc } from './extension';
import { testBuildPage } from './fake-hub';

export async function prepareSound(): Promise<void> {
  await browser.url(testBuildPage('options.html'));
  await browser.waitUntil(async () => {
    const answer = await pageRpc<{ played: boolean }>('sound.preview', { tone: 'chime', volume: 50 });
    return answer.ok && answer.payload.played;
  }, { timeout: 10_000, interval: 250, timeoutMsg: 'the real background AudioContext did not play the sound preview' });
}
