// Fansly «Заметки» on one screen (2026-10-26): the questionnaire as a table, a field edited in place and written with
// Enter, «+ Метка», «✨ Дополнить из чата» (2026-10-27, «Подсказки прямо в строках»: its stage line, the Goose's
// suggestions in their rows, the fan's words on hover, one ✓ and its «Отменить», a suggestion put aside, «Принять
// все», the ✦ of what was written), a quick note, a note longer than the panel holds, and a note's edit after someone
// else changed it (Fansly's version shown under the draft, then «Сохранить» writes over it, audit №13). Each picture is
// the panel alone.

import { createWorld } from '../../../fixture-fansly/src/data';
import { fakeFansly } from '../../support/fansly-stand';
import { SHOWCASE } from '../../../src/showcase';
import { SEE_AI_TEXTS, around, scenario, showcaseAiTexts, type See } from '../kit';

const world = createWorld();
const FAN = world.groups[0]!.fan.id;
const DAY = 86_400_000;

/** The fan's questionnaire, the hub's answer to «Дополнить из чата» (its format, `fan-notes-fill`: a rewrite of
 * «Локация», additions, a field it names itself) and two notes: the stand's Trey, or the showcase's Jamie. */
const DATA = SHOWCASE
  ? {
      name: '💛Jamie/Chicago/34',
      form: ['Имя: Джейми', 'Локация: Чикаго (10.2026)', 'Возраст: 34', 'Работа: консультант, много летает по работе (10.2026)', 'График: отвечает по вечерам (10.2026)', 'Хобби: кофе; путешествия', 'Планы и даты: ', 'Фетиши: ', 'Характеристика: ', 'Медиа: ', 'Другое: '],
      fill: [
        'Имя: =',
        'Локация: Чикаго, Линкольн-Парк (10.2026)',
        '> «I live in Lincoln Park, love it here»',
        'Возраст: =',
        'Работа: =',
        'График: отвечает по вечерам (10.2026); в выходные часто в самолёте (10.2026)',
        '> «weekends I\'m usually on a plane»',
        'Хобби: =',
        'Планы и даты: вернулся из Денвера, в ноябре летит в Лиссабон (10.2026)',
        '> «just landed! Lisbon in November»',
        'Фетиши: =',
        'Характеристика: внимательный, любит короткие сообщения и вопросы про поездки',
        '> «you always know what to ask»',
        'Медиа: купил сет «Morning» за $25 (10.2026)',
        'Другое: спрашивал, какой кофе вы пьёте',
        '> «so what coffee do you drink?»',
        '+ Напитки: капучино без сахара',
        '> «cappuccino, no sugar, every single morning»',
      ],
      notes: ['обещал оставить чаевые после рейса', 'Любит, когда ему пишут первым.'],
      changed: 'Любит, когда ему пишут первым. Коллега дописал: день рождения 12 мая.',
      quick: 'просил напомнить про второй сет в пятницу',
      age: '35',
    }
  : {
      name: '🟡Trey/US/30',
      form: [
        'Имя: Трей',
        'Локация: США (10.2026)',
        'Возраст: 30',
        'Работа: физиотерапевт у профессиональных и олимпийских спортсменов, раньше ездил с ними на соревнования (10.2026)',
        'График: всегда занят (10.2026)',
        'Хобби: тренировки; гольф; сноуборд; аниме, любимое attack on titan; готовка, больше всего паста',
        'Планы и даты: ',
        'Фетиши: ',
        'Характеристика: ',
        'Медиа: ',
        'Другое: ',
      ],
      fill: [
        'Имя: =',
        'Локация: США, Огайо (10.2026)',
        '> «I\'m from Ohio, Columbus area»',
        'Возраст: =',
        'Работа: =',
        'График: всегда занят (10.2026); по выходным свободнее, пишет вечером (10.2026)',
        '> «weekends are better for me, evenings mostly»',
        'Хобби: =',
        'Планы и даты: свадьба друга в другом штате, едет домой на машине (10.2026)',
        '> «the wedding was in another state so we\'re driving home now»',
        'Фетиши: =',
        'Характеристика: шутливый, отвечает коротко, любит, когда его дразнят',
        '> «Hahaha I was hoping you forgot»',
        'Медиа: купил сет «Morning» за $25 (10.2026)',
        'Другое: обещал подписаться на $50 через пару дней',
        '> «I\'ll sub for 50 in a couple days»',
        '+ Питомцы: собака, лабрадор Макс',
        '> «my lab Max is jealous lol»',
      ],
      notes: ['сказал, что подпишется на $50 через пару дней', 'Живёт в Огайо.'],
      changed: 'Живёт в Огайо. Коллега дописал: день рождения 12 мая.',
      quick: 'обещал прислать фото своей собаки',
      age: '31',
    };
const NEW_FIELD = SHOWCASE ? 'Напитки' : 'Питомцы';

const LONG = Array.from({ length: 1400 }, (_, i) => `${String(i + 1)}. Фан рассказывал про поездку и работу: запись FBuddy-синка без пометки.`).join('\n');
let edited = '';

/** The panel alone, a little room around it. */
async function panel(s: See, name: string): Promise<void> {
  await s.shot(name, { clip: around([await s.rect('panel', '.cg-notes')], 12) });
}

scenario(
  'fansly-notes',
  async (s) => {
    await s.ready();
    await s.keys(s.MOD, s.Key.Shift, 'k');
    await s.see('panel', /Анкета/);
    await (await s.h.ours('panel', 'button[aria-label="Где показывать"]')).click();
    await s.press('Окно по центру', 'panel');
    await s.wait(400);
    await panel(s, 'read');
    await (await s.h.ours('panel', '[data-notes-field="Работа"]')).moveTo();
    await s.wait(300);
    await panel(s, 'row-hover');

    // «✨ Дополнить из чата»: the stage line, then the Goose's suggestions in their rows.
    await s.hub.command({ op: 'config', patch: { aiChunkDelayMs: 120 } });
    await s.press(/Дополнить из чата/, 'panel');
    await s.see('panel', /Читаю переписку|Заполняю анкету/);
    await s.wait(600);
    await panel(s, 'fill-running');
    await s.see('panel', /Гусь предлагает/, 60_000);
    await s.wait(500);
    await panel(s, 'fill-found');
    await (await s.h.ours('panel', '[data-notes-field="Локация"] .cg-notes__pill-t')).moveTo();
    await s.wait(300);
    await panel(s, 'fill-quote');
    await (await s.h.ours('panel', '[data-notes-field="Локация"] [data-notes-accept]')).click();
    await s.see('panel', /Записано: Локация/);
    await s.wait(500);
    await panel(s, 'fill-accepted');
    await (await s.h.ours('panel', `[data-notes-field="${NEW_FIELD}"] [data-notes-dismiss]`)).click();
    await s.wait(300);
    await s.press(/^Принять все/, 'panel');
    await s.see('panel', /Анкета дополнена/);
    await s.wait(600);
    await panel(s, 'fill-written');

    // A field in place, and a «+ Метка».
    await s.press(/^Возраст/, 'panel', '[data-notes-field="Возраст"]');
    await s.wait(300);
    await s.keys(s.Key.Backspace, s.Key.Backspace, DATA.age);
    await panel(s, 'field-edit');
    await s.keys(s.Key.Enter);
    await s.wait(600);
    await s.press(/Фетиши/, 'panel', '[data-notes-add="Фетиши"]');
    await s.wait(300);
    await s.keys('любит, когда его дразнят');
    await panel(s, 'field-add');
    await s.keys(s.Key.Enter);
    await s.wait(600);

    // A quick note: a line and Enter.
    await (await s.h.ours('panel', '[data-notes-quick] textarea')).click();
    await s.keys(DATA.quick);
    await s.wait(200);
    await (await s.h.ours('panel', '[data-notes-quick]')).scrollIntoView({ block: 'center' });
    await panel(s, 'quick-typed');
    await s.keys(s.Key.Enter);
    await s.wait(600);
    await (await s.h.ours('panel', '.cg-notes__list')).scrollIntoView({ block: 'end' });
    await s.wait(200);
    await panel(s, 'quick-saved');

    // The checks of the stand alone (no picture for chatters): a note someone else changed while it was open here —
    // Fansly's version under the draft, «Сохранить» writes over it —, and a note longer than the panel holds.
    if (SHOWCASE) return;
    await (await s.h.ours('panel', `[data-note-id="${edited}"]`)).moveTo();
    await (await s.h.ours('panel', `[data-note-id="${edited}"] button[aria-label="Изменить"]`)).click();
    const area = await s.h.ours('panel', '[data-notes-editor] textarea');
    await area.click();
    await s.keys(s.Key.End);
    await s.keys(' Любит суши.');
    await fakeFansly().command({ op: 'note-edit', noteId: edited, note: DATA.changed });
    await s.press(/^Сохранить/, 'panel', '[data-notes-save]');
    await s.see('panel', /Сейчас в Fansly/);
    await panel(s, 'changed-latest');
    await s.press(/^Сохранить/, 'panel', '[data-notes-save]');
    await s.wait(800);
    await (await s.h.ours('panel', '[data-cut]')).scrollIntoView({ block: 'center' });
    await s.wait(200);
    await panel(s, 'long-note');
  },
  {
    sites: ['fansly'],
    viewport: { width: 1440, height: 1000 },
    before: async ({ hub, site }) => {
      await hub.command({ op: 'config', patch: { aiTexts: { ...(SHOWCASE ? showcaseAiTexts(site) : SEE_AI_TEXTS), 'fan-notes-fill': DATA.fill.join('\n') } } });
      await fakeFansly().command({ op: 'note', fanId: FAN, title: 'Custom Username', note: DATA.name, contentType: 12002 });
      await fakeFansly().command({ op: 'note', fanId: FAN, title: 'Анкета', note: DATA.form.join('\n'), createdAt: Date.now() - 9 * DAY });
      if (!SHOWCASE) await fakeFansly().command({ op: 'note', fanId: FAN, title: 'Старая история', note: LONG, createdAt: Date.now() - 40 * DAY });
      edited = ((await fakeFansly().command({ op: 'note', fanId: FAN, title: '', note: DATA.notes[1] ?? '', createdAt: Date.now() - 3 * DAY })) as { noteId: string }).noteId;
      await fakeFansly().command({ op: 'note', fanId: FAN, title: '', note: DATA.notes[0] ?? '', createdAt: Date.now() - DAY });
    },
  },
);
