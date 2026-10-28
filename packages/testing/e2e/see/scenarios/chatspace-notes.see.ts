// «Заметки» on ChatSpace (2026-10-28): the same panel as Fansly's, over OnlyMonster's own fan notes. The fan of the
// stand's first chat has what the team keeps in Monster: an older questionnaire of «Поле: значение» lines (the table)
// and its section notes («Важная информация» in red, «Характеристика», «Фетиши») in the list, «общие с Монстром».
// «Заметки 4» in the chat header before ChatSpace's search; the panel over the chat's right edge; «✨ Дополнить из
// чата» with the Goose's suggestions in the rows, one ✓, «Принять все»; a quick note signed with the login. On the
// stand alone: a note a colleague changed in Monster while it was open here.

import { STAND_IDS } from '../../../src/stand/dataset';
import { PAGE } from '../../../src/scenarios/hub';
import { SEE_AI_TEXTS, around, scenario, type See } from '../kit';

const ACC = STAND_IDS.accounts.a;
const FAN = STAND_IDS.fans.a1;

/** The hub's answer to «Дополнить из чата» (`fan-notes-fill`): the questionnaire's labels, then the template's it lacks. */
const FILL = [
  'Имя: =',
  'Локация: Манчестер, район Дидсбери (10.2026)',
  '> «I live in Didsbury, south Manchester»',
  'Возраст: =',
  'Работа: инженер-строитель, всю неделю на объекте в Лидсе (10.2026)',
  '> «on a site in Leeds all week, back on Friday»',
  'Хобби: футбол, болеет за «Сити»; спортзал по утрам',
  '> «City till I die 💙»',
  'График: пишет по вечерам после смены (10.2026)',
  '> «just got home from the site»',
  'Планы и даты: на Рождество едет к брату в Дублин (10.2026)',
  '> «Dublin for Christmas with my brother»',
  'Фетиши: =',
  'Характеристика: спокойный, с юмором, любит, когда его хвалят',
  '> «you always make me laugh»',
  'Медиа: купил сет «Morning» за $25 (10.2026)',
  'Другое: =',
];
const QUICK = 'обещал прислать фото с матча в субботу';

/** The panel alone, a little room around it. */
async function panel(s: See, name: string): Promise<void> {
  await s.shot(name, { clip: around([await s.rect('panel', '.cg-notes')], 12) });
}

scenario(
  'chatspace-notes',
  async (s) => {
    await s.ready();
    // The button in ChatSpace's own chat header, before its search (our slot is a host of its own in the header row).
    const slot = s.browser.$('[data-host="header-slot"]');
    await slot.waitForExist({ timeout: 20_000 });
    const button = slot.shadow$('.cg-nb__button');
    await button.waitForDisplayed({ timeout: 20_000 });
    await s.wait(300);
    const boxes = [await s.rect('page', '[data-host="header-slot"]'), await s.rect('page', '[data-testid="conversation-header-search-button"]')].filter((box) => box !== null);
    await s.shot('header', { clip: around(boxes, 80) });

    await button.click();
    await s.see('panel', /Анкета/);
    await s.wait(500);
    await s.shot('panel-over-chat');
    await panel(s, 'read');

    // «✨ Дополнить из чата»: the stage line, then the Goose's suggestions in their rows.
    await s.hub.command({ op: 'config', patch: { aiChunkDelayMs: 120, aiThinkMs: 4000 } });
    await s.press(/Дополнить из чата/, 'panel');
    await s.see('panel', /Читаю переписку|Собираю переписку/);
    await s.wait(600);
    await panel(s, 'fill-reading');
    await s.see('panel', /Гусь предлагает/, 60_000);
    await s.wait(500);
    await panel(s, 'fill-found');
    await (await s.h.ours('panel', '[data-notes-field="Локация"] [data-notes-accept]')).click();
    await s.see('panel', /Записано: Локация/);
    await s.wait(500);
    await panel(s, 'fill-accepted');
    await s.press(/^Принять все/, 'panel');
    await s.see('panel', /Анкета дополнена/);
    await s.wait(600);
    await panel(s, 'fill-written');

    // A quick note: a line and Enter, signed with the chatter's login.
    await (await s.h.ours('panel', '[data-notes-quick] textarea')).click();
    await s.keys(QUICK);
    await s.keys(s.Key.Enter);
    await s.wait(800);
    await (await s.h.ours('panel', '.cg-notes__list')).scrollIntoView({ block: 'start' });
    await s.wait(300);
    await panel(s, 'notes-list');

    // What Monster keeps now: the questionnaire and the quick note are its own notes (the stand's API).
    const kept = await s.stand.notes(ACC, FAN);
    console.log(`cg-see monster notes: ${kept.map((note) => `${String(note['id'])}:${String(note['title'] ?? '')}`).join(', ')}`);

    // A colleague changed «Характеристика» in Monster's own tab while it was open here: their version is shown under the
    // draft, nothing is lost, and «Сохранить» writes over it only when pressed again.
    const character = kept.find((note) => note['title'] === 'Характеристика');
    if (character === undefined) return;
    const id = String(character['id']);
    await (await s.h.ours('panel', `[data-note-id="${id}"]`)).scrollIntoView({ block: 'center' });
    await (await s.h.ours('panel', `[data-note-id="${id}"]`)).moveTo();
    await (await s.h.ours('panel', `[data-note-id="${id}"] button[aria-label="Изменить"]`)).click();
    const area = await s.h.ours('panel', '[data-notes-editor] textarea');
    await area.click();
    await s.keys(s.MOD, s.Key.ArrowDown);
    await s.keys(s.Key.Shift, s.Key.Enter);
    await s.keys('Не любит голосовые');
    await s.stand.editNote(ACC, FAN, Number(character['id']), { note: `${String(character['note'])}\nДень рождения 12 мая` });
    await s.press(/^Сохранить/, 'panel', '[data-notes-save]');
    await s.see('panel', /Сейчас в Монстре/);
    await s.wait(300);
    await panel(s, 'changed-elsewhere');
  },
  {
    sites: ['chatspace'],
    viewport: { width: 1440, height: 1000 },
    timeout: 240_000,
    before: async ({ hub, stand }) => {
      await hub.command({
        op: 'config',
        patch: {
          aiTexts: { ...SEE_AI_TEXTS, 'fan-notes-fill': FILL.join('\n') },
          pageFlags: { [PAGE]: { notes: true, notesFill: true } },
        },
      });
      // «Важная информация» red in Monster, as a chatter may mark it; the notes keep their ids and dates.
      const important = (await stand.notes(ACC, FAN)).find((note) => note['title'] === 'Важная информация');
      if (important !== undefined) await stand.editNote(ACC, FAN, Number(important['id']), { color: '#480a09' });
    },
  },
);
