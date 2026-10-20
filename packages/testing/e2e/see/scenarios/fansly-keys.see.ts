// Fansly's keys as in the old extension: ⌘E under a modal of Fansly, ⌘E over a finished Review in its window,
// ⌘⇧H — Coach with «разбор ситуации», ⌘E from the mini-chat's field.

import { callFansly } from '../../support/fansly-stand';
import { scenario } from '../kit';

scenario(
  'fansly-keys',
  async (s) => {
    await s.ready();
    // A modal of Fansly (its media viewer) stands over the chat: ⌘E still starts Reply.
    await callFansly('setMediaViewer', true);
    await s.keys(s.MOD, 'e');
    await s.done();
    await s.shot('reply-under-fansly-modal');
    await callFansly('setMediaViewer', false);

    // A finished Review in its window: ⌘E closes it and starts Reply.
    await s.press(/^Review/);
    await s.see('modal', 'the conversation is alive', 30_000);
    await s.shot('review-finished');
    // The fan writes meanwhile: the Reply is a new one, not the first one reopened.
    const { groupId } = await callFansly('route');
    if (groupId === null) throw new Error('no chat is open');
    await callFansly('fanMessage', groupId, 'are you still there?');
    await s.wait(1500);
    // The pointer off the strip: no stale tooltip in the picture.
    await s.browser.action('pointer').move({ x: 760, y: 300 }).perform();
    await s.keys(s.MOD, 'e');
    await s.done();
    await s.shot('reply-over-review');

    // ⌘⇧H / Ctrl+Alt+H: Coach opens and asks «разбор ситуации».
    await s.keys(...s.PANEL, 'h');
    await s.see('panel', 'Yes, but not as the first message', 40_000);
    await s.shot('help-coach');

    // Another field of the page — the mini-chat's — has the focus: ⌘E still writes the open chat's Reply into the dock.
    await s.closeAll();
    const other = (await callFansly('groups')).find((group) => group.id !== groupId);
    if (other === undefined) throw new Error('the stand has one chat');
    await callFansly('setMiniChat', other.id);
    await callFansly('fanMessage', groupId, 'hello?? 🙈');
    await s.wait(1500);
    await s.h.$('app-messaging-overlay textarea.message-input').click();
    await s.keys(s.MOD, 'e');
    await s.done();
    await s.shot('reply-from-mini-chat');
  },
  { sites: ['fansly'] },
);
