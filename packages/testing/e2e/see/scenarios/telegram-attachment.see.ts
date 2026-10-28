// Telegram: the attachment window is open: Reply is written, but not put in: «Окно вложения открыто: вставьте текст в
// подпись сами или закройте окно» with «Копировать»; neither field changes.

import { callTelegram } from '../../support/telegram-stand';
import { lap, scenario } from '../kit';
import { facts, shown } from '../telegram';

scenario(
  'telegram-attachment',
  async (s) => {
    await s.ready();
    await callTelegram('typeInField', 'my caption');
    await callTelegram('openAttachment');
    await s.wait(400);
    await s.shot('attachment-open');
    // Reply by its key (⌘E / Ctrl+E): the window covers the page; the dock's button if the key did not start it.
    const before = (await s.dock())?.result?.opId ?? null;
    await s.keys(s.MOD, 'e');
    const started = await s.h
      .dockIs((d) => d.result !== null && d.result.opId !== before, 'Reply started by its key', 3000)
      .then(() => true)
      .catch(() => false);
    if (!started) await s.press(/^Reply/);
    await s.done();
    await shown(s, 'dock', 'Окно вложения открыто: вставьте текст в подпись сами или закройте окно');
    await s.shot('reply-under-attachment');
    lap(`caption ${JSON.stringify(await callTelegram('captionText'))}`);
    await facts('attachment open');
    await callTelegram('closeAttachment');
    await s.wait(500);
    await s.shot('attachment-closed');
    await facts('attachment closed');
  },
  { sites: ['telegram'] },
);
