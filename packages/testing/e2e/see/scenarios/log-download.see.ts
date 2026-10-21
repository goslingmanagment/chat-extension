// log-download: Hi goes off in a chat that is already a dialog (hi-gate), Hi is pressed by a click and by its key, then «Скачать лог» in the dock and in the popup.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { openPopup, press, waitForPopup } from '../../support/pages';
import { scenario } from '../kit';

scenario(
  'log-download',
  async (s) => {
    const downloads = join(s.out, 'downloads');
    const files = (): string[] => (existsSync(downloads) ? readdirSync(downloads).filter((name) => !name.endsWith('.part')) : []);
    await s.ready();
    // A generation, for the operations' lines of the log.
    await s.press(/^Reply/);
    await s.done();
    // A dialog already: the fan writes until the loaded window holds more than Hi's ten messages.
    for (let i = 0; i < 14; i += 1) {
      const dock = await s.dock();
      if (dock?.actions['hi'] === false) break;
      await s.stand.fanMessage(s.ids.accounts.a, s.ids.fans.a1, `synthetic line ${String(i + 1)}`);
      await s.wait(250);
    }
    await s.h.dockIs((dock) => dock.actions['hi'] === false, 'Hi is off in this chat (hi-gate)');
    await s.shot('hi-off');
    // The click on the dimmed Hi and its key: nothing starts, the log says why.
    await s.press(/^Hi/);
    await s.leaveField();
    await s.keys(s.MOD, 'g');
    await s.wait(600);
    await s.shot('hi-key-refused');
    // Another chat (a new fan): the route, and the dock's first look at that chat.
    await s.openChat(s.ids.fans.a2);
    await s.ready();
    await s.openChat(s.ids.fans.a1);
    await s.ready();
    // «Скачать лог» at the bar's right end.
    const button = await s.h.ours('dock', '.cg-log');
    await button.moveTo();
    await s.wait(700);
    await s.shot('log-button');
    await s.press(/^Скачать лог/);
    await s.browser.waitUntil(() => files().filter((name) => name.endsWith('.txt')).length >= 1 && files().filter((name) => name.endsWith('.json')).length >= 1, { timeout: 30_000, timeoutMsg: 'the dock saved the log files' });
    await s.wait(800);
    await s.shot('log-saved');
    // The popup's «Скачать лог».
    await s.toPages();
    await openPopup();
    await waitForPopup((state) => state.view === 'ready', 'the popup of a signed-in person');
    await s.shot('popup');
    const before = files().length;
    await press('Скачать лог');
    await s.browser.waitUntil(() => files().length >= before + 2, { timeout: 30_000, timeoutMsg: 'the popup saved the log files' });
    await s.shot('popup-saved');
    await s.toChat();
    const txt = files().filter((name) => name.endsWith('.txt'));
    console.log(`cg-see downloads: ${files().join(', ')}`);
    const first = txt[0];
    if (first !== undefined) {
      const body = readFileSync(join(downloads, first), 'utf8');
      console.log(`cg-see txt lines with Hi: ${String(body.split('\n').filter((line) => line.includes('Hi')).length)}`);
    }
  },
  { timeout: 240_000 },
);
