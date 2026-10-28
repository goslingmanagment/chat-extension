// Telegram: keys pressed in our UI never reach Telegram. Letters then Enter in a text field of ours (a part's
// «Править»): nothing is sent and the focus stays ours; Enter and a letter on a dock button: nothing is sent, the focus
// does not jump into Telegram's field.

import { lap, scenario } from '../kit';
import { facts, focusOwner, pressIfShown, sends } from '../telegram';

scenario(
  'telegram-keys',
  async (s) => {
    await s.ready();
    // Telegram's field holds a draft: an Enter that reached Telegram would send it.
    await s.type('draft that must stay');
    await s.press(/^Reply/);
    await s.done();
    // A text field of ours: the part's editor.
    if (await pressIfShown(s, /^Править/, 'dock', '[data-cg-part="0"] button')) {
      await s.wait(300);
      lap(`focus after «Править»: ${await focusOwner()}`);
      await s.keys('hello');
      await s.keys(s.Key.Enter);
      await s.wait(500);
      await s.shot('typed-in-our-field');
      await facts('letters and Enter in our field');
      await s.keys(s.Key.Escape);
    }
    // A dock button with the focus: Enter, then a letter.
    const button = await s.h.ours('dock', '.cg-strip button');
    await s.browser.execute((element: HTMLElement) => element.focus(), button as unknown as HTMLElement);
    lap(`focus on a dock button: ${await focusOwner()}`);
    await s.keys(s.Key.Enter);
    await s.wait(500);
    await facts('Enter on a dock button');
    await s.browser.execute((element: HTMLElement) => element.focus(), (await s.h.ours('dock', '.cg-strip button')) as unknown as HTMLElement);
    await s.keys('k');
    await s.wait(300);
    await facts('a letter on a dock button');
    await s.shot('after-keys');
    lap(`sends: ${(await sends()).length}`);
  },
  { sites: ['telegram'] },
);
