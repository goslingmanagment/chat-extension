// The extension's own pages: the popup and the settings (Status, Appearance and sound, Generation).

import { openOptions, openPopup, waitForOptions, waitForPopup } from '../../support/pages';
import { scenario } from '../kit';

scenario(
  'pages',
  async (s) => {
    await s.ready();
    await s.toPages();
    await openPopup();
    await waitForPopup((state) => state.view === 'ready', 'the popup of a signed-in person');
    await s.shot('popup');
    await openOptions('status');
    await waitForOptions((state) => state.section === 'status' && !state.loading && Object.keys(state.rows).length > 0, 'the Status section with its rows');
    await s.shot('options-status');
    for (const section of ['appearance', 'generation'] as const) {
      await openOptions(section);
      await waitForOptions((state) => state.section === section && !state.loading, section);
      await s.shot(`options-${section}`);
    }
    await s.browser.url(s.page('debug-journal.html'));
    await s.toChat();
  },
  { sites: ['chatspace', 'fansly'] },
);
