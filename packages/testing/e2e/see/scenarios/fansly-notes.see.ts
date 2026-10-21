// Fansly «Заметки»: a note longer than the panel holds (cut, read-only), and an edit after someone else changed the note —
// Fansly's version shown under the draft, then «Сохранить» writes over it (audit №13).

import { createWorld } from '../../../fixture-fansly/src/data';
import { fakeFansly } from '../../support/fansly-stand';
import { scenario } from '../kit';

const world = createWorld();
const FAN = world.groups[0]!.fan.id;
const LONG = Array.from({ length: 1400 }, (_, i) => `${String(i + 1)}. Фан рассказывал про поездку, работу и кота — запись FBuddy-синка без пометки.`).join('\n');
let noteId = '';

scenario(
  'fansly-notes',
  async (s) => {
    await s.ready();
    await s.keys(s.MOD, s.Key.Shift, 'k');
    await s.see('panel', /Длинная/);
    await s.shot('long-note');
    await s.press('Изменить', 'panel', `[data-note-id="${noteId}"] button`);
    const area = await s.h.ours('panel', '[data-notes-editor] textarea');
    await area.click();
    await s.keys(s.Key.End);
    await s.keys(' Любит суши.');
    await fakeFansly().command({ op: 'note-edit', noteId, note: 'Живёт в Риге. Коллега дописал: день рождения 12 мая.' });
    await s.press(/^Сохранить/, 'panel', '[data-notes-save]');
    await s.see('panel', /Сейчас в Fansly/);
    await s.shot('changed-latest');
    await s.press(/^Сохранить/, 'panel', '[data-notes-save]');
    await s.wait(800);
    await s.shot('saved-over');
  },
  {
    sites: ['fansly'],
    before: async () => {
      noteId = (await fakeFansly().command({ op: 'note', fanId: FAN, title: 'О фане', note: 'Живёт в Риге.' }) as { noteId: string }).noteId;
      await fakeFansly().command({ op: 'note', fanId: FAN, title: 'Старая история', note: LONG });
    },
  },
);
