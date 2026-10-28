// Telegram: the person types in the field while Reply is written; «Вставить» then replaces their text at the click
// (decision X45: the click is the consent, a CAS on the draft read at the click), and one ⌘Z in the field brings it back.

import { lap, scenario } from '../kit';
import { composerShot, facts } from '../telegram';

const FIELD = '.messages-layout > .Transition > .Transition_slide-active #editable-message-text';

scenario(
  'telegram-draft-edited',
  async (s) => {
    await s.ready();
    await s.press(/^Reply/);
    await s.wait(300);
    await s.type('wait, one more thing');
    await s.done();
    await s.shot('reply-over-human-text');
    await s.press(/^Вставить/, 'dock', '[data-cg-part="0"] button');
    await s.wait(800);
    await composerShot(s, 'replaced-at-the-click');
    await facts('after «Вставить»');
    await (await s.browser.$(FIELD)).click();
    await s.browser.keys([s.Key.Command, 'z']);
    await s.wait(400);
    await composerShot(s, 'undo-brings-it-back');
    await facts('after ⌘Z');
    lap(`the dock: ${JSON.stringify((await s.dock())?.result ?? null)}`);
  },
  {
    sites: ['telegram'],
    before: async (s) => {
      await s.hub.command({ op: 'config', patch: { aiThinkMs: 2500 } });
    },
  },
);
