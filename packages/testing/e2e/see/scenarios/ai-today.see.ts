// A person without an own daily AI limit (the owner's own accounts): the popup's «ИИ сегодня» says what AI cost them
// today over all pages and «без лимита», from the first frame of the popup.

import { openPopup, waitForPopup } from '../../support/pages';
import { scenario } from '../kit';

scenario(
  'ai-today',
  async (s) => {
    await s.ready();
    await s.wait(1500);
    await s.toPages();
    await openPopup();
    await waitForPopup((state) => state.view === 'ready', 'the popup of a signed-in person');
    await s.shot('popup-no-limit');
  },
  { sites: ['chatspace', 'fansly'] },
);
