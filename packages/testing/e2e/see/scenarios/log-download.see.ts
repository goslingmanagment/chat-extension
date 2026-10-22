// log-download: Hi stays on in a long chat (no message limit); Ping goes off in a short chat (fewer than ten messages,
// ping-few), Ping is pressed by a click and by its key, then «Скачать лог» in the popup (the dock has no such button since
// 2026-10-22: the owner's word).

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
    // A long chat (a1, forty messages): Hi and Ping are both on — Hi has no message limit.
    await s.h.dockIs((dock) => dock.actions['hi'] === true && dock.actions['ping'] === true, 'Hi and Ping are on in a long chat');
    await s.shot('long-chat');
    // A short chat (a2, fewer than ten messages, its whole history loaded): Ping is off (ping-few), Hi is on.
    await s.openChat(s.ids.fans.a2);
    await s.ready();
    await s.h.dockIs((dock) => dock.actions['ping'] === false && dock.actions['hi'] === true, 'Ping is off in a short chat (ping-few)');
    await s.shot('short-chat-ping-off');
    // The click on the dimmed Ping and its key: nothing starts, the log says why.
    await s.press(/^Ping/);
    await s.leaveField();
    await s.keys(s.MOD, 'p');
    await s.wait(600);
    await s.shot('ping-key-refused');
    await s.openChat(s.ids.fans.a1);
    await s.ready();
    // The popup's «Скачать лог».
    await s.toPages();
    await openPopup();
    await waitForPopup((state) => state.view === 'ready', 'the popup of a signed-in person');
    await s.shot('popup');
    await press('Скачать лог');
    await s.browser.waitUntil(() => files().filter((name) => name.endsWith('.txt')).length >= 1 && files().filter((name) => name.endsWith('.json')).length >= 1, { timeout: 30_000, timeoutMsg: 'the popup saved the log files' });
    await s.shot('popup-saved');
    await s.toChat();
    const txt = files().filter((name) => name.endsWith('.txt'));
    console.log(`cg-see downloads: ${files().join(', ')}`);
    const first = txt[0];
    if (first !== undefined) {
      const body = readFileSync(join(downloads, first), 'utf8');
      console.log(`cg-see txt lines with Ping: ${String(body.split('\n').filter((line) => line.includes('Ping')).length)}`);
    }
  },
  { timeout: 240_000 },
);
