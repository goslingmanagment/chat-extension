// «Заметки»: who created the questionnaire and when, who changed it last (2026-10-29, the owner: «понимать кто и когда
// создавал анкетку»). The fan of the stand's first chat has a questionnaire a colleague (anna) created through the panel
// and another (max) changed; the line under «Анкета» names both. The chatter then writes a field: the line says «вы».
// `--site fansly`: the same on the Fansly stand.

import { createWorld } from '../../../fixture-fansly/src/data';
import { STAND_IDS } from '../../../src/stand/dataset';
import { PAGE, WORLD } from '../../../src/scenarios/hub';
import { callStand } from '../../support/stand';
import { fakeFansly } from '../../support/fansly-stand';
import { SEE_AI_TEXTS, around, scenario, type See } from '../kit';

const FAN = STAND_IDS.fans.a1;
const FANSLY_FAN = createWorld().groups[0]?.fan.id ?? '';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let fanslyForm = '';

async function panel(s: See, name: string): Promise<void> {
  await s.shot(name, { clip: around([await s.rect('panel', '.cg-notes')], 12) });
}

scenario(
  'notes-authors',
  async (s) => {
    await s.ready();
    if (s.site === 'chatspace') {
      await callStand('setSidePanel', 'open');
      const slot = s.browser.$('[data-host="header-slot"]');
      await slot.waitForExist({ timeout: 20_000 });
      await slot.shadow$('.cg-nb__button').click();
    } else await s.keys(s.MOD, s.Key.Shift, 'k');
    await s.see('panel', /Создана/, 20_000);
    await s.wait(500);
    await panel(s, 'colleagues');
    // The chatter writes a field: the questionnaire was changed by «вы» now.
    await (await s.h.ours('panel', '[data-notes-add="График"]')).click();
    await s.keys('пишет по вечерам');
    await s.keys(s.Key.Enter);
    await s.see('panel', /изменена[^·]*· вы/, 20_000);
    await s.wait(500);
    await panel(s, 'mine');
    // The write goes to the hub's record a few seconds later (the background batches its reports).
    await s.wait(4500);
  },
  {
    sites: ['chatspace', 'fansly'],
    viewport: { width: 1440, height: 1000 },
    timeout: 240_000,
    before: async ({ hub, site }) => {
      await hub.command({ op: 'config', patch: { aiTexts: SEE_AI_TEXTS, pageFlags: { [PAGE]: { notes: true, notesFill: true } } } });
      const now = Date.now();
      if (site === 'fansly') {
        const made = (await fakeFansly().command({ op: 'note', fanId: FANSLY_FAN, title: 'Анкета', note: 'Имя: Маркус\nЛокация: Техас, Остин\nВозраст: 41\nРабота: инженер на буровой\nХобби: рыбалка; барбекю', createdAt: now - 6 * DAY })) as { noteId: string };
        fanslyForm = made.noteId;
        const pageLabel = WORLD.pages.fansly.pageLabel;
        await hub.command({ op: 'noteWrite', pageLabel, fanRef: FANSLY_FAN, noteRef: fanslyForm, action: 'created', login: 'anna', at: new Date(now - 6 * DAY).toISOString() });
        await hub.command({ op: 'noteWrite', pageLabel, fanRef: FANSLY_FAN, noteRef: fanslyForm, action: 'edited', login: 'max', at: new Date(now - 2 * HOUR).toISOString() });
        return;
      }
      // The stand's questionnaire of fan a1 (note 8801, 14.02): anna created it, max changed it two hours ago.
      await hub.command({ op: 'noteWrite', pageLabel: PAGE, fanRef: FAN, noteRef: '8801', action: 'created', login: 'anna', at: '2026-02-14T18:20:00.000Z' });
      await hub.command({ op: 'noteWrite', pageLabel: PAGE, fanRef: FAN, noteRef: '8801', action: 'edited', login: 'max', at: new Date(now - 2 * HOUR).toISOString() });
    },
  },
);
